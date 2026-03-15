const required = ["TRADING_MODE"];

export function getEnv() {
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    tradingMode: process.env.TRADING_MODE || "paper", // paper | live
    symbols: (process.env.SYMBOLS || "RELIANCE.NS,TATASTEEL.NS,HDFCBANK.NS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 15000),
    maxPositionPct: Number(process.env.MAX_POSITION_PCT || 0.05),
    maxLossPerTradePct: Number(process.env.MAX_LOSS_PER_TRADE_PCT || 0.01),
    maxDailyDrawdownPct: Number(process.env.MAX_DAILY_DRAWDOWN_PCT || 0.03),
    maxSectorExposurePct: Number(process.env.MAX_SECTOR_EXPOSURE_PCT || 0.2),
    initialCapital: Number(process.env.INITIAL_CAPITAL || 1_000_000),

    // Data providers
    polygonApiKey: process.env.POLYGON_API_KEY || "",
    newsApiKey: process.env.NEWS_API_KEY || "",

    // Broker
    zerodhaApiKey: process.env.ZERODHA_API_KEY || "",
    zerodhaAccessToken: process.env.ZERODHA_ACCESS_TOKEN || "",

    // AI Agent
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    agentHttpPort: process.env.AGENT_HTTP_PORT ? Number(process.env.AGENT_HTTP_PORT) : null,
  };
}
