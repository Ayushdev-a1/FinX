import { logger } from "../../utils/logger.js";

/**
 * StockPicker - Dynamically discovers and selects stocks suitable for intraday trading
 * 
 * Selection criteria:
 * - Sufficient trading volume (liquidity)
 * - Price range suitable for position sizing
 * - Volatility suitable for intraday moves
 * - Historical performance from learning engine (if available)
 */
export class StockPicker {
  constructor(config = {}) {
    this.minVolume = config.minVolume || 500000; // Minimum daily volume
    this.minPrice = config.minPrice || 50; // Minimum stock price
    this.maxPrice = config.maxPrice || 5000; // Maximum stock price
    this.maxStocks = config.maxStocks || 10; // Max stocks to track
    this.learningEngine = config.learningEngine || null;
    
    // Cache for discovered stocks
    this.stockCache = {
      stocks: [],
      lastUpdated: 0,
      cacheValidMs: 60 * 60 * 1000, // 1 hour cache
    };
    
    // Popular NSE stocks that typically have good liquidity
    this.nseWatchlist = [
      "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
      "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
      "AXISBANK.NS", "LT.NS", "BAJFINANCE.NS", "ASIANPAINT.NS", "MARUTI.NS",
      "HCLTECH.NS", "WIPRO.NS", "SUNPHARMA.NS", "ULTRACEMCO.NS", "TITAN.NS",
      "NTPC.NS", "ONGC.NS", "POWERGRID.NS", "TATAMOTORS.NS", "TATASTEEL.NS",
      "JSWSTEEL.NS", "M&M.NS", "ADANIPORTS.NS", "TECHM.NS", "BAJAJFINSV.NS",
      "NESTLEIND.NS", "INDUSINDBK.NS", "DIVISLAB.NS", "DRREDDY.NS", "CIPLA.NS",
      "GRASIM.NS", "BRITANNIA.NS", "COALINDIA.NS", "BPCL.NS", "HEROMOTOCO.NS",
      "EICHERMOT.NS", "SHREECEM.NS", "HINDALCO.NS", "UPL.NS", "SBILIFE.NS",
      "APOLLOHOSP.NS", "TATACONSUM.NS", "ADANIENT.NS", "HDFCLIFE.NS", "BAJAJ-AUTO.NS",
    ];
    
    // Nifty Bank stocks (good for intraday due to volatility)
    this.bankNiftyStocks = [
      "HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "AXISBANK.NS", "SBIN.NS",
      "INDUSINDBK.NS", "BANKBARODA.NS", "PNB.NS", "FEDERALBNK.NS", "IDFCFIRSTB.NS",
      "BANDHANBNK.NS", "AUBANK.NS",
    ];
  }

