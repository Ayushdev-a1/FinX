import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { logger } from "../utils/logger.js";

export async function ensureApiKeys(env) {
  const rl = readline.createInterface({ input, output });
  try {
    if (!env.polygonApiKey) {
      const key = await rl.question("Enter POLYGON_API_KEY (or press Enter to use mock market data): ");
      if (key) process.env.POLYGON_API_KEY = key;
    }

    if (!env.newsApiKey) {
      const key = await rl.question("Enter NEWS_API_KEY (or press Enter to skip sentiment): ");
      if (key) process.env.NEWS_API_KEY = key;
    }

    if ((env.tradingMode || process.env.TRADING_MODE) === "live") {
      if (!env.zerodhaApiKey) {
        const key = await rl.question("Enter ZERODHA_API_KEY (required for live mode): ");
        if (key) process.env.ZERODHA_API_KEY = key;
      }
      if (!env.zerodhaAccessToken) {
        const key = await rl.question("Enter ZERODHA_ACCESS_TOKEN (required for live mode): ");
        if (key) process.env.ZERODHA_ACCESS_TOKEN = key;
      }
    }
  } finally {
    rl.close();
  }

  logger.info("API key bootstrap completed.");
}
