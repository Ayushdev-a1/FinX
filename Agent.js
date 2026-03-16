import OpenAI from "openai";
import express from "express";
import { logger } from "./src/utils/logger.js";

const DEFAULT_DOWNGRADE_FACTOR = 0.5;
const AI_TIMEOUT_MS = 8000;
const MAX_DECISION_HISTORY = 100;
const MIN_AI_CONFIDENCE = 0.55;

export class Agent {
  constructor({ apiKey = "", model = "llama-3.3-70b-versatile", httpPort = null } = {}) {
    this.model = model;
    this.httpPort = httpPort;
    this.tradingSystem = null;
    this.server = null;
    this.decisionHistory = [];

    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });

      logger.info("Agent: Groq AI client initialised.");
    } else {
      this.client = null;
      logger.warn("Agent: AI API key not set — AI signal analysis disabled.");
    }
  }

  attach(tradingSystem) {
    this.tradingSystem = tradingSystem;
  }

  async analyzeSignal({ symbol, price, features, signal }) {
    if (!this.client) return signal;

    // Skip weak signals to reduce API usage
    if (signal.confidence < MIN_AI_CONFIDENCE) {
      return signal;
    }

    const fmt = (v, d = 2) => (v != null ? Number(v).toFixed(d) : "N/A");

    const prompt = `
You are a professional quantitative trading analyst.

Evaluate the signal and return JSON ONLY.

Market Data
Symbol: ${symbol}
Price: ${fmt(price)}
RSI: ${fmt(features.rsi)}
MACD: ${fmt(features.macd, 4)}
MA50: ${fmt(features.ma50)}
MA200: ${fmt(features.ma200)}
BollingerUpper: ${fmt(features.bollingerUpper)}
BollingerLower: ${fmt(features.bollingerLower)}
ATR: ${fmt(features.atr)}
Sentiment: ${fmt(features.sentimentScore)}

Signal
Direction: ${signal.direction}
Confidence: ${signal.confidence}
Score: ${signal.score}

Return JSON:

{
 "action":"CONFIRM | DOWNGRADE | VETO",
 "confidence":0-1,
 "reason":"short explanation"
}
`;

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI request timeout")), AI_TIMEOUT_MS)
    );

    try {
      const response = await Promise.race([
        this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: "You are a quantitative trading analyst." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
        timeout,
      ]);

      const text = response.choices[0].message.content || "";
      const parsed = this._parseModelJson(text);

      let enhancedSignal;

      if (parsed.action === "VETO") {
        logger.info("Agent vetoed signal", { symbol, reason: parsed.reason });

        enhancedSignal = {
          ...signal,
          direction: "HOLD",
          confidence: 0,
          agentAction: "VETO",
          agentReason: parsed.reason,
        };
      }

      else if (parsed.action === "DOWNGRADE") {
        const newConf = Math.min(
          signal.confidence,
          parsed.confidence ?? signal.confidence * DEFAULT_DOWNGRADE_FACTOR
        );

        enhancedSignal = {
          ...signal,
          confidence: Number(newConf.toFixed(3)),
          agentAction: "DOWNGRADE",
          agentReason: parsed.reason,
        };

        logger.info("Agent downgraded signal", {
          symbol,
          from: signal.confidence,
          to: newConf,
        });
      }

      else {
        enhancedSignal = {
          ...signal,
          agentAction: "CONFIRM",
          agentReason: parsed.reason,
        };
      }

      this._trackDecision({
        timestamp: new Date().toISOString(),
        symbol,
        price,
        features,
        originalSignal: signal,
        aiAction: parsed.action || "CONFIRM",
        aiReason: parsed.reason,
        finalSignal: enhancedSignal,
      });

      return enhancedSignal;

    } catch (err) {
      logger.warn("Agent: AI analysis failed — using original signal.", {
        error: err?.message || err,
      });

      return signal;
    }
  }

  _trackDecision(decision) {
    this.decisionHistory.push(decision);

    if (this.decisionHistory.length > MAX_DECISION_HISTORY) {
      this.decisionHistory.shift();
    }
  }

  _parseModelJson(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Empty AI response");
    }

    let candidate = text.trim();

    // Common LLM wrappers: ```json ... ``` or ``` ... ```
    candidate = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // If extra prose is present, extract the outermost JSON object.
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }

    return JSON.parse(candidate);
  }

  getDecisionHistory(limit = 20) {
    return this.decisionHistory.slice(-limit).reverse();
  }

  startHttpServer() {
    if (!this.httpPort) return;

    const app = express();
    app.use(express.json());

    app.get("/health", (_, res) => {
      res.json({
        status: "ok",
        time: new Date().toISOString(),
      });
    });

    app.get("/status", (_, res) => {
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

    app.get("/decisions", (req, res) => {
      const limit = Math.min(
        Math.max(1, Number(req.query.limit) || 20),
        MAX_DECISION_HISTORY
      );

      const decisions = this.getDecisionHistory(limit);

      res.json({
        count: decisions.length,
        total: this.decisionHistory.length,
        aiEnabled: !!this.client,
        decisions,
      });
    });

    // Learning system endpoints
    app.get("/learning", (_, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const stats = this.tradingSystem.getLearningStats();
      res.json(stats);
    });

    app.get("/learning/trades", (req, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const { tradeTracker } = this.tradingSystem;
      if (!tradeTracker) {
        return res.json({ enabled: false });
      }

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);
      const symbol = req.query.symbol || null;
      const profitable = req.query.profitable === "true" ? true : 
                        req.query.profitable === "false" ? false : null;

      res.json({
        openTrades: tradeTracker.getOpenTrades(),
        closedTrades: tradeTracker.getClosedTrades({ symbol, limit, profitable }),
        overallStats: tradeTracker.getOverallStats(),
      });
    });

    app.get("/learning/symbols", (req, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const { learningEngine } = this.tradingSystem;
      if (!learningEngine) {
        return res.json({ enabled: false });
      }

      res.json({
        recommendations: learningEngine.getSymbolRecommendations(),
        agentPerformance: learningEngine.getAgentPerformance(),
      });
    });

    app.post("/learning/run", (_, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const { learningEngine } = this.tradingSystem;
      if (!learningEngine) {
        return res.json({ success: false, reason: "Learning engine not enabled." });
      }

      learningEngine.learn();
      res.json({ 
        success: true, 
        insights: learningEngine.getLearningInsights(),
      });
    });

    // Stock picker endpoints
    app.get("/stocks", async (_, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const analysis = await this.tradingSystem.getStockPickerAnalysis();
      res.json(analysis);
    });

    app.post("/stocks/refresh", async (_, res) => {
      if (!this.tradingSystem) {
        return res.status(503).json({ error: "Trading system not attached." });
      }

      const { stockPicker } = this.tradingSystem;
      if (!stockPicker) {
        return res.json({ success: false, reason: "Stock picker not enabled." });
      }

      const newSymbols = await stockPicker.refreshCache();
      res.json({
        success: true,
        symbols: newSymbols,
      });
    });

    this.server = app.listen(this.httpPort, () => {
      logger.info(`Agent HTTP server listening on port ${this.httpPort}`);
    });
  }

  stopHttpServer() {
    if (this.server) {
      this.server.close(() => {
        logger.info("Agent HTTP server stopped.");
      });
    }
  }
}
