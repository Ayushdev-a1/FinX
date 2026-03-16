import { buildFeatureVector } from "../layers/features/indicators.js";
import { DataPipeline } from "../layers/pipeline/dataPipeline.js";
import { StrategyEngine } from "../layers/strategy/strategyEngine.js";
import { PortfolioEngine } from "../layers/portfolio/portfolioEngine.js";
import { RiskManager } from "../layers/risk/riskManager.js";
import { buildExecutionEngine } from "../layers/execution/executionEngine.js";
import { buildMarketDataProvider } from "../layers/data/marketDataProvider.js";
import { buildNewsProvider } from "../layers/data/newsProvider.js";
import { Monitor } from "../layers/monitoring/monitor.js";
import { TradeTracker, LearningEngine, buildStockPicker } from "../layers/learning/index.js";
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
    this.news = buildNewsProvider(env);
    this.monitor = new Monitor();
    this.lastPrices = new Map();
    this.timer = null;
    this.isWarmedUp = false;
    this.symbolsWarmedUp = new Set(); // Track per-symbol warm-up status
    
    // Self-learning components
    this.tradeTracker = new TradeTracker(env.learningDataPath);
    this.learningEngine = env.enableSelfLearning 
      ? new LearningEngine(this.tradeTracker, env.learningDataPath)
      : null;
    
    // Dynamic stock picker
    this.stockPicker = env.enableDynamicStockPicker
      ? buildStockPicker(env, this.learningEngine)
      : null;
    
    // Market data provider will be initialized after stock discovery
    this.marketData = null;
    
    // Learning interval (run learning every hour)
    this.learningInterval = null;
    this.learningIntervalMs = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Initialize the system - discover stocks if dynamic picker is enabled
   */
  async initialize() {
    // Discover stocks dynamically if enabled
    if (this.stockPicker && this.env.enableDynamicStockPicker) {
      logger.info("Dynamic stock picker enabled, discovering tradeable stocks...");
      const discoveredSymbols = await this.stockPicker.discoverStocks();
      
      if (discoveredSymbols.length > 0) {
        // Update env symbols with discovered stocks
        this.env.symbols = discoveredSymbols;
        logger.info("Using dynamically discovered stocks", { symbols: discoveredSymbols });
      } else {
        logger.warn("Stock discovery failed, using default symbols from config");
      }
    }
    
    // Now build market data provider with final symbol list
    this.marketData = buildMarketDataProvider(this.env);
    
    // Run initial learning if we have historical trade data
    if (this.learningEngine) {
      this.learningEngine.learn();
    }
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
      let signal = this.strategy.generateSignal({
        symbol: tick.symbol,
        price: tick.price,
        features,
      });
      
      // Apply learning adjustments if available
      if (this.learningEngine) {
        signal = this.learningEngine.adjustSignal(signal, features);
      }

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

      // Check if we have an existing position - if so, this might be an exit
      const existingPosition = this.portfolio.getPosition(order.symbol);
      const isExit = existingPosition.qty > 0 && order.side === "SELL";
      const isEntry = !isExit && order.side === "BUY";

      const fill = await this.execution.execute(order);
      if (fill.status === "FILLED" || fill.status === "ROUTED") {
        this.portfolio.applyFill(order);
        this.monitor.onOrderFilled();
        
        // Track trades for learning
        if (isEntry) {
          this.tradeTracker.recordEntry({
            symbol: order.symbol,
            side: order.side,
            qty: order.qty,
            price: order.price,
            signal: enhancedSignal,
            features,
            agentAction: enhancedSignal.agentAction,
            agentReason: enhancedSignal.agentReason,
          });
        } else if (isExit) {
          this.tradeTracker.recordExit({
            symbol: order.symbol,
            exitQty: order.qty,
            exitPrice: order.price,
            exitReason: "signal",
          });
        }
      }
    }

    const equity = this.portfolio.getEquity(this.lastPrices);
    this.monitor.setLatency(Date.now() - started);
    this.monitor.snapshot({ equity: Number(equity.toFixed(2)), cash: Number(this.portfolio.cash.toFixed(2)) });
  }

  /**
   * Periodic learning update
   */
  _runLearning() {
    if (this.learningEngine) {
      logger.info("Running learning cycle...");
      this.learningEngine.learn();
      
      // Optionally refresh stock picks based on new learning
      if (this.stockPicker && this.env.enableDynamicStockPicker) {
        const recommendations = this.learningEngine.getSymbolRecommendations();
        logger.info("Symbol recommendations updated", { 
          top5: recommendations.slice(0, 5).map(r => ({ symbol: r.symbol, winRate: r.winRate }))
        });
      }
    }
  }

  async start() {
    // Initialize system (discover stocks, setup market data)
    await this.initialize();
    
    logger.info("Starting trading system", {
      mode: this.env.tradingMode,
      symbols: this.env.symbols,
      pollIntervalMs: this.env.pollIntervalMs,
      selfLearningEnabled: !!this.learningEngine,
      dynamicStockPickerEnabled: !!this.stockPicker,
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
    
    // Start learning interval if enabled
    if (this.learningEngine) {
      this.learningInterval = setInterval(() => {
        this._runLearning();
      }, this.learningIntervalMs);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    
    if (this.learningInterval) {
      clearInterval(this.learningInterval);
      this.learningInterval = null;
    }
    
    // Final learning run before shutdown
    if (this.learningEngine) {
      this._runLearning();
    }
  }
  
  /**
   * Get learning statistics
   */
  getLearningStats() {
    if (!this.learningEngine) {
      return { enabled: false };
    }
    
    return {
      enabled: true,
      tradeStats: this.tradeTracker.getOverallStats(),
      insights: this.learningEngine.getLearningInsights(),
      openTrades: this.tradeTracker.getOpenTrades(),
    };
  }
  
  /**
   * Get stock picker analysis
   */
  async getStockPickerAnalysis() {
    if (!this.stockPicker) {
      return { enabled: false };
    }
    
    return {
      enabled: true,
      currentSymbols: this.env.symbols,
      analysis: await this.stockPicker.getStockAnalysis(),
    };
  }
}
