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

/**
 * Angel One SmartAPI Execution Engine
 * Uses Angel One's SmartAPI for live order execution
 * Documentation: https://smartapi.angelone.in/docs
 */
export class AngelOneExecutionEngine {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.clientId = config.clientId;
    this.jwtToken = config.jwtToken;
    this.refreshToken = config.refreshToken;
    this.baseUrl = "https://apiconnect.angelone.in";
  }

  /**
   * Convert symbol from Yahoo format to Angel One format
   * e.g., RELIANCE.NS -> RELIANCE-EQ (NSE equity)
   */
  convertSymbol(yahooSymbol) {
    const cleanSymbol = yahooSymbol.replace(/\.(NS|BO)$/, "");
    // For NSE stocks, add -EQ suffix (equity segment)
    if (yahooSymbol.endsWith(".NS")) {
      return { symbol: cleanSymbol, exchange: "NSE", tradingSymbol: `${cleanSymbol}-EQ` };
    }
    // For BSE stocks
    if (yahooSymbol.endsWith(".BO")) {
      return { symbol: cleanSymbol, exchange: "BSE", tradingSymbol: cleanSymbol };
    }
    return { symbol: cleanSymbol, exchange: "NSE", tradingSymbol: `${cleanSymbol}-EQ` };
  }

  async execute(order) {
    const symbolInfo = this.convertSymbol(order.symbol);
    
    const orderPayload = {
      variety: "NORMAL",
      tradingsymbol: symbolInfo.tradingSymbol,
      symboltoken: "", // Will need symbol token lookup in production
      transactiontype: order.side === "BUY" ? "BUY" : "SELL",
      exchange: symbolInfo.exchange,
      ordertype: "MARKET",
      producttype: "INTRADAY", // For intraday trading
      duration: "DAY",
      price: "0",
      squareoff: "0",
      stoploss: "0",
      quantity: String(order.qty),
    };

    try {
      const res = await fetch(`${this.baseUrl}/rest/secure/angelbroking/order/v1/placeOrder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": this.apiKey,
          "Authorization": `Bearer ${this.jwtToken}`,
        },
        body: JSON.stringify(orderPayload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Angel One API error: ${res.status} - ${errorText}`);
      }

      const json = await res.json();

      if (json.status === false || json.errorcode) {
        throw new Error(`Angel One order failed: ${json.message || json.errorcode}`);
      }

      logger.info("Live order executed via Angel One", {
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        price: order.price,
        orderId: json.data?.orderid,
      });

      return {
        ...order,
        status: "ROUTED",
        filledAt: Date.now(),
        brokerOrderId: json.data?.orderid || `angel_${order.symbol}_${Date.now()}`,
        slippageBps: null,
        brokerResponse: json,
      };
    } catch (err) {
      logger.error("Angel One order execution failed", {
        error: err?.message || err,
        order,
      });

      // Return as pending for retry or manual intervention
      return {
        ...order,
        status: "FAILED",
        filledAt: Date.now(),
        brokerOrderId: `angel_failed_${order.symbol}_${Date.now()}`,
        error: err?.message || "Unknown error",
      };
    }
  }

  /**
   * Get order status from Angel One
   */
  async getOrderStatus(orderId) {
    try {
      const res = await fetch(`${this.baseUrl}/rest/secure/angelbroking/order/v1/getOrderBook`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-PrivateKey": this.apiKey,
          "Authorization": `Bearer ${this.jwtToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to get order status: ${res.status}`);
      }

      const json = await res.json();
      const orders = json.data || [];
      return orders.find(o => o.orderid === orderId) || null;
    } catch (err) {
      logger.warn("Failed to get order status from Angel One", { error: err?.message });
      return null;
    }
  }

  /**
   * Get positions for the day
   */
  async getPositions() {
    try {
      const res = await fetch(`${this.baseUrl}/rest/secure/angelbroking/order/v1/getPosition`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-PrivateKey": this.apiKey,
          "Authorization": `Bearer ${this.jwtToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to get positions: ${res.status}`);
      }

      const json = await res.json();
      return json.data || [];
    } catch (err) {
      logger.warn("Failed to get positions from Angel One", { error: err?.message });
      return [];
    }
  }
}

export function buildExecutionEngine(env) {
  if (env.tradingMode === "live") {
    if (!env.angelOneApiKey || !env.angelOneJwtToken) {
      throw new Error("Live mode requires ANGEL_ONE_API_KEY and ANGEL_ONE_JWT_TOKEN");
    }
    return new AngelOneExecutionEngine({
      apiKey: env.angelOneApiKey,
      clientId: env.angelOneClientId,
      jwtToken: env.angelOneJwtToken,
      refreshToken: env.angelOneRefreshToken,
    });
  }

  return new PaperExecutionEngine();
}
