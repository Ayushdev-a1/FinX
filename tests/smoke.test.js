import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadDotEnv } from "../src/utils/envLoader.js";
import { getEnv } from "../src/config/env.js";
import { runBacktest } from "../src/layers/backtest/backtester.js";
import { TradingSystem } from "../src/core/tradingSystem.js";
import { Agent } from "../Agent.js";

test("loadDotEnv hydrates config values from a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-env-"));
  const envFile = path.join(tempDir, ".env.test");

  fs.writeFileSync(
    envFile,
    [
      "TRADING_MODE=paper",
      "SYMBOLS=AAA,BBB",
      "POLL_INTERVAL_MS=5000",
      'GEMINI_API_KEY="test-key"',
    ].join("\n"),
  );

  const originalEnv = { ...process.env };
  try {
    delete process.env.TRADING_MODE;
    delete process.env.SYMBOLS;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.GEMINI_API_KEY;

    loadDotEnv(envFile);
    const env = getEnv();

    assert.equal(env.tradingMode, "paper");
    assert.deepEqual(env.symbols, ["AAA", "BBB"]);
    assert.equal(env.pollIntervalMs, 5000);
    assert.equal(env.geminiApiKey, "test-key");
  } finally {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runBacktest returns a valid equity summary", () => {
  const candles = [];
  let price = 100;

  for (let i = 0; i < 260; i += 1) {
    const open = price;
    const close = price + 1 + (i % 3) * 0.1;
    candles.push({
      timestamp: 1_700_000_000_000 + i * 60_000,
      open,
      high: close + 0.5,
      low: open - 0.5,
      close,
      volume: 100_000 + i,
    });
    price = close;
  }

  const result = runBacktest({ symbol: "TEST.NS", candles, initialCapital: 500_000 });

  assert.equal(result.symbol, "TEST.NS");
  assert.equal(result.initialCapital, 500_000);
  assert.ok(Number.isFinite(result.finalEquity));
  assert.ok(Number.isFinite(result.pnl));
  assert.ok(Number.isFinite(result.returnPct));
});

test("TradingSystem.cycle processes a paper trade end-to-end", async () => {
  const env = {
    tradingMode: "paper",
    symbols: ["TEST.NS"],
    pollIntervalMs: 15_000,
    maxPositionPct: 0.1,
    maxLossPerTradePct: 0.01,
    maxDailyDrawdownPct: 0.5,
    maxSectorExposurePct: 0.2,
    initialCapital: 100_000,
    polygonApiKey: "",
    newsApiKey: "",
    angelOneApiKey: "",
    angelOneClientId: "",
    angelOneJwtToken: "",
    angelOneRefreshToken: "",
    geminiApiKey: "",
    agentHttpPort: null,
    enableDynamicStockPicker: false,
    enableSelfLearning: false,
    learningDataPath: "/tmp/learning-test",
  };

  const system = new TradingSystem(env);
  // Initialize the system (this sets up marketData)
  await system.initialize();
  
  const baseTs = 1_700_000_000_000;
  const seededTicks = [];

  for (let i = 0; i < 220; i += 1) {
    const pricePoint = 100 + i * 0.4;
    seededTicks.push({
      symbol: "TEST.NS",
      timestamp: baseTs + i * 60_000,
      price: pricePoint,
      bid: pricePoint - 0.1,
      ask: pricePoint + 0.1,
      volume: 100_000 + i,
    });
  }

  system.pipeline.appendHistory(seededTicks);
  system.marketData = {
    async getSnapshot() {
      return [
        {
          symbol: "TEST.NS",
          timestamp: baseTs + 221 * 60_000,
          price: 200,
          bid: 199.9,
          ask: 200.1,
          volume: 150_000,
        },
      ];
    },
  };
  system.news = {
    async getSentiment(symbol) {
      return { symbol, sentimentScore: 0.2, source: "test" };
    },
  };
  system.strategy = {
    generateSignal({ symbol }) {
      return { symbol, direction: "BUY", confidence: 0.5, score: 0.5 };
    },
  };

  await system.cycle();

  const position = system.portfolio.getPosition("TEST.NS");
  assert.equal(system.monitor.metrics.ticksProcessed, 1);
  assert.equal(system.monitor.metrics.ordersAttempted, 1);
  assert.equal(system.monitor.metrics.ordersFilled, 1);
  assert.ok(position.qty > 0);
  assert.ok(system.portfolio.cash < env.initialCapital);
  assert.equal(system.lastPrices.get("TEST.NS"), 200);
});

