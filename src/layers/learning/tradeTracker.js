import fs from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger.js";

/**
 * TradeTracker - Records all trades with their entry/exit points and P&L
 * This data is used by the learning engine to evaluate signal profitability
 */
export class TradeTracker {
  constructor(dataPath = "./data/learning") {
    this.dataPath = dataPath;
    this.openTrades = new Map(); // symbol -> trade record
    this.closedTrades = []; // Array of completed trades
    this.maxClosedTrades = 10000;
    
    this._ensureDataDir();
    this._loadHistory();
  }

  _ensureDataDir() {
    try {
      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
      }
    } catch (err) {
      logger.warn("Failed to create learning data directory", { error: err?.message });
    }
  }

  _getTradesFilePath() {
    return path.join(this.dataPath, "trades.json");
  }

  _loadHistory() {
    try {
      const filePath = this._getTradesFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        this.closedTrades = data.closedTrades || [];
        logger.info(`Loaded ${this.closedTrades.length} historical trades for learning`);
      }
    } catch (err) {
      logger.warn("Failed to load trade history", { error: err?.message });
    }
  }

  _saveHistory() {
    try {
      const filePath = this._getTradesFilePath();
      const data = {
        closedTrades: this.closedTrades.slice(-this.maxClosedTrades),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.warn("Failed to save trade history", { error: err?.message });
    }
  }

  /**
   * Record a new trade entry
   */
  recordEntry({ symbol, side, qty, price, signal, features, agentAction, agentReason }) {
    const trade = {
      id: `${symbol}_${Date.now()}`,
      symbol,
      side,
      entryQty: qty,
      entryPrice: price,
      entryTime: Date.now(),
      entrySignal: signal,
      entryFeatures: { ...features },
      agentAction: agentAction || null,
      agentReason: agentReason || null,
      status: "OPEN",
    };

    this.openTrades.set(symbol, trade);
    logger.info("Trade entry recorded", { id: trade.id, symbol, side, price });
    
    return trade;
  }

  /**
   * Record trade exit and calculate P&L
   */
  recordExit({ symbol, exitQty, exitPrice, exitReason = "signal" }) {
    const trade = this.openTrades.get(symbol);
    if (!trade) {
      logger.warn("No open trade found for exit", { symbol });
      return null;
    }

    const qtyToClose = Math.min(exitQty, trade.entryQty);
    
    // Calculate P&L
    let pnl;
    if (trade.side === "BUY") {
      pnl = (exitPrice - trade.entryPrice) * qtyToClose;
    } else {
      pnl = (trade.entryPrice - exitPrice) * qtyToClose;
    }

    const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.side === "BUY" ? 1 : -1);

    const closedTrade = {
      ...trade,
      exitQty: qtyToClose,
      exitPrice,
      exitTime: Date.now(),
      exitReason,
      holdingTimeMs: Date.now() - trade.entryTime,
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(4)),
      profitable: pnl > 0,
      status: "CLOSED",
    };

    // If partially closed, update open trade
    if (qtyToClose < trade.entryQty) {
      trade.entryQty -= qtyToClose;
    } else {
      this.openTrades.delete(symbol);
    }

    this.closedTrades.push(closedTrade);
    
    // Trim history if needed
    if (this.closedTrades.length > this.maxClosedTrades) {
      this.closedTrades = this.closedTrades.slice(-this.maxClosedTrades);
    }

    // Persist to disk
    this._saveHistory();

    logger.info("Trade exit recorded", {
      id: closedTrade.id,
      symbol,
      pnl: closedTrade.pnl,
      pnlPct: closedTrade.pnlPct,
      profitable: closedTrade.profitable,
    });

    return closedTrade;
  }

  /**
   * Get open trade for a symbol
   */
  getOpenTrade(symbol) {
    return this.openTrades.get(symbol) || null;
  }

  /**
   * Get all open trades
   */
  getOpenTrades() {
    return Array.from(this.openTrades.values());
  }

  /**
   * Get closed trades with optional filters
   */
  getClosedTrades({ symbol = null, limit = 100, profitable = null } = {}) {
    let trades = [...this.closedTrades];
    
    if (symbol) {
      trades = trades.filter(t => t.symbol === symbol);
    }
    
    if (profitable !== null) {
      trades = trades.filter(t => t.profitable === profitable);
    }
    
    return trades.slice(-limit).reverse();
  }

  /**
   * Get statistics for a specific symbol
   */
  getSymbolStats(symbol) {
    const trades = this.closedTrades.filter(t => t.symbol === symbol);
    
    if (trades.length === 0) {
      return null;
    }

    const profitable = trades.filter(t => t.profitable);
    const losses = trades.filter(t => !t.profitable);
    
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnl = totalPnl / trades.length;
    const avgWin = profitable.length > 0 
      ? profitable.reduce((sum, t) => sum + t.pnl, 0) / profitable.length 
      : 0;
    const avgLoss = losses.length > 0 
      ? losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length 
      : 0;

    return {
      symbol,
      totalTrades: trades.length,
      profitableTrades: profitable.length,
      losingTrades: losses.length,
      winRate: profitable.length / trades.length,
      totalPnl: Number(totalPnl.toFixed(2)),
      avgPnl: Number(avgPnl.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      profitFactor: Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : avgWin > 0 ? Infinity : 0,
    };
  }

  /**
   * Get overall trading statistics
   */
  getOverallStats() {
    const trades = this.closedTrades;
    
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0,
      };
    }

    const profitable = trades.filter(t => t.profitable);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

    return {
      totalTrades: trades.length,
      profitableTrades: profitable.length,
      losingTrades: trades.length - profitable.length,
      winRate: Number((profitable.length / trades.length).toFixed(4)),
      totalPnl: Number(totalPnl.toFixed(2)),
      avgPnl: Number((totalPnl / trades.length).toFixed(2)),
    };
  }
}
