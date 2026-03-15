# Full Hedge-Fund Style Auto-Trading Architecture (Node.js)

This project is a production-style scaffold for automated trading with these layers:

1. Data Acquisition
2. Data Pipeline / Processing
3. Feature Engineering
4. Strategy Engine
5. Portfolio Construction
6. Risk Management
7. Execution Engine
8. Monitoring
9. Backtesting

## Quick start

```bash
cp .env.example .env
npm test
npm start
```

The app will ask for missing API keys interactively at startup.

## How It Works

On startup, the system:

1. **Bootstraps historical data** - Fetches 5 days of 1-minute candles from Yahoo Finance (Indian stocks) or Polygon (US stocks) to pre-populate indicators
2. **Computes indicators** - Calculates MA200, MA50, RSI, MACD, Bollinger Bands, ATR
3. **Generates signals** - Uses a multi-strategy engine (trend following, mean reversion, momentum, sentiment)
4. **Executes trades** - In paper mode, simulates fills; in live mode, routes to broker

The system requires at least 210 candles for the 200-period moving average. With historical data bootstrapping, trading can begin immediately on startup.

## API keys

- `GEMINI_API_KEY` (optional, enables AI-powered signal analysis with Google Gemini)
- `GEMINI_MODEL` (optional, Gemini model to use, defaults to `gemini-2.0-flash`)
- `POLYGON_API_KEY` (optional, for US stocks market data)
- `NEWS_API_KEY` (optional, else mock sentiment)
- `ZERODHA_API_KEY` and `ZERODHA_ACCESS_TOKEN` (required only in `TRADING_MODE=live`)

## Market Data Providers

The system automatically selects the appropriate market data provider based on the symbols:

- **Indian stocks** (`.NS` for NSE, `.BO` for BSE): Uses Yahoo Finance (free, no API key required)
- **US stocks**: Uses Polygon.io if `POLYGON_API_KEY` is set, otherwise falls back to mock data

Note: Polygon.io only supports US stock exchanges. For Indian stocks, the system automatically uses Yahoo Finance.

## Run backtest sample

```bash
npm run backtest:sample
```

## Run smoke tests

```bash
npm test
```

## Project structure

- `src/layers/data`: Market + news providers
- `src/layers/pipeline`: Tick normalization + OHLC building
- `src/layers/features`: RSI, MACD, MA, Bollinger, ATR
- `src/layers/strategy`: Multi-strategy signal engine
- `src/layers/portfolio`: Position sizing and state
- `src/layers/risk`: Pre-trade risk checks
- `src/layers/execution`: Paper/live broker execution adapters
- `src/layers/monitoring`: Metrics/log monitoring
- `src/layers/backtest`: Historical simulation module
- `src/core/tradingSystem.js`: End-to-end orchestration

## Important

This is an engineering scaffold, not financial advice.
Before any real-money deployment, add broker-grade auth flows, audit logging, robust retry logic, compliance checks, and exhaustive testing.

## Validating Bot Decisions

To verify that the trading bot is making correct decisions, the system provides a decision tracking feature accessible via HTTP:

### View Recent Decisions

When the HTTP monitoring server is enabled (`AGENT_HTTP_PORT=8000`), you can access:

```bash
# Get the last 20 decisions
curl http://localhost:8000/decisions

# Get specific number of decisions (max 100)
curl http://localhost:8000/decisions?limit=50
```

### Decision Response Format

Each decision includes:

```json
{
  "count": 5,
  "total": 25,
  "aiEnabled": true,
  "decisions": [
    {
      "timestamp": "2024-01-15T10:30:00.000Z",
      "symbol": "RELIANCE.NS",
      "price": 2450.50,
      "indicators": {
        "rsi": 65.2,
        "macd": 12.5,
        "ma50": 2400.0,
        "ma200": 2350.0,
        "bollingerUpper": 2500.0,
        "bollingerLower": 2300.0,
        "atr": 45.0,
        "sentimentScore": 0.3
      },
      "originalSignal": {
        "direction": "BUY",
        "confidence": 0.75,
        "score": 0.85
      },
      "aiDecision": {
        "action": "CONFIRM",
        "reason": "Strong trend with positive momentum",
        "confidence": 0.8
      },
      "finalSignal": {
        "direction": "BUY",
        "confidence": 0.75
      }
    }
  ]
}
```

### How to Validate Decisions

1. **Check Technical Indicators**: Compare the indicators (RSI, MACD, MA crossovers) with your own analysis
2. **Review AI Reasoning**: The `aiDecision.reason` field explains why the AI confirmed, downgraded, or vetoed a signal
3. **Compare Signals**: Check if the `finalSignal` matches your expectations given the market conditions
4. **Monitor Over Time**: Track decisions over multiple trading sessions to identify patterns

### AI Decision Actions

- **CONFIRM**: The AI agrees with the strategy engine's signal
- **DOWNGRADE**: The AI reduces confidence (e.g., due to conflicting indicators)
- **VETO**: The AI overrides the signal and forces HOLD (e.g., extreme risk detected)

When `GEMINI_API_KEY` is not set, AI analysis is disabled and the original strategy signals are used directly.