  /**
   * Fetch market data for a list of symbols to evaluate
   */
  async fetchStockData(symbols) {
    const results = [];
    
    for (const symbol of symbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!res.ok) continue;

        const json = await res.json();
        const result = json?.chart?.result?.[0];
        const meta = result?.meta;
        const indicators = result?.indicators?.quote?.[0];

        if (!meta || !meta.regularMarketPrice) continue;

        // Calculate average volume and volatility
        const volumes = indicators?.volume?.filter(v => v != null) || [];
        const closes = indicators?.close?.filter(c => c != null) || [];
        const highs = indicators?.high?.filter(h => h != null) || [];
        const lows = indicators?.low?.filter(l => l != null) || [];

        const avgVolume = volumes.length > 0 
          ? volumes.reduce((a, b) => a + b, 0) / volumes.length 
          : 0;

        // Calculate average daily range (volatility proxy)
        let avgDailyRange = 0;
        if (highs.length > 0 && lows.length > 0 && closes.length > 0) {
          const ranges = [];
          for (let i = 0; i < Math.min(highs.length, lows.length); i++) {
            const range = ((highs[i] - lows[i]) / closes[i]) * 100;
            ranges.push(range);
          }
          avgDailyRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
        }

        results.push({
          symbol,
          price: meta.regularMarketPrice,
          avgVolume: Math.round(avgVolume),
          avgDailyRangePct: Number(avgDailyRange.toFixed(2)),
          marketCap: meta.marketCap || 0,
          exchange: meta.exchange,
        });
      } catch (err) {
        // Skip failed symbols silently
        continue;
      }
    }

    return results;
  }

  /**
   * Score a stock based on intraday trading suitability
   */
  scoreStock(stock) {
    let score = 0;
    
    // Volume score (higher is better for liquidity)
    if (stock.avgVolume >= this.minVolume * 5) score += 30;
    else if (stock.avgVolume >= this.minVolume * 2) score += 20;
    else if (stock.avgVolume >= this.minVolume) score += 10;
    else return 0; // Below minimum volume threshold
    
    // Price range score
    if (stock.price >= this.minPrice && stock.price <= this.maxPrice) {
      // Prefer mid-range prices for easier position sizing
      const midPrice = (this.minPrice + this.maxPrice) / 2;
      const priceDeviation = Math.abs(stock.price - midPrice) / midPrice;
      score += 20 * (1 - priceDeviation);
    } else {
      return 0; // Outside price range
    }
    
    // Volatility score (need some movement for intraday, but not too much)
    if (stock.avgDailyRangePct >= 1.5 && stock.avgDailyRangePct <= 5) {
      score += 25;
    } else if (stock.avgDailyRangePct >= 1 && stock.avgDailyRangePct <= 7) {
      score += 15;
    } else if (stock.avgDailyRangePct >= 0.5) {
      score += 5;
    }
    
    // Learning engine boost
    if (this.learningEngine) {
      const evaluation = this.learningEngine.evaluateSymbol(stock.symbol);
      if (evaluation.tradeable && evaluation.confidence > 0.5) {
        score += 25 * evaluation.confidence;
      } else if (!evaluation.tradeable) {
        score -= 20; // Penalize historically poor performers
      }
    }
    
    return Number(score.toFixed(2));
  }

  /**
   * Discover and select the best stocks for intraday trading
   */
  async discoverStocks() {
    // Check cache
    if (
      this.stockCache.stocks.length > 0 &&
      Date.now() - this.stockCache.lastUpdated < this.stockCache.cacheValidMs
    ) {
      logger.info("Using cached stock list", { count: this.stockCache.stocks.length });
      return this.stockCache.stocks;
    }

    logger.info("Discovering stocks for intraday trading...");

    // Combine watchlists (remove duplicates)
    const allSymbols = [...new Set([...this.nseWatchlist, ...this.bankNiftyStocks])];
    
    // Fetch data for all symbols
    const stockData = await this.fetchStockData(allSymbols);
    
    if (stockData.length === 0) {
      logger.warn("Failed to fetch stock data, using default list");
      return this.nseWatchlist.slice(0, this.maxStocks);
    }

    // Score each stock
    const scoredStocks = stockData
      .map(stock => ({
        ...stock,
        score: this.scoreStock(stock),
      }))
      .filter(stock => stock.score > 0)
      .sort((a, b) => b.score - a.score);

    // Select top stocks
    const selectedStocks = scoredStocks.slice(0, this.maxStocks);
    const selectedSymbols = selectedStocks.map(s => s.symbol);

    // Update cache
    this.stockCache.stocks = selectedSymbols;
    this.stockCache.lastUpdated = Date.now();

    logger.info("Stock discovery complete", {
      evaluated: stockData.length,
      selected: selectedSymbols.length,
      stocks: selectedStocks.map(s => ({ symbol: s.symbol, score: s.score, volume: s.avgVolume })),
    });

    return selectedSymbols;
  }

  /**
   * Get detailed analysis of all evaluated stocks
   */
  async getStockAnalysis() {
    const allSymbols = [...new Set([...this.nseWatchlist, ...this.bankNiftyStocks])];
    const stockData = await this.fetchStockData(allSymbols);
    
    return stockData
      .map(stock => ({
        ...stock,
        score: this.scoreStock(stock),
        learningData: this.learningEngine?.evaluateSymbol(stock.symbol) || null,
      }))
      .filter(stock => stock.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Force refresh the stock cache
   */
  async refreshCache() {
    this.stockCache.lastUpdated = 0;
    return this.discoverStocks();
  }

  /**
   * Check if a specific symbol passes filters
   */
  async validateSymbol(symbol) {
    const stockData = await this.fetchStockData([symbol]);
    
    if (stockData.length === 0) {
      return { valid: false, reason: "failed_to_fetch_data" };
    }

    const stock = stockData[0];
    const score = this.scoreStock(stock);
    
    if (score <= 0) {
      return {
        valid: false,
        reason: "failed_filters",
        details: {
          price: stock.price,
          avgVolume: stock.avgVolume,
          avgDailyRangePct: stock.avgDailyRangePct,
          minVolume: this.minVolume,
          priceRange: `${this.minPrice}-${this.maxPrice}`,
        },
      };
    }

    return {
      valid: true,
      score,
      details: stock,
    };
  }
}

/**
 * Build a stock picker with environment configuration
 */
export function buildStockPicker(env, learningEngine = null) {
  return new StockPicker({
    minVolume: env.stockPickerMinVolume,
    minPrice: env.stockPickerMinPrice,
    maxPrice: env.stockPickerMaxPrice,
    maxStocks: env.stockPickerMaxStocks,
    learningEngine,
  });
}