test("Agent tracks decision history and provides getDecisionHistory", () => {
  const agent = new Agent({ httpPort: null });

  // Manually track decisions without AI
  agent._trackDecision({
    timestamp: "2024-01-15T10:00:00.000Z",
    symbol: "TEST.NS",
    price: 100,
    features: { rsi: 50, macd: 0.5, ma50: 98, ma200: 95 },
    originalSignal: { direction: "BUY", confidence: 0.7, score: 0.8 },
    aiAction: "CONFIRM",
    aiReason: "Strong trend",
    aiConfidence: 0.8,
    finalSignal: { direction: "BUY", confidence: 0.7 },
  });

  agent._trackDecision({
    timestamp: "2024-01-15T10:05:00.000Z",
    symbol: "RELIANCE.NS",
    price: 2500,
    features: { rsi: 75, macd: -0.3, ma50: 2510, ma200: 2400 },
    originalSignal: { direction: "SELL", confidence: 0.6, score: -0.7 },
    aiAction: "DOWNGRADE",
    aiReason: "Conflicting signals",
    aiConfidence: 0.3,
    finalSignal: { direction: "SELL", confidence: 0.3 },
  });

  const history = agent.getDecisionHistory(10);
  assert.equal(history.length, 2);
  // Most recent first
  assert.equal(history[0].symbol, "RELIANCE.NS");
  assert.equal(history[1].symbol, "TEST.NS");
  assert.equal(history[0].aiAction, "DOWNGRADE");
  assert.equal(history[1].aiAction, "CONFIRM");
});

test("Agent initializes without Gemini API key (AI disabled)", () => {
  const agent = new Agent({ httpPort: null });
  assert.equal(agent.client, null);
  assert.deepEqual(agent.decisionHistory, []);
});

test("Agent parses JSON wrapped in markdown fences", () => {
  const agent = new Agent({ httpPort: null });
  const parsed = agent._parseModelJson("```json\n{\"action\":\"CONFIRM\",\"confidence\":0.8,\"reason\":\"ok\"}\n```");
  assert.equal(parsed.action, "CONFIRM");
  assert.equal(parsed.confidence, 0.8);
});

test("Agent parses JSON when model adds extra prose", () => {
  const agent = new Agent({ httpPort: null });
  const parsed = agent._parseModelJson(
    "Here is my analysis:\n``` \n{\"action\":\"DOWNGRADE\",\"confidence\":0.4,\"reason\":\"mixed\"}\n```"
  );
  assert.equal(parsed.action, "DOWNGRADE");
  assert.equal(parsed.confidence, 0.4);
});

// Learning system tests
import { TradeTracker } from "../src/layers/learning/tradeTracker.js";
import { LearningEngine } from "../src/layers/learning/learningEngine.js";

