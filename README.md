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

## API keys

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
