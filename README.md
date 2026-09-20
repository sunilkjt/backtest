# 🤖 AI Trading Lab

**Test. Analyze. Understand. Trade Smarter.**

A browser-based trading laboratory: download real historical market data, backtest rule-based strategies, compare them, view trades on the chart, analyze performance, and generate transparent BUY / SELL / NEUTRAL signals with ICT/SMC confluence scoring.

Live site (GitHub Pages): **https://sunilkjt.github.io/backtest/**

> No backend. No private keys. No API keys in the browser. All calculations run locally in your browser.

## Features

- **Markets:** Crypto (Binance Vision spot klines), Hyperliquid perps incl. **stocks/FX/commodities via the xyz HIP-3 DEX** (`xyz:AAPL`, `xyz:GOLD`…), Forex / Stocks / Commodities spot (Yahoo Finance, all timeframes incl. intraday)
- **Timeframes:** 15m, 1h, 4h, 1d, 1w
- **8 strategies:** SMA Cross, EMA+RSI Trend, MACD Momentum, Bollinger Mean-Reversion, RSI Reversion, Donchian Breakout, Supertrend, ICT/SMC Smart Money
- **Real backtest engine:** fees, slippage, ATR stops, R-multiple take-profits, long/short, fractional risk sizing, equity curve, 15+ stats
- **Signal Lab:** confluence score 0–100 with every reason listed (no black box)
- **ICT/SMC:** swings, liquidity sweeps, BOS/CHOCH, order blocks, FVG, premium/discount
- **Compare mode:** run every strategy on the same data
- **Exports:** trades CSV, full JSON, one-click summary copy
- **Demo mode:** deterministic simulated data, always labelled — never passed off as live data

## Market-data abstraction

```
MarketDataProvider
├── HyperliquidProvider  (https://api.hyperliquid.xyz, POST /info)
├── CryptoProvider       (https://data-api.binance.vision, spot klines)
├── ForexProvider        (https://stooq.com CSV)
├── StockProvider        (https://stooq.com CSV)
└── CommodityProvider    (https://stooq.com CSV)
```

All providers normalize to `{ timestamp, open, high, low, close, volume }`.
If a provider cannot supply the requested data the UI shows **“Historical data unavailable from this provider.”** and offers clearly-labelled demo data.

Never enter wallet seed phrases or private keys. This app never asks for them.

## Local development

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Deploy

Push to `main` — `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages automatically. `vite.config.js` sets `base: '/backtest/'` so all assets work under the project sub-path.

## Disclaimer

Educational software. Not financial advice. Backtests are hypothetical and do not guarantee future results.
