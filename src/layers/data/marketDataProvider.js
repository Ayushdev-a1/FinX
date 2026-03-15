import { logger } from "../../utils/logger.js";

/**
 * Check if a symbol is an Indian stock (NSE or BSE).
 * NSE symbols end with .NS, BSE symbols end with .BO
 */
function isIndianSymbol(symbol) {
  return symbol.endsWith(".NS") || symbol.endsWith(".BO");
}

/**
 * Check if any symbol in the list is an Indian stock.
 */
function containsIndianSymbols(symbols) {
  return symbols.some(isIndianSymbol);
}

export class MockMarketDataProvider {
  constructor(symbols) {
    this.symbols = symbols;
    this.state = new Map(symbols.map((s) => [s, 100 + Math.random() * 1000]));
  }

  async getSnapshot() {
    const ts = Date.now();
    return this.symbols.map((symbol) => {
      const last = this.state.get(symbol) || 100;
      const drift = (Math.random() - 0.5) * (last * 0.01);
      const price = Math.max(1, last + drift);
      const volume = Math.floor(50_000 + Math.random() * 150_000);
      const bid = price * 0.999;
      const ask = price * 1.001;

      this.state.set(symbol, price);

      return {
        symbol,
        timestamp: ts,
        price,
        bid,
        ask,
        volume,
      };
    });
  }

  /**
   * Generate mock historical candles for bootstrapping.
   * @param {number} count - Number of candles to generate per symbol
   * @returns {Promise<Map<string, Array>>} Map of symbol to candle array
   */
  async getHistoricalCandles(count = 250) {
    const result = new Map();
    const now = Date.now();
    const intervalMs = 60_000; // 1 minute candles

    for (const symbol of this.symbols) {
      const candles = [];
      let price = this.state.get(symbol) || 100;

      for (let i = count - 1; i >= 0; i--) {
        const timestamp = now - i * intervalMs;
        const drift = (Math.random() - 0.48) * (price * 0.005);
        const open = price;
        const close = Math.max(1, price + drift);
        const high = Math.max(open, close) * (1 + Math.random() * 0.002);
        const low = Math.min(open, close) * (1 - Math.random() * 0.002);
        const volume = Math.floor(50_000 + Math.random() * 150_000);

        candles.push({ timestamp, open, high, low, close, volume });
        price = close;
      }

      this.state.set(symbol, price);
      result.set(symbol, candles);
    }

    return result;
  }
}

/**
 * Yahoo Finance provider for market data.
 * Supports Indian stocks (.NS, .BO) and US stocks.
 * Uses the free Yahoo Finance API via query endpoints.
 */
export class YahooFinanceProvider {
  constructor(symbols) {
    this.symbols = symbols;
    this.fallback = new MockMarketDataProvider(symbols);
  }

  async getSnapshot() {
    try {
      const snapshots = [];
      for (const symbol of this.symbols) {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        
        if (!res.ok) {
          throw new Error(`Yahoo Finance request failed for ${symbol}: ${res.status}`);
        }
        
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        const meta = result?.meta;
        
        if (!meta || !meta.regularMarketPrice) {
          throw new Error(`No Yahoo Finance data for ${symbol}`);
        }

        const price = meta.regularMarketPrice;
        const volume = meta.regularMarketVolume || 0;
        const dayHigh = meta.regularMarketDayHigh || price;
        const dayLow = meta.regularMarketDayLow || price;

        snapshots.push({
          symbol,
          timestamp: Date.now(),
          price,
          bid: dayLow,
          ask: dayHigh,
          volume,
        });
      }
      return snapshots;
    } catch (err) {
      logger.warn(`Yahoo Finance provider failed, falling back to mock data: ${err?.message || err}`);
      return this.fallback.getSnapshot();
    }
  }

