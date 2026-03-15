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
      if (candles.length < 210) continue;

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
