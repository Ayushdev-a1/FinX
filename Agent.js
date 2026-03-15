import OpenAI from "openai";
import express from "express";
import { logger } from "./src/utils/logger.js";

/** Factor applied to confidence when the AI downgrades but supplies no value. */
const DEFAULT_DOWNGRADE_FACTOR = 0.5;

/** Maximum milliseconds to wait for an OpenAI response before falling through. */
const OPENAI_TIMEOUT_MS = 8_000;

/**
 * Agent — AI-powered trading assistant.
 *
 * Responsibilities:
 *  1. Optionally enhance trading signals via OpenAI analysis before execution.
 *  2. Expose a lightweight HTTP server for live monitoring of positions,
 *     equity, and system metrics (requires AGENT_HTTP_PORT to be set).
 */
export class Agent {
  /**
   * @param {object}      opts
   * @param {string}      [opts.openAiApiKey]  - OpenAI API key (enables AI analysis).
   * @param {string}      [opts.model]         - OpenAI model to use.
   * @param {number|null} [opts.httpPort]      - Port for the monitoring HTTP server.
   */
  constructor({ openAiApiKey = "", model = "gpt-4o-mini", httpPort = null } = {}) {
    this.model = model;
    this.httpPort = httpPort;
    this.tradingSystem = null;
    this.server = null;

    if (openAiApiKey) {
      this.openai = new OpenAI({ apiKey: openAiApiKey });
      logger.info("Agent: OpenAI client initialised.");
    } else {
      this.openai = null;
      logger.warn("Agent: OPENAI_API_KEY not set — AI signal analysis disabled.");
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
   * Analyse a proposed trading signal using OpenAI and return a (possibly
   * modified) signal.  Falls through to the original signal when OpenAI is
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
    if (!this.openai) return signal;

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
      setTimeout(() => reject(new Error("OpenAI request timed out")), OPENAI_TIMEOUT_MS),
    );

    try {
      const response = await Promise.race([
        this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 120,
          temperature: 0.2,
        }),
        timeout,
      ]);

      const text = response.choices[0]?.message?.content?.trim() || "{}";
      const parsed = JSON.parse(text);

      if (parsed.action === "VETO") {
        logger.info("Agent vetoed signal", { symbol, reason: parsed.reason });
        return { ...signal, direction: "HOLD", confidence: 0, agentAction: "VETO", agentReason: parsed.reason };
      }

      if (parsed.action === "DOWNGRADE") {
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
        return {
          ...signal,
          confidence: Number(newConf.toFixed(3)),
          agentAction: "DOWNGRADE",
          agentReason: parsed.reason,
        };
      }

      return { ...signal, agentAction: "CONFIRM", agentReason: parsed.reason };
    } catch (err) {
      logger.warn("Agent: OpenAI analysis failed — using original signal.", { error: err?.message || err });
      return signal;
    }
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
