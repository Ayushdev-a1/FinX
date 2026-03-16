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
10. **Self-Learning System** *(NEW)*
11. **Dynamic Stock Picker** *(NEW)*

## Key Features

- **Self-Learning Evaluation System**: The bot automatically learns which signals were profitable and improves over time by adjusting signal confidence based on historical performance
- **Dynamic Stock Picker**: Instead of hardcoded stocks, the bot evaluates and picks the best stocks for intraday trading based on volume, volatility, and historical performance
- **Angel One Integration**: Live trading support via Angel One SmartAPI (replacing Zerodha Kite)
- **Multi-Strategy Engine**: Combines trend following, mean reversion, momentum, and sentiment analysis
- **AI Signal Analysis**: Optional AI-powered signal enhancement using LLM providers

## Quick start

```bash
cp .env.example .env
npm test
npm start
```

The app will ask for missing API keys interactively at startup.

## How It Works

On startup, the system:

1. **Discovers tradeable stocks** (if enabled) - Evaluates NSE stocks based on volume, price range, volatility, and historical performance
2. **Bootstraps historical data** - Fetches 5 days of 1-minute candles from Yahoo Finance (Indian stocks) or Polygon (US stocks) to pre-populate indicators
3. **Computes indicators** - Calculates MA200, MA50, RSI, MACD, Bollinger Bands, ATR
4. **Generates signals** - Uses a multi-strategy engine (trend following, mean reversion, momentum, sentiment)
5. **Applies learning adjustments** - Adjusts signal confidence based on historical trade outcomes
6. **Executes trades** - In paper mode, simulates fills; in live mode, routes to Angel One
7. **Tracks and learns** - Records trade outcomes and periodically updates the learning model

The system requires at least 210 candles for the 200-period moving average. With historical data bootstrapping, trading can begin immediately on startup.

## Self-Learning System

The bot includes a self-learning evaluation system that:

### How It Works

1. **Trade Tracking**: Every trade entry and exit is recorded with associated signals, features, and outcomes
2. **Pattern Analysis**: The learning engine analyzes which signal patterns (direction + confidence level) lead to profitable trades
3. **Feature Learning**: Identifies which technical indicator combinations work best
4. **Confidence Adjustment**: Automatically boosts or reduces signal confidence based on historical win rates
5. **Symbol Evaluation**: Tracks per-symbol performance and can exclude consistently losing stocks

### Learning API Endpoints

When the HTTP server is enabled (`AGENT_HTTP_PORT=8000`):

```bash
# Get learning statistics and insights
curl http://localhost:8000/learning

# Get detailed trade history
curl http://localhost:8000/learning/trades
curl http://localhost:8000/learning/trades?limit=100
curl http://localhost:8000/learning/trades?profitable=true

# Get symbol recommendations
curl http://localhost:8000/learning/symbols

# Manually trigger a learning cycle
curl -X POST http://localhost:8000/learning/run
```

### Learning Response Example

```json
{
  "enabled": true,
  "tradeStats": {
    "totalTrades": 150,
    "profitableTrades": 95,
    "losingTrades": 55,
    "winRate": 0.6333,
    "totalPnl": 125000,
    "avgPnl": 833.33
  },
  "insights": {
    "signalPatterns": [
      { "pattern": "BUY_HIGH", "winRate": 0.72, "avgPnl": 1200, "totalTrades": 45 },
      { "pattern": "BUY_MEDIUM", "winRate": 0.58, "avgPnl": 650, "totalTrades": 62 }
    ],
    "featurePatterns": [
      { "pattern": "RSI_NEUTRAL_MACD_POSITIVE_TREND_UP", "winRate": 0.75, "totalTrades": 28 }
    ],
    "agentPerformance": {
      "confirm": { "total": 80, "wins": 55, "winRate": 0.6875 },
      "downgrade": { "total": 45, "wins": 22, "winRate": 0.4889 }
    },
    "symbolRecommendations": [
      { "symbol": "RELIANCE.NS", "winRate": 0.78, "avgPnl": 1500, "score": 0.95 }
    ]
  }
}
```

## Dynamic Stock Picker

Instead of hardcoding stock symbols, the bot can automatically discover and select the best stocks for intraday trading.

### Selection Criteria

- **Volume**: Minimum average daily volume (default: 500,000) for liquidity
- **Price Range**: Stocks within a configurable price range (default: ₹50-₹5000)
- **Volatility**: Average daily range suitable for intraday moves (1.5%-5% ideal)
- **Historical Performance**: Prioritizes stocks that have been profitable historically (if learning data available)

### Stock Picker API Endpoints

```bash
# Get current stocks and detailed analysis
curl http://localhost:8000/stocks

# Force refresh stock discovery
curl -X POST http://localhost:8000/stocks/refresh
```

### Configuration

```bash
ENABLE_DYNAMIC_STOCK_PICKER=true
STOCK_PICKER_MIN_VOLUME=500000    # Minimum average daily volume
STOCK_PICKER_MIN_PRICE=50          # Minimum stock price (₹)
STOCK_PICKER_MAX_PRICE=5000        # Maximum stock price (₹)
STOCK_PICKER_MAX_STOCKS=10         # Maximum stocks to track
```

## Angel One Broker Integration

For live trading, the system uses Angel One SmartAPI instead of Zerodha Kite.

### Setup

1. Create an account at [Angel One SmartAPI](https://smartapi.angelone.in/)
2. Generate your API credentials
3. Configure environment variables:

```bash
TRADING_MODE=live
ANGEL_ONE_API_KEY=your_api_key
ANGEL_ONE_CLIENT_ID=your_client_id
ANGEL_ONE_JWT_TOKEN=your_jwt_token
ANGEL_ONE_REFRESH_TOKEN=your_refresh_token
```

### Features

- Market order execution for intraday trading
- Position tracking
- Order status monitoring
- Automatic symbol conversion (Yahoo Finance format → Angel One format)

## API keys

- `GEMINI_API_KEY` (optional, API key for your OpenAI-compatible provider, e.g., Groq)
- `GEMINI_MODEL` (optional, model name for that provider, defaults to `llama-3.3-70b-versatile`)
- `POLYGON_API_KEY` (optional, for US stocks market data)
- `NEWS_API_KEY` (optional, else mock sentiment)
- `ANGEL_ONE_*` (required only in `TRADING_MODE=live`)

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
- `src/layers/execution`: Paper/Angel One broker execution adapters
- `src/layers/monitoring`: Metrics/log monitoring
- `src/layers/backtest`: Historical simulation module
- `src/layers/learning`: **Self-learning system** (TradeTracker, LearningEngine, StockPicker)
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
5. **Review Learning Insights**: Check `/learning` endpoint to see which patterns are working

### AI Decision Actions

- **CONFIRM**: The AI agrees with the strategy engine's signal
- **DOWNGRADE**: The AI reduces confidence (e.g., due to conflicting indicators)
- **VETO**: The AI overrides the signal and forces HOLD (e.g., extreme risk detected)

When `GEMINI_API_KEY` is not set, AI analysis is disabled and the original strategy signals are used directly.
