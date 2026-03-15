function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    out = values[i] * k + out * (1 - k);
  }
  return out;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d;
    else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function stddev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function buildFeatureVector(candles, sentimentScore = 0) {
  const closes = candles.map((c) => c.close);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 != null && ema26 != null ? ema12 - ema26 : null;
  const bbMid = sma(closes, 20);
  const bbStd = stddev(closes, 20);
  const bbUpper = bbMid != null && bbStd != null ? bbMid + 2 * bbStd : null;
  const bbLower = bbMid != null && bbStd != null ? bbMid - 2 * bbStd : null;
  const volSpike = candles.length > 20
    ? candles[candles.length - 1].volume / (candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20)
    : null;

  return {
    rsi: rsi14,
    macd,
    ma50,
    ma200,
    bollingerUpper: bbUpper,
    bollingerLower: bbLower,
    atr: atr(candles, 14),
    sentimentScore,
    volumeSpike: volSpike,
  };
}
