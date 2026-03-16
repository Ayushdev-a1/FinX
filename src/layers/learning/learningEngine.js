import fs from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger.js";

/**
 * LearningEngine - Analyzes historical trades to learn which signal patterns are profitable
 * 
 * Features analyzed:
 * - Signal direction and confidence effectiveness
 * - Technical indicator combinations that lead to profitable trades
 * - Agent actions (CONFIRM/DOWNGRADE/VETO) accuracy
 * - Symbol-specific performance patterns
 */
export class LearningEngine {
  constructor(tradeTracker, dataPath = "./data/learning") {
    this.tradeTracker = tradeTracker;
    this.dataPath = dataPath;
    
    // Learning models (simple statistical models)
    this.signalEffectiveness = new Map(); // direction+confidence bucket -> win rate
    this.featurePatterns = new Map(); // feature pattern -> outcome statistics
    this.agentAccuracy = { confirm: { total: 0, wins: 0 }, downgrade: { total: 0, wins: 0 }, veto: { total: 0, wins: 0 } };
    this.symbolPerformance = new Map(); // symbol -> performance metrics
    
    // Confidence adjustments learned from data
    this.confidenceAdjustments = new Map();
    
    // Minimum trades needed before making recommendations
    this.minTradesForLearning = 10;
    
    this._loadLearningData();
  }

  _getLearningFilePath() {
    return path.join(this.dataPath, "learning_model.json");
  }

