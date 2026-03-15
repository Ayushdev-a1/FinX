import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import { logger } from "./src/utils/logger.js";

/** Factor applied to confidence when the AI downgrades but supplies no value. */
const DEFAULT_DOWNGRADE_FACTOR = 0.5;

/** Maximum milliseconds to wait for a Gemini response before falling through. */
const GEMINI_TIMEOUT_MS = 8_000;

/** Maximum number of decisions to keep in history for validation/review. */
const MAX_DECISION_HISTORY = 100;

/**
 * Agent — AI-powered trading assistant.
 *
 * Responsibilities:
 *  1. Optionally enhance trading signals via Gemini AI analysis before execution.
 *  2. Expose a lightweight HTTP server for live monitoring of positions,
 *     equity, and system metrics (requires AGENT_HTTP_PORT to be set).
 *  3. Track decision history for validation and review.
 */
export class Agent {
  /**
   * @param {object}      opts
   * @param {string}      [opts.geminiApiKey]  - Gemini API key (enables AI analysis).
   * @param {string}      [opts.model]         - Gemini model to use.
   * @param {number|null} [opts.httpPort]      - Port for the monitoring HTTP server.
   */
  constructor({ geminiApiKey = "", model = "gemini-1.5-flash", httpPort = null } = {}) {
    this.model = model;
    this.httpPort = httpPort;
    this.tradingSystem = null;
    this.server = null;
    this.decisionHistory = [];

    if (geminiApiKey) {
      this.genAI = new GoogleGenerativeAI(geminiApiKey);
      this.geminiModel = this.genAI.getGenerativeModel({
        model: this.model,
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.2,
        },
      });
      logger.info("Agent: Gemini AI client initialised.");
    } else {
      this.genAI = null;
      this.geminiModel = null;
      logger.warn("Agent: GEMINI_API_KEY not set — AI signal analysis disabled.");
    }
  }

  /**
   * Attach a live TradingSystem instance so the HTTP endpoints can read its
   * state.
   *
   * @param {import("./src/core/tradingSystem.js").TradingSystem} tradingSystem
   */
  attach(tradingSystem) {
    this.tradingSystem = tradingSystem;
  }

  /**
   * Analyse a proposed trading signal using Gemini AI and return a (possibly
   * modified) signal.  Falls through to the original signal when Gemini is
   * unavailable, the call times out, or any error occurs.
   *
   * Possible agent actions:
   *  - CONFIRM   — signal is used as-is.
   *  - DOWNGRADE — confidence is reduced (AI supplies the new value).
   *  - VETO      — direction is forced to "HOLD".
   *
   * @param {object} params
   * @param {string} params.symbol
   * @param {number} params.price
   * @param {object} params.features  - Output of buildFeatureVector().
   * @param {object} params.signal    - Output of StrategyEngine.generateSignal().
   * @returns {Promise<object>} Enhanced signal object.
   */
  async analyzeSignal({ symbol, price, features, signal }) {
    if (!this.geminiModel) return signal;

    const fmt = (v, d = 2) => (v != null ? Number(v).toFixed(d) : "N/A");

    const prompt = [
      "You are a quantitative trading analyst. Given the market data and proposed signal below,",
      "decide whether to CONFIRM, DOWNGRADE (reduce confidence), or VETO the signal.",
      "",
      `Symbol: ${symbol}`,
      `Price: ${fmt(price)}`,
      `RSI(14): ${fmt(features.rsi)}`,
      `MACD: ${fmt(features.macd, 4)}`,
      `MA50: ${fmt(features.ma50)}`,
      `MA200: ${fmt(features.ma200)}`,
      `Bollinger Upper: ${fmt(features.bollingerUpper)}`,
      `Bollinger Lower: ${fmt(features.bollingerLower)}`,
      `ATR(14): ${fmt(features.atr)}`,
      `Sentiment Score: ${fmt(features.sentimentScore, 3)}`,
      `Volume Spike Ratio: ${fmt(features.volumeSpike)}`,
      "",
      `Proposed signal: direction=${signal.direction}, confidence=${signal.confidence}, score=${signal.score}`,
      "",
      'Reply with a JSON object: { "action": "CONFIRM"|"DOWNGRADE"|"VETO", "confidence": <0-1>, "reason": "<20 words max>" }',
      "JSON only — no markdown, no extra text.",
    ].join("\n");

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Gemini request timed out")), GEMINI_TIMEOUT_MS),
    );

    try {
      const response = await Promise.race([
        this.geminiModel.generateContent(prompt),
        timeout,
      ]);

      const responseText = response.response?.text?.() || "";
      const text = responseText.trim() || "{}";
      // Remove any markdown code block wrappers if present
      const cleanText = text.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(cleanText);

      let enhancedSignal;

      if (parsed.action === "VETO") {
        logger.info("Agent vetoed signal", { symbol, reason: parsed.reason });
        enhancedSignal = { ...signal, direction: "HOLD", confidence: 0, agentAction: "VETO", agentReason: parsed.reason };
      } else if (parsed.action === "DOWNGRADE") {
        const newConf = Math.min(
          signal.confidence,
          parsed.confidence ?? signal.confidence * DEFAULT_DOWNGRADE_FACTOR,
        );
        logger.info("Agent downgraded signal", {
          symbol,
          from: signal.confidence,
          to: Number(newConf.toFixed(3)),
          reason: parsed.reason,
        });
        enhancedSignal = {
          ...signal,
          confidence: Number(newConf.toFixed(3)),
          agentAction: "DOWNGRADE",
          agentReason: parsed.reason,
        };
      } else {
        enhancedSignal = { ...signal, agentAction: "CONFIRM", agentReason: parsed.reason };
      }

      // Track decision for validation
      this._trackDecision({
        timestamp: new Date().toISOString(),
        symbol,
        price,
        features,
        originalSignal: signal,
        aiAction: parsed.action || "CONFIRM",
        aiReason: parsed.reason || "No reason provided",
        aiConfidence: parsed.confidence,
        finalSignal: enhancedSignal,
      });

      return enhancedSignal;
    } catch (err) {
      logger.warn("Agent: Gemini analysis failed — using original signal.", { error: err?.message || err });
      return signal;
    }
  }

  /**
   * Track a decision for validation and review.
   * @private
   */
  _trackDecision(decision) {
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > MAX_DECISION_HISTORY) {
      this.decisionHistory.shift();
    }
  }

  /**
   * Get recent decisions for validation.
   * @param {number} limit - Maximum number of decisions to return.
   * @returns {Array} Recent decisions.
   */
  getDecisionHistory(limit = 20) {
    return this.decisionHistory.slice(-limit).reverse();
  }

  /**
   * Start the optional Express HTTP monitoring server.
   * No-op when httpPort is null/undefined.
   */
  startHttpServer() {
    if (!this.httpPort) return;

    const app = express();
    app.use(express.json());

    /** GET /health — liveness probe */
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", time: new Date().toISOString() });
    });

    /** GET /status — portfolio snapshot */
    app.get("/status", (_req, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }
      const { portfolio, monitor, env } = this.tradingSystem;
      const equity = portfolio.getEquity(this.tradingSystem.lastPrices);
      const positions = {};
      for (const [sym, pos] of portfolio.positions.entries()) {
        positions[sym] = pos;
      }
      res.json({
        mode: env.tradingMode,
        symbols: env.symbols,
        equity: Number(equity.toFixed(2)),
        cash: Number(portfolio.cash.toFixed(2)),
        positions,
        metrics: monitor.metrics,
      });
    });

    /** GET /metrics — raw performance counters */
    app.get("/metrics", (_req, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }
      res.json(this.tradingSystem.monitor.metrics);
    });

    /**
     * GET /decisions — View recent AI decisions for validation.
     * Query params:
     *   - limit: Number of recent decisions to return (default: 20, max: 100)
     *
     * This endpoint helps users verify bot decisions by showing:
     *   - Original signal from strategy engine
     *   - AI's action (CONFIRM/DOWNGRADE/VETO)
     *   - AI's reasoning
     *   - Final signal used for trading
     *   - All market data that influenced the decision
     */
    app.get("/decisions", (req, res) => {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), MAX_DECISION_HISTORY);
      const decisions = this.getDecisionHistory(limit);

      res.json({
        count: decisions.length,
        total: this.decisionHistory.length,
        aiEnabled: !!this.geminiModel,
        decisions: decisions.map((d) => ({
          timestamp: d.timestamp,
          symbol: d.symbol,
          price: d.price,
          indicators: {
            rsi: d.features.rsi,
            macd: d.features.macd,
            ma50: d.features.ma50,
            ma200: d.features.ma200,
            bollingerUpper: d.features.bollingerUpper,
            bollingerLower: d.features.bollingerLower,
            atr: d.features.atr,
            sentimentScore: d.features.sentimentScore,
          },
          originalSignal: {
            direction: d.originalSignal.direction,
            confidence: d.originalSignal.confidence,
            score: d.originalSignal.score,
          },
          aiDecision: {
            action: d.aiAction,
            reason: d.aiReason,
            confidence: d.aiConfidence,
          },
          finalSignal: {
            direction: d.finalSignal.direction,
            confidence: d.finalSignal.confidence,
          },
        })),
      });
    });

    this.server = app.listen(this.httpPort, (err) => {
      if (err) {
        logger.error(`Agent HTTP server failed to start on port ${this.httpPort}:`, err?.message || err);
        this.server = null;
        return;
      }
      logger.info(`Agent HTTP server listening on port ${this.httpPort}`);
    });

    this.server.on("error", (err) => {
      logger.error("Agent HTTP server error:", err?.message || err);
      this.server = null;
    });
  }

  /** Stop the HTTP monitoring server if running. */
  stopHttpServer() {
    if (this.server) {
      this.server.close((err) => {
        if (err) {
          logger.warn("Agent HTTP server did not shut down cleanly:", err?.message || err);
        } else {
          logger.info("Agent HTTP server stopped.");
        }
      });
      this.server = null;
    }
  }
}
