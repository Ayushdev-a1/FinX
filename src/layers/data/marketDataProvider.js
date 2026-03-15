import { logger } from "../../utils/logger.js";

/**
 * Check if a symbol is an Indian stock (NSE or BSE).
 * NSE symbols end with .NS, BSE symbols end with .BO
 */
function isIndianSymbol(symbol) {
  return symbol.endsWith(".NS") || symbol.endsWith(".BO");
}

/**
 * Check if all symbols in the list are Indian stocks.
 */
function hasIndianSymbols(symbols) {
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
}

export function buildMarketDataProvider(env) {
  const symbols = env.symbols;
  
  // For Indian stocks (.NS, .BO), use Yahoo Finance as it supports them
  // Polygon.io does not support Indian stock exchanges
  if (hasIndianSymbols(symbols)) {
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
