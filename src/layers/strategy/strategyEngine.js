const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function trendFollowing(features) {
  if (features.ma50 == null || features.ma200 == null) return 0;
  return features.ma50 > features.ma200 ? 0.5 : -0.5;
}

function meanReversion(features, price) {
  if (features.bollingerUpper == null || features.bollingerLower == null) return 0;
  if (price > features.bollingerUpper) return -0.5;
  if (price < features.bollingerLower) return 0.5;
  return 0;
}

function momentum(features) {
  if (features.rsi == null || features.macd == null) return 0;
  if (features.rsi > 60 && features.macd > 0) return 0.5;
  if (features.rsi < 40 && features.macd < 0) return -0.5;
  return 0;
}

function sentiment(features) {
  if (features.sentimentScore == null) return 0;
  return clamp(features.sentimentScore, -1, 1) * 0.3;
}

export class StrategyEngine {
  generateSignal({ symbol, price, features }) {
    const score = trendFollowing(features) + meanReversion(features, price) + momentum(features) + sentiment(features);
    const direction = score > 0.15 ? "BUY" : score < -0.15 ? "SELL" : "HOLD";

    return {
      symbol,
      direction,
      confidence: Number(clamp(Math.abs(score), 0, 1).toFixed(3)),
      score: Number(score.toFixed(3)),
    };
  }
}
