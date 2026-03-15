export class DataPipeline {
  constructor() {
    this.history = new Map();
  }

  normalizeTicks(rawTicks) {
    return rawTicks
      .filter((t) => Number.isFinite(t.price) && Number.isFinite(t.volume))
      .map((t) => ({
        symbol: t.symbol,
        timestamp: Number(t.timestamp),
        price: Number(t.price),
        bid: Number(t.bid || t.price),
        ask: Number(t.ask || t.price),
        volume: Number(t.volume),
      }));
  }

  appendHistory(ticks, maxPoints = 5000) {
    for (const tick of ticks) {
      const arr = this.history.get(tick.symbol) || [];
      arr.push(tick);
      if (arr.length > maxPoints) arr.splice(0, arr.length - maxPoints);
      this.history.set(tick.symbol, arr);
    }
  }

  computeOhlc(symbol, timeframeMs = 60_000, lookbackBars = 300) {
    const ticks = this.history.get(symbol) || [];
    if (!ticks.length) return [];

    const buckets = new Map();
    for (const t of ticks) {
      const bucketTs = Math.floor(t.timestamp / timeframeMs) * timeframeMs;
      const b = buckets.get(bucketTs) || {
        timestamp: bucketTs,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: 0,
      };

      b.high = Math.max(b.high, t.price);
      b.low = Math.min(b.low, t.price);
      b.close = t.price;
      b.volume += t.volume;
      buckets.set(bucketTs, b);
    }

    return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-lookbackBars);
  }
}
