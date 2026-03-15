import { buildFeatureVector } from "../features/indicators.js";
import { StrategyEngine } from "../strategy/strategyEngine.js";

export function runBacktest({ symbol, candles, initialCapital = 1_000_000 }) {
  const strategy = new StrategyEngine();
  let cash = initialCapital;
  let qty = 0;

  for (let i = 210; i < candles.length; i += 1) {
    const window = candles.slice(0, i + 1);
    const price = window[window.length - 1].close;
    const features = buildFeatureVector(window, 0);
    const signal = strategy.generateSignal({ symbol, price, features });

    if (signal.direction === "BUY") {
      const buyQty = Math.floor((cash * 0.05 * signal.confidence) / price);
      if (buyQty > 0) {
        cash -= buyQty * price;
        qty += buyQty;
      }
    }

    if (signal.direction === "SELL") {
      const sellQty = Math.floor(qty * signal.confidence);
      if (sellQty > 0) {
        cash += sellQty * price;
        qty -= sellQty;
      }
    }
  }

  const lastPrice = candles[candles.length - 1]?.close || 0;
  const finalEquity = cash + qty * lastPrice;
  return {
    symbol,
    initialCapital,
    finalEquity,
    pnl: finalEquity - initialCapital,
    returnPct: initialCapital ? ((finalEquity - initialCapital) / initialCapital) * 100 : 0,
  };
}
