import { logger } from "../../utils/logger.js";

export class PaperExecutionEngine {
  async execute(order) {
    const fill = {
      ...order,
      status: "FILLED",
      filledAt: Date.now(),
      brokerOrderId: `paper_${order.symbol}_${Date.now()}`,
      slippageBps: 2,
    };
    logger.info("Paper fill", fill);
    return fill;
  }
}

export class ZerodhaExecutionEngine {
  constructor(apiKey, accessToken) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  async execute(order) {
    // Stub for Kite Connect integration.
    // Replace this with official SDK/order endpoint calls.
    logger.info("Live order routed to Zerodha (stub)", {
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: order.price,
    });

    return {
      ...order,
      status: "ROUTED",
      filledAt: Date.now(),
      brokerOrderId: `kite_${order.symbol}_${Date.now()}`,
      slippageBps: null,
    };
  }
}

export function buildExecutionEngine(env) {
  if (env.tradingMode === "live") {
    if (!env.zerodhaApiKey || !env.zerodhaAccessToken) {
      throw new Error("Live mode requires ZERODHA_API_KEY and ZERODHA_ACCESS_TOKEN");
    }
    return new ZerodhaExecutionEngine(env.zerodhaApiKey, env.zerodhaAccessToken);
  }

  return new PaperExecutionEngine();
}
