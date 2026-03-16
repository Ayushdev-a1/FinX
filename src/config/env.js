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

    // Broker - Angel One
    angelOneApiKey: process.env.ANGEL_ONE_API_KEY || "",
    angelOneClientId: process.env.ANGEL_ONE_CLIENT_ID || "",
    angelOnePassword: process.env.ANGEL_ONE_PASSWORD || "",
    angelOneTotpSecret: process.env.ANGEL_ONE_TOTP_SECRET || "",
    angelOneJwtToken: process.env.ANGEL_ONE_JWT_TOKEN || "",
    angelOneRefreshToken: process.env.ANGEL_ONE_REFRESH_TOKEN || "",

    // Dynamic stock discovery
    enableDynamicStockPicker: process.env.ENABLE_DYNAMIC_STOCK_PICKER === "true",
    stockPickerMinVolume: Number(process.env.STOCK_PICKER_MIN_VOLUME || 500000),
    stockPickerMinPrice: Number(process.env.STOCK_PICKER_MIN_PRICE || 50),
    stockPickerMaxPrice: Number(process.env.STOCK_PICKER_MAX_PRICE || 5000),
    stockPickerMaxStocks: Number(process.env.STOCK_PICKER_MAX_STOCKS || 10),

    // Self-learning system
    enableSelfLearning: process.env.ENABLE_SELF_LEARNING !== "false",
    learningDataPath: process.env.LEARNING_DATA_PATH || "./data/learning",

    // AI Agent
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "llama-3.3-70b-versatile",
    agentHttpPort: process.env.AGENT_HTTP_PORT ? Number(process.env.AGENT_HTTP_PORT) : null,
  };
}
