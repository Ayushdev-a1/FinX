import { loadDotEnv } from "./src/utils/envLoader.js";
import { getEnv } from "./src/config/env.js";
import { ensureApiKeys } from "./src/core/bootstrap.js";
import { TradingSystem } from "./src/core/tradingSystem.js";
import { logger } from "./src/utils/logger.js";

async function main() {
  loadDotEnv();

  if (!process.env.TRADING_MODE) process.env.TRADING_MODE = "paper";

  let env = getEnv();
  await ensureApiKeys(env);

  // Reload env after optional interactive key input.
  env = getEnv();

  const system = new TradingSystem(env);
  await system.start();

  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    system.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", err?.stack || err);
  process.exit(1);
});
