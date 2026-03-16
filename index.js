import { loadDotEnv } from "./src/utils/envLoader.js";
import { getEnv } from "./src/config/env.js";
import { ensureApiKeys } from "./src/core/bootstrap.js";
import { TradingSystem } from "./src/core/tradingSystem.js";
import { Agent } from "./Agent.js";
import { logger } from "./src/utils/logger.js";

async function main() {
  loadDotEnv();

  if (!process.env.TRADING_MODE) process.env.TRADING_MODE = "paper";

  let env = getEnv();
  await ensureApiKeys(env);

  // Reload env after optional interactive key input.
  env = getEnv();

  const agent = new Agent({
    apiKey: env.geminiApiKey,
    model: env.geminiModel,
    httpPort: env.agentHttpPort,
  });

  const system = new TradingSystem(env, agent);
  agent.attach(system);
  agent.startHttpServer();

  await system.start();

  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    agent.stopHttpServer();
    system.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", err?.stack || err);
  process.exit(1);
});