test("TradeTracker records entries and exits correctly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-tracker-"));
  const tracker = new TradeTracker(tempDir);

  // Record entry
  const entry = tracker.recordEntry({
    symbol: "TEST.NS",
    side: "BUY",
    qty: 100,
    price: 500,
    signal: { direction: "BUY", confidence: 0.7, score: 0.8 },
    features: { rsi: 45, macd: 0.5 },
    agentAction: "CONFIRM",
  });

  assert.equal(entry.symbol, "TEST.NS");
  assert.equal(entry.side, "BUY");
  assert.equal(entry.entryQty, 100);
  assert.equal(entry.entryPrice, 500);
  assert.equal(entry.status, "OPEN");

  // Verify open trade is tracked
  const openTrade = tracker.getOpenTrade("TEST.NS");
  assert.ok(openTrade);
  assert.equal(openTrade.symbol, "TEST.NS");

  // Record exit (profitable)
  const exit = tracker.recordExit({
    symbol: "TEST.NS",
    exitQty: 100,
    exitPrice: 550,
    exitReason: "signal",
  });

  assert.equal(exit.status, "CLOSED");
  assert.equal(exit.pnl, 5000); // (550 - 500) * 100
  assert.equal(exit.profitable, true);
  assert.ok(exit.pnlPct > 0);

  // Verify trade is closed
  const closedOpenTrade = tracker.getOpenTrade("TEST.NS");
  assert.equal(closedOpenTrade, null);

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("TradeTracker calculates statistics correctly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trade-tracker-stats-"));
  const tracker = new TradeTracker(tempDir);

  // Create several trades
  for (let i = 0; i < 10; i++) {
    tracker.recordEntry({
      symbol: `TEST${i}.NS`,
      side: "BUY",
      qty: 100,
      price: 100,
      signal: { direction: "BUY", confidence: 0.6 },
      features: { rsi: 50 },
    });

    // Alternate between profit and loss
    tracker.recordExit({
      symbol: `TEST${i}.NS`,
      exitQty: 100,
      exitPrice: i % 2 === 0 ? 110 : 90,
      exitReason: "signal",
    });
  }

  const stats = tracker.getOverallStats();
  assert.equal(stats.totalTrades, 10);
  assert.equal(stats.profitableTrades, 5);
  assert.equal(stats.losingTrades, 5);
  assert.equal(stats.winRate, 0.5);

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("LearningEngine adjusts signals based on historical performance", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "learning-engine-"));
  const tracker = new TradeTracker(tempDir);
  const engine = new LearningEngine(tracker, tempDir);

  // Create enough trades to enable learning (all profitable BUY signals)
  for (let i = 0; i < 15; i++) {
    tracker.recordEntry({
      symbol: `TEST${i}.NS`,
      side: "BUY",
      qty: 100,
      price: 100,
      signal: { direction: "BUY", confidence: 0.7 },
      features: { rsi: 45, macd: 0.5, ma50: 100, ma200: 95 },
    });

    // All trades are profitable
    tracker.recordExit({
      symbol: `TEST${i}.NS`,
      exitQty: 100,
      exitPrice: 115, // 15% profit
      exitReason: "signal",
    });
  }

  // Run learning
  engine.learn();

  // Signal should get a confidence boost since BUY signals have been profitable
  const testSignal = { symbol: "NEW.NS", direction: "BUY", confidence: 0.6, score: 0.5 };
  const adjustedSignal = engine.adjustSignal(testSignal, { rsi: 45, macd: 0.5 });

  // With all profitable trades, confidence should be boosted
  assert.ok(adjustedSignal.confidence >= testSignal.confidence);

  // Check insights
  const insights = engine.getLearningInsights();
  assert.ok(insights.signalPatterns.length > 0);

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("LearningEngine evaluates symbols based on history", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "learning-symbol-"));
  const tracker = new TradeTracker(tempDir);
  const engine = new LearningEngine(tracker, tempDir);

  // Create trades for a specific symbol with poor performance
  for (let i = 0; i < 25; i++) {
    tracker.recordEntry({
      symbol: "BADSTOCK.NS",
      side: "BUY",
      qty: 100,
      price: 100,
      signal: { direction: "BUY", confidence: 0.6 },
      features: { rsi: 50 },
    });

    // All trades lose
    tracker.recordExit({
      symbol: "BADSTOCK.NS",
      exitQty: 100,
      exitPrice: 85, // 15% loss
      exitReason: "signal",
    });
  }

  // Run learning
  engine.learn();

  // Evaluate the poor performing symbol
  const evaluation = engine.evaluateSymbol("BADSTOCK.NS");
  assert.equal(evaluation.tradeable, false);
  assert.equal(evaluation.reason, "poor_historical_performance");
  assert.ok(evaluation.winRate < 0.3);

  // New symbol should be tradeable (no history)
  const newEvaluation = engine.evaluateSymbol("NEWSTOCK.NS");
  assert.equal(newEvaluation.tradeable, true);
  assert.equal(newEvaluation.reason, "insufficient_data");

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
});
