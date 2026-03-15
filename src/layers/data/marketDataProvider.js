import { logger } from "../../utils/logger.js";

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
  if (env.polygonApiKey) {
    logger.info("Using Polygon market data provider.");
    return new PolygonMarketDataProvider(env.polygonApiKey, env.symbols);
  }

  logger.warn("POLYGON_API_KEY missing, using mock market data provider.");
  return new MockMarketDataProvider(env.symbols);
}
