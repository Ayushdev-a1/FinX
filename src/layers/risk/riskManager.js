export class RiskManager {
  constructor(config) {
    this.cfg = config;
  }

  validateOrder({ order, portfolio, priceBySymbol }) {
    const equity = portfolio.getEquity(priceBySymbol);
    const currentPos = portfolio.getPosition(order.symbol);

    const currentValue = currentPos.qty * order.price;
    const newValue = currentValue + (order.side === "BUY" ? order.notional : -order.notional);

    if (Math.abs(newValue) > equity * this.cfg.maxPositionPct) {
      return { ok: false, reason: "Position limit breached" };
    }

    const maxPerTradeLoss = order.notional * this.cfg.maxLossPerTradePct;
    if (maxPerTradeLoss > equity * this.cfg.maxLossPerTradePct) {
      return { ok: false, reason: "Per-trade risk breached" };
    }

    const dd = portfolio.equityPeak > 0 ? (portfolio.equityPeak - equity) / portfolio.equityPeak : 0;
    if (dd >= this.cfg.maxDailyDrawdownPct) {
      return { ok: false, reason: "Daily drawdown limit breached" };
    }

    return { ok: true };
  }
}
