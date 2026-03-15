import { runBacktest } from "../src/layers/backtest/backtester.js";

function generateCandles(count = 500) {
  const candles = [];
  let price = 1000;
  for (let i = 0; i < count; i += 1) {
    const ts = Date.now() - (count - i) * 60_000;
    const drift = (Math.random() - 0.48) * 8;
    const open = price;
    const close = Math.max(1, price + drift);
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    const volume = 50_000 + Math.floor(Math.random() * 100_000);
    candles.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const result = runBacktest({ symbol: "RELIANCE.NS", candles: generateCandles() });
console.log("Sample backtest result:", result);
