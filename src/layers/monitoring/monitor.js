import { logger } from "../../utils/logger.js";

export class Monitor {
  constructor() {
    this.metrics = {
      ticksProcessed: 0,
      ordersAttempted: 0,
      ordersFilled: 0,
      riskRejected: 0,
      loopLatencyMs: 0,
    };
  }

  onTicks(count) {
    this.metrics.ticksProcessed += count;
  }

  onOrderAttempt() {
    this.metrics.ordersAttempted += 1;
  }

  onOrderFilled() {
    this.metrics.ordersFilled += 1;
  }

  onRiskReject() {
    this.metrics.riskRejected += 1;
  }

  setLatency(ms) {
    this.metrics.loopLatencyMs = Math.round(ms);
  }

  snapshot(extra = {}) {
    logger.info("monitor", { ...this.metrics, ...extra });
  }
}
