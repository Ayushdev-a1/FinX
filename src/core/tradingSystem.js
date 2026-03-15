import { buildFeatureVector } from "../layers/features/indicators.js";
import { DataPipeline } from "../layers/pipeline/dataPipeline.js";
import { StrategyEngine } from "../layers/strategy/strategyEngine.js";
import { PortfolioEngine } from "../layers/portfolio/portfolioEngine.js";
import { RiskManager } from "../layers/risk/riskManager.js";
import { buildExecutionEngine } from "../layers/execution/executionEngine.js";
import { buildMarketDataProvider } from "../layers/data/marketDataProvider.js";
import { buildNewsProvider } from "../layers/data/newsProvider.js";
import { Monitor } from "../layers/monitoring/monitor.js";
import { logger } from "../utils/logger.js";

export class TradingSystem {
  constructor(env, agent = null) {
    this.env = env;
    this.agent = agent;
    this.pipeline = new DataPipeline();
    this.strategy = new StrategyEngine();
    this.portfolio = new PortfolioEngine({
      initialCapital: env.initialCapital,
      maxPositionPct: env.maxPositionPct,
    });
    this.risk = new RiskManager(env);
    this.execution = buildExecutionEngine(env);
    this.marketData = buildMarketDataProvider(env);
    this.news = buildNewsProvider(env);
    this.monitor = new Monitor();
    this.lastPrices = new Map();
    this.timer = null;
    this.isWarmedUp = false;
    this.symbolsWarmedUp = new Set(); // Track per-symbol warm-up status
  }

  /**
   * Bootstrap the system with historical data so indicators can compute immediately.
   * Fetches historical candles and pre-populates the data pipeline.
   */
  async bootstrap() {
    logger.info("Bootstrapping historical data for indicators...");

    try {
      const historicalCandles = await this.marketData.getHistoricalCandles();

      for (const [symbol, candles] of historicalCandles.entries()) {
        if (candles.length === 0) {
          logger.warn(`No historical candles for ${symbol}, indicators will need warm-up time`);
          continue;
        }

        // Convert candles to ticks and append to history
        const ticks = candles.map((c) => ({
          symbol,
          timestamp: c.timestamp,
          price: c.close,
          bid: c.low,
          ask: c.high,
          volume: c.volume,
        }));

        this.pipeline.appendHistory(ticks);

        // Set last price from most recent candle
        const lastCandle = candles[candles.length - 1];
        this.lastPrices.set(symbol, lastCandle.close);

        logger.info(`Bootstrapped ${candles.length} candles for ${symbol}`);
      }

      // Check if we have enough data for trading
      const readySymbols = [];
      const warmingSymbols = [];

      for (const symbol of this.env.symbols) {
        const candleCount = this.pipeline.computeOhlc(symbol, 60_000, 300).length;
        if (candleCount >= 210) {
          readySymbols.push(symbol);
        } else {
          warmingSymbols.push(`${symbol} (${candleCount}/210 candles)`);
        }
      }

      if (readySymbols.length > 0) {
        this.isWarmedUp = true;
        logger.info(`Ready to trade: ${readySymbols.join(", ")}`);
      }

      if (warmingSymbols.length > 0) {
        logger.warn(`Still warming up: ${warmingSymbols.join(", ")}`);
      }
    } catch (err) {
      logger.error("Bootstrap failed, system will warm up gradually:", err?.message || err);
    }
  }

  async cycle() {
    const started = Date.now();

    const rawTicks = await this.marketData.getSnapshot();
    const ticks = this.pipeline.normalizeTicks(rawTicks);
    this.monitor.onTicks(ticks.length);

    this.pipeline.appendHistory(ticks);

    for (const tick of ticks) {
      this.lastPrices.set(tick.symbol, tick.price);
      const candles = this.pipeline.computeOhlc(tick.symbol, 60_000, 300);
      if (candles.length < 210) {
        // Log warming status once per symbol (not every cycle)
        if (!this.symbolsWarmedUp.has(tick.symbol)) {
          logger.info(`Warming up: ${tick.symbol} has ${candles.length}/210 candles needed for indicators`);
        }
        continue;
      }

      // Mark this symbol as warmed up (log only once per symbol)
      if (!this.symbolsWarmedUp.has(tick.symbol)) {
        this.symbolsWarmedUp.add(tick.symbol);
        logger.info(`${tick.symbol} warmed up, now generating trading signals`);
      }

      // Mark system as warmed up once any symbol is ready
      if (!this.isWarmedUp) {
        this.isWarmedUp = true;
      }

      const sentiment = await this.news.getSentiment(tick.symbol);
      const features = buildFeatureVector(candles, sentiment.sentimentScore);
      const signal = this.strategy.generateSignal({
        symbol: tick.symbol,
        price: tick.price,
        features,
      });

      // Optionally enhance the signal through the AI agent.
      const enhancedSignal = this.agent
        ? await this.agent.analyzeSignal({ symbol: tick.symbol, price: tick.price, features, signal })
        : signal;

      const order = this.portfolio.computeOrder(enhancedSignal, tick.price, this.lastPrices);
      if (!order) continue;

      this.monitor.onOrderAttempt();
      const riskCheck = this.risk.validateOrder({
        order,
        portfolio: this.portfolio,
        priceBySymbol: this.lastPrices,
      });

      if (!riskCheck.ok) {
        this.monitor.onRiskReject();
        logger.warn("Risk rejection", { order, reason: riskCheck.reason });
        continue;
      }

      const fill = await this.execution.execute(order);
      if (fill.status === "FILLED" || fill.status === "ROUTED") {
        this.portfolio.applyFill(order);
        this.monitor.onOrderFilled();
      }
    }

    const equity = this.portfolio.getEquity(this.lastPrices);
    this.monitor.setLatency(Date.now() - started);
    this.monitor.snapshot({ equity: Number(equity.toFixed(2)), cash: Number(this.portfolio.cash.toFixed(2)) });
  }

  async start() {
    logger.info("Starting trading system", {
      mode: this.env.tradingMode,
      symbols: this.env.symbols,
      pollIntervalMs: this.env.pollIntervalMs,
    });

    // Bootstrap with historical data before starting the trading loop
    await this.bootstrap();

    await this.cycle();
    this.timer = setInterval(async () => {
      try {
        await this.cycle();
      } catch (err) {
        logger.error("Cycle failure", err?.message || err);
      }
    }, this.env.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
