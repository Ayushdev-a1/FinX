export class PortfolioEngine {
  constructor({ initialCapital, maxPositionPct }) {
    this.cash = initialCapital;
    this.maxPositionPct = maxPositionPct;
    this.positions = new Map();
    this.equityPeak = initialCapital;
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || { qty: 0, avgPrice: 0 };
  }

  getEquity(lastPrices = new Map()) {
    let equity = this.cash;
    for (const [symbol, pos] of this.positions.entries()) {
      const px = lastPrices.get(symbol) || pos.avgPrice;
      equity += pos.qty * px;
    }
    this.equityPeak = Math.max(this.equityPeak, equity);
    return equity;
  }

  computeOrder(signal, price, lastPrices) {
    if (signal.direction === "HOLD") return null;

    const equity = this.getEquity(lastPrices);
    const targetValue = equity * this.maxPositionPct * signal.confidence;
    const qty = Math.floor(targetValue / price);

    if (qty <= 0) return null;

    return {
      symbol: signal.symbol,
      side: signal.direction,
      qty,
      price,
      notional: qty * price,
      confidence: signal.confidence,
    };
  }

  applyFill(order) {
    const pos = this.getPosition(order.symbol);

    if (order.side === "BUY") {
      const newQty = pos.qty + order.qty;
      const totalCost = pos.avgPrice * pos.qty + order.price * order.qty;
      pos.qty = newQty;
      pos.avgPrice = newQty > 0 ? totalCost / newQty : 0;
      this.cash -= order.qty * order.price;
    } else if (order.side === "SELL") {
      const sellQty = Math.min(order.qty, pos.qty);
      pos.qty -= sellQty;
      this.cash += sellQty * order.price;
      if (pos.qty === 0) pos.avgPrice = 0;
    }

    this.positions.set(order.symbol, pos);
  }
}