  /**
   * Fetch historical candle data from Yahoo Finance for bootstrapping indicators.
   * Fetches 5-day 1-minute data to ensure we have enough for MA200.
   * @returns {Promise<Map<string, Array>>} Map of symbol to candle array
   */
  async getHistoricalCandles() {
    const result = new Map();

    for (const symbol of this.symbols) {
      try {
        // Fetch 5 days of 1-minute data (Yahoo allows up to 7 days for 1m interval)
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5d`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        if (!res.ok) {
          throw new Error(`Yahoo Finance historical request failed for ${symbol}: ${res.status}`);
        }

        const json = await res.json();
        const chartResult = json?.chart?.result?.[0];
        
        if (!chartResult) {
          throw new Error(`No Yahoo Finance historical data for ${symbol}`);
        }

        const timestamps = chartResult.timestamp || [];
        const quotes = chartResult.indicators?.quote?.[0] || {};
        const { open, high, low, close, volume } = quotes;

        const candles = [];
        for (let i = 0; i < timestamps.length; i++) {
          // Skip if any value is null (market closed periods)
          if (open?.[i] == null || close?.[i] == null) continue;

          candles.push({
            timestamp: timestamps[i] * 1000, // Convert to milliseconds
            open: open[i],
            high: high?.[i] ?? open[i],
            low: low?.[i] ?? open[i],
            close: close[i],
            volume: volume?.[i] ?? 0,
          });
        }

        logger.info(`Loaded ${candles.length} historical candles for ${symbol}`);
        result.set(symbol, candles);
      } catch (err) {
        logger.warn(`Failed to fetch historical data for ${symbol}, using mock: ${err?.message || err}`);
        // Fall back to mock historical data for this symbol
        const mockCandles = await this.fallback.getHistoricalCandles(250);
        result.set(symbol, mockCandles.get(symbol) || []);
      }
    }

    return result;
  }
}

export class PolygonMarketDataProvider {
  constructor(apiKey, symbols) {
    this.apiKey = apiKey;
    this.symbols = symbols;
    this.fallback = new MockMarketDataProvider(symbols);
  }

  async getSnapshot() {
    try {
      const snapshots = [];
      for (const symbol of this.symbols) {
        const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${this.apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Polygon request failed for ${symbol}: ${res.status}`);
        }
        const json = await res.json();
        const row = json?.results?.[0];
        if (!row) throw new Error(`No Polygon data for ${symbol}`);

        snapshots.push({
          symbol,
          timestamp: row.t || Date.now(),
          price: row.c,
          bid: row.l,
          ask: row.h,
          volume: row.v,
        });
      }
      return snapshots;
    } catch (err) {
      logger.warn(`Polygon provider failed, falling back to mock data: ${err?.message || err}`);
      return this.fallback.getSnapshot();
    }
  }

  /**
   * Fetch historical candle data from Polygon for bootstrapping indicators.
   * @returns {Promise<Map<string, Array>>} Map of symbol to candle array
   */
  async getHistoricalCandles() {
    const result = new Map();
    const now = Date.now();
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;
    const fromDate = new Date(fiveDaysAgo).toISOString().split("T")[0];
    const toDate = new Date(now).toISOString().split("T")[0];

    for (const symbol of this.symbols) {
      try {
        const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=5000&apiKey=${this.apiKey}`;
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`Polygon historical request failed for ${symbol}: ${res.status}`);
        }

        const json = await res.json();
        const rows = json?.results || [];

        const candles = rows.map((r) => ({
          timestamp: r.t,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: r.v,
        }));

        logger.info(`Loaded ${candles.length} historical candles for ${symbol}`);
        result.set(symbol, candles);
      } catch (err) {
        logger.warn(`Failed to fetch historical data for ${symbol}, using mock: ${err?.message || err}`);
        const mockCandles = await this.fallback.getHistoricalCandles(250);
        result.set(symbol, mockCandles.get(symbol) || []);
      }
    }

    return result;
  }
}

export function buildMarketDataProvider(env) {
  const symbols = env.symbols;
  
  // For Indian stocks (.NS, .BO), use Yahoo Finance as it supports them
  // Polygon.io does not support Indian stock exchanges
  if (containsIndianSymbols(symbols)) {
    logger.info("Detected Indian stocks, using Yahoo Finance market data provider.");
    return new YahooFinanceProvider(symbols);
  }
  
  // For US stocks, prefer Polygon if API key is available
  if (env.polygonApiKey) {
    logger.info("Using Polygon market data provider.");
    return new PolygonMarketDataProvider(env.polygonApiKey, symbols);
  }

  logger.warn("No market data API configured, using mock market data provider.");
  return new MockMarketDataProvider(symbols);
}
