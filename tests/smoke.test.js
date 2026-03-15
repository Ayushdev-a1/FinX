import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadDotEnv } from "../src/utils/envLoader.js";
import { getEnv } from "../src/config/env.js";
import { runBacktest } from "../src/layers/backtest/backtester.js";
import { TradingSystem } from "../src/core/tradingSystem.js";

test("loadDotEnv hydrates config values from a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-env-"));
  const envFile = path.join(tempDir, ".env.test");

  fs.writeFileSync(
    envFile,
    [
      "TRADING_MODE=paper",
      "SYMBOLS=AAA,BBB",
      "POLL_INTERVAL_MS=5000",
      'OPENAI_API_KEY="test-key"',
    ].join("\n"),
  );

  const originalEnv = { ...process.env };
  try {
    delete process.env.TRADING_MODE;
    delete process.env.SYMBOLS;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.OPENAI_API_KEY;

    loadDotEnv(envFile);
    const env = getEnv();

    assert.equal(env.tradingMode, "paper");
    assert.deepEqual(env.symbols, ["AAA", "BBB"]);
    assert.equal(env.pollIntervalMs, 5000);
    assert.equal(env.openAiApiKey, "test-key");
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
    zerodhaApiKey: "",
    zerodhaAccessToken: "",
    openAiApiKey: "",
    agentHttpPort: null,
  };

  const system = new TradingSystem(env);
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