  _loadLearningData() {
    try {
      const filePath = this._getLearningFilePath();
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        
        if (data.signalEffectiveness) {
          this.signalEffectiveness = new Map(Object.entries(data.signalEffectiveness));
        }
        if (data.featurePatterns) {
          this.featurePatterns = new Map(Object.entries(data.featurePatterns));
        }
        if (data.agentAccuracy) {
          this.agentAccuracy = data.agentAccuracy;
        }
        if (data.symbolPerformance) {
          this.symbolPerformance = new Map(Object.entries(data.symbolPerformance));
        }
        if (data.confidenceAdjustments) {
          this.confidenceAdjustments = new Map(Object.entries(data.confidenceAdjustments));
        }
        
        logger.info("Loaded learning model data");
      }
    } catch (err) {
      logger.warn("Failed to load learning model", { error: err?.message });
    }
  }

  _saveLearningData() {
    try {
      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
      }
      
      const filePath = this._getLearningFilePath();
      const data = {
        signalEffectiveness: Object.fromEntries(this.signalEffectiveness),
        featurePatterns: Object.fromEntries(this.featurePatterns),
        agentAccuracy: this.agentAccuracy,
        symbolPerformance: Object.fromEntries(this.symbolPerformance),
        confidenceAdjustments: Object.fromEntries(this.confidenceAdjustments),
        lastUpdated: new Date().toISOString(),
      };
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.warn("Failed to save learning model", { error: err?.message });
    }
  }

  /**
   * Analyze all closed trades and update learning models
   */
  learn() {
    const trades = this.tradeTracker.getClosedTrades({ limit: 10000 });
    
    if (trades.length < this.minTradesForLearning) {
      logger.info("Not enough trades for learning", { count: trades.length, required: this.minTradesForLearning });
      return;
    }

    // Reset models
    this.signalEffectiveness.clear();
    this.featurePatterns.clear();
    this.symbolPerformance.clear();
    this.agentAccuracy = { confirm: { total: 0, wins: 0 }, downgrade: { total: 0, wins: 0 }, veto: { total: 0, wins: 0 } };

    for (const trade of trades) {
      this._analyzeTrade(trade);
    }

    // Calculate confidence adjustments based on learned patterns
    this._calculateConfidenceAdjustments();
    
    // Persist learning data
    this._saveLearningData();
    
    logger.info("Learning complete", {
      tradesAnalyzed: trades.length,
      signalPatterns: this.signalEffectiveness.size,
      featurePatterns: this.featurePatterns.size,
    });
  }

  _analyzeTrade(trade) {
    const signal = trade.entrySignal;
    const features = trade.entryFeatures;
    const profitable = trade.profitable;

    // 1. Analyze signal effectiveness by direction and confidence bucket
    const confidenceBucket = this._getConfidenceBucket(signal?.confidence || 0);
    const signalKey = `${signal?.direction || "UNKNOWN"}_${confidenceBucket}`;
    
    const signalStats = this.signalEffectiveness.get(signalKey) || { total: 0, wins: 0, totalPnl: 0 };
    signalStats.total += 1;
    if (profitable) signalStats.wins += 1;
    signalStats.totalPnl += trade.pnl;
    signalStats.winRate = signalStats.wins / signalStats.total;
    signalStats.avgPnl = signalStats.totalPnl / signalStats.total;
    this.signalEffectiveness.set(signalKey, signalStats);

    // 2. Analyze feature patterns
    if (features) {
      const patternKey = this._getFeaturePattern(features);
      const patternStats = this.featurePatterns.get(patternKey) || { total: 0, wins: 0, totalPnl: 0 };
      patternStats.total += 1;
      if (profitable) patternStats.wins += 1;
      patternStats.totalPnl += trade.pnl;
      patternStats.winRate = patternStats.wins / patternStats.total;
      this.featurePatterns.set(patternKey, patternStats);
    }

    // 3. Analyze agent action accuracy
    if (trade.agentAction) {
      const action = trade.agentAction.toLowerCase();
      if (this.agentAccuracy[action]) {
        this.agentAccuracy[action].total += 1;
        if (profitable) this.agentAccuracy[action].wins += 1;
      }
    }

    // 4. Track symbol-specific performance
    const symbolStats = this.symbolPerformance.get(trade.symbol) || { total: 0, wins: 0, totalPnl: 0 };
    symbolStats.total += 1;
    if (profitable) symbolStats.wins += 1;
    symbolStats.totalPnl += trade.pnl;
    symbolStats.winRate = symbolStats.wins / symbolStats.total;
    symbolStats.avgPnl = symbolStats.totalPnl / symbolStats.total;
    this.symbolPerformance.set(trade.symbol, symbolStats);
  }

  _getConfidenceBucket(confidence) {
    if (confidence >= 0.8) return "HIGH";
    if (confidence >= 0.6) return "MEDIUM";
    if (confidence >= 0.4) return "LOW";
    return "VERY_LOW";
  }

  _getFeaturePattern(features) {
    // Create a simplified feature pattern for grouping similar market conditions
    const pattern = [];
    
    if (features.rsi != null) {
      if (features.rsi > 70) pattern.push("RSI_OVERBOUGHT");
      else if (features.rsi < 30) pattern.push("RSI_OVERSOLD");
      else pattern.push("RSI_NEUTRAL");
    }
    
    if (features.macd != null) {
      if (features.macd > 0) pattern.push("MACD_POSITIVE");
      else pattern.push("MACD_NEGATIVE");
    }
    
    if (features.ma50 != null && features.ma200 != null) {
      if (features.ma50 > features.ma200) pattern.push("TREND_UP");
      else pattern.push("TREND_DOWN");
    }
    
    if (features.volumeSpike != null) {
      if (features.volumeSpike > 2) pattern.push("HIGH_VOLUME");
      else if (features.volumeSpike < 0.5) pattern.push("LOW_VOLUME");
      else pattern.push("NORMAL_VOLUME");
    }
    
    return pattern.join("_") || "UNKNOWN";
  }

  _calculateConfidenceAdjustments() {
    // For each signal pattern, calculate a confidence adjustment factor
    for (const [key, stats] of this.signalEffectiveness.entries()) {
      if (stats.total < 5) continue; // Need minimum samples
      
      // If win rate is significantly better or worse than expected, adjust confidence
      const expectedWinRate = 0.5; // Baseline expectation
      const deviation = stats.winRate - expectedWinRate;
      
      // Adjustment factor: boost or reduce confidence based on historical performance
      let adjustment = 1.0;
      if (deviation > 0.1) {
        adjustment = 1.0 + (deviation * 0.5); // Boost confidence for good patterns
      } else if (deviation < -0.1) {
        adjustment = 1.0 + (deviation * 0.5); // Reduce confidence for poor patterns
      }
      
      this.confidenceAdjustments.set(key, {
        adjustment: Number(adjustment.toFixed(3)),
        basedOnTrades: stats.total,
        historicalWinRate: stats.winRate,
      });
    }
  }

  /**
   * Apply learned adjustments to a signal
   */
  adjustSignal(signal, features) {
    const confidenceBucket = this._getConfidenceBucket(signal.confidence);
    const signalKey = `${signal.direction}_${confidenceBucket}`;
    
    const adjustment = this.confidenceAdjustments.get(signalKey);
    
    if (!adjustment || adjustment.basedOnTrades < 5) {
      // Not enough data to make adjustments
      return signal;
    }

    const adjustedConfidence = Math.min(1, Math.max(0, signal.confidence * adjustment.adjustment));
    
    // Log significant adjustments
    if (Math.abs(adjustedConfidence - signal.confidence) > 0.05) {
      logger.info("Learning adjustment applied", {
        symbol: signal.symbol,
        originalConfidence: signal.confidence,
        adjustedConfidence: Number(adjustedConfidence.toFixed(3)),
        historicalWinRate: adjustment.historicalWinRate,
      });
    }

    return {
      ...signal,
      confidence: Number(adjustedConfidence.toFixed(3)),
      learningAdjustment: adjustment.adjustment,
      historicalWinRate: adjustment.historicalWinRate,
    };
  }

  /**
   * Evaluate if a symbol is worth trading based on historical performance
   */
  evaluateSymbol(symbol) {
    const stats = this.symbolPerformance.get(symbol);
    
    if (!stats || stats.total < this.minTradesForLearning) {
      return { tradeable: true, reason: "insufficient_data", confidence: 0.5 };
    }

    // Avoid symbols with consistent losses
    if (stats.winRate < 0.3 && stats.total >= 20) {
      return { 
        tradeable: false, 
        reason: "poor_historical_performance", 
        winRate: stats.winRate,
        confidence: 0,
      };
    }

    // Boost symbols with good performance
    let confidence = 0.5;
    if (stats.winRate > 0.6) confidence = 0.8;
    else if (stats.winRate > 0.5) confidence = 0.6;
    else if (stats.winRate < 0.4) confidence = 0.3;

    return {
      tradeable: true,
      reason: "historical_data_available",
      winRate: stats.winRate,
      avgPnl: stats.avgPnl,
      totalTrades: stats.total,
      confidence,
    };
  }

  /**
   * Get recommendations for which symbols to focus on
   */
  getSymbolRecommendations() {
    const recommendations = [];
    
    for (const [symbol, stats] of this.symbolPerformance.entries()) {
      if (stats.total < 5) continue;
      
      recommendations.push({
        symbol,
        winRate: Number(stats.winRate.toFixed(4)),
        avgPnl: Number(stats.avgPnl.toFixed(2)),
        totalTrades: stats.total,
        score: stats.winRate * (1 + Math.min(stats.avgPnl / 1000, 1)), // Composite score
      });
    }
    
    // Sort by score (best performing first)
    recommendations.sort((a, b) => b.score - a.score);
    
    return recommendations;
  }

  /**
   * Get agent performance analysis
   */
  getAgentPerformance() {
    const result = {};
    
    for (const [action, stats] of Object.entries(this.agentAccuracy)) {
      if (stats.total > 0) {
        result[action] = {
          total: stats.total,
          wins: stats.wins,
          winRate: Number((stats.wins / stats.total).toFixed(4)),
        };
      }
    }
    
    return result;
  }

  /**
   * Get overall learning insights
   */
  getLearningInsights() {
    const signalInsights = [];
    
    for (const [key, stats] of this.signalEffectiveness.entries()) {
      if (stats.total >= 5) {
        signalInsights.push({
          pattern: key,
          winRate: Number(stats.winRate.toFixed(4)),
          avgPnl: Number(stats.avgPnl.toFixed(2)),
          totalTrades: stats.total,
        });
      }
    }
    
    const featureInsights = [];
    for (const [key, stats] of this.featurePatterns.entries()) {
      if (stats.total >= 5) {
        featureInsights.push({
          pattern: key,
          winRate: Number(stats.winRate.toFixed(4)),
          totalTrades: stats.total,
        });
      }
    }
    
    return {
      signalPatterns: signalInsights.sort((a, b) => b.winRate - a.winRate),
      featurePatterns: featureInsights.sort((a, b) => b.winRate - a.winRate),
      agentPerformance: this.getAgentPerformance(),
      symbolRecommendations: this.getSymbolRecommendations().slice(0, 10),
    };
  }
}
