// Asset universe + provider routing. Prices/decimals only affect display.

export const MARKETS = [
  { id: 'crypto', label: 'Crypto', icon: '₿' },
  { id: 'hyperliquid', label: 'Hyperliquid', icon: '⚡' },
  { id: 'forex', label: 'Forex', icon: '💱' },
  { id: 'stocks', label: 'Stocks', icon: '📈' },
  { id: 'commodities', label: 'Commodities', icon: '🛢️' }
];

export const TIMEFRAMES = [
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' }
];

// provider: which MarketDataProvider handles it
// ref: provider-native symbol
export const ASSETS = [
  // Crypto (Binance spot)
  { market: 'crypto', symbol: 'BTC', name: 'Bitcoin', ref: 'BTCUSDT', decimals: 1 },
  { market: 'crypto', symbol: 'ETH', name: 'Ethereum', ref: 'ETHUSDT', decimals: 2 },
  { market: 'crypto', symbol: 'SOL', name: 'Solana', ref: 'SOLUSDT', decimals: 2 },
  { market: 'crypto', symbol: 'BNB', name: 'BNB', ref: 'BNBUSDT', decimals: 2 },
  { market: 'crypto', symbol: 'XRP', name: 'XRP', ref: 'XRPUSDT', decimals: 4 },
  { market: 'crypto', symbol: 'DOGE', name: 'Dogecoin', ref: 'DOGEUSDT', decimals: 5 },
  { market: 'crypto', symbol: 'ADA', name: 'Cardano', ref: 'ADAUSDT', decimals: 4 },
  { market: 'crypto', symbol: 'AVAX', name: 'Avalanche', ref: 'AVAXUSDT', decimals: 2 },
  { market: 'crypto', symbol: 'LINK', name: 'Chainlink', ref: 'LINKUSDT', decimals: 2 },
  { market: 'crypto', symbol: 'SUI', name: 'Sui', ref: 'SUIUSDT', decimals: 4 },
  // Hyperliquid perps (core crypto + HIP-3 "xyz" builder DEX for equities/FX/commodities).
  // Everything in this market loads from Hyperliquid only (candleSnapshot).
  { market: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid', ref: 'HYPE', decimals: 2 },
  { market: 'hyperliquid', symbol: 'BTC', name: 'Bitcoin Perp', ref: 'BTC', decimals: 1 },
  { market: 'hyperliquid', symbol: 'ETH', name: 'Ethereum Perp', ref: 'ETH', decimals: 2 },
  { market: 'hyperliquid', symbol: 'SOL', name: 'Solana Perp', ref: 'SOL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'DOGE', name: 'Dogecoin Perp', ref: 'DOGE', decimals: 5 },
  { market: 'hyperliquid', symbol: 'SUI', name: 'Sui Perp', ref: 'SUI', decimals: 4 },
  // Hyperliquid-only stocks (xyz equity perps — 24/7, shorter history than spot)
  { market: 'hyperliquid', symbol: 'AAPL', name: 'Apple Perp (Hyperliquid xyz)', ref: 'xyz:AAPL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'MSFT', name: 'Microsoft Perp (Hyperliquid xyz)', ref: 'xyz:MSFT', decimals: 2 },
  { market: 'hyperliquid', symbol: 'NVDA', name: 'NVIDIA Perp (Hyperliquid xyz)', ref: 'xyz:NVDA', decimals: 2 },
  { market: 'hyperliquid', symbol: 'TSLA', name: 'Tesla Perp (Hyperliquid xyz)', ref: 'xyz:TSLA', decimals: 2 },
  { market: 'hyperliquid', symbol: 'AMZN', name: 'Amazon Perp (Hyperliquid xyz)', ref: 'xyz:AMZN', decimals: 2 },
  { market: 'hyperliquid', symbol: 'META', name: 'Meta Perp (Hyperliquid xyz)', ref: 'xyz:META', decimals: 2 },
  { market: 'hyperliquid', symbol: 'GOOGL', name: 'Alphabet Perp (Hyperliquid xyz)', ref: 'xyz:GOOGL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'AMD', name: 'AMD Perp (Hyperliquid xyz)', ref: 'xyz:AMD', decimals: 2 },
  // Hyperliquid-only forex / commodities / index (xyz perps)
  { market: 'hyperliquid', symbol: 'EUR', name: 'Euro FX Perp (Hyperliquid xyz)', ref: 'xyz:EUR', decimals: 5 },
  { market: 'hyperliquid', symbol: 'JPY', name: 'Yen FX Perp (Hyperliquid xyz)', ref: 'xyz:JPY', decimals: 3 },
  { market: 'hyperliquid', symbol: 'GOLD', name: 'Gold Perp (Hyperliquid xyz)', ref: 'xyz:GOLD', decimals: 2 },
  { market: 'hyperliquid', symbol: 'SILVER', name: 'Silver Perp (Hyperliquid xyz)', ref: 'xyz:SILVER', decimals: 3 },
  { market: 'hyperliquid', symbol: 'OIL.WTI', name: 'WTI Perp (Hyperliquid xyz)', ref: 'xyz:CL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'OIL.BRENT', name: 'Brent Perp (Hyperliquid xyz)', ref: 'xyz:BRENTOIL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'SP500', name: 'S&P 500 Perp (Hyperliquid xyz)', ref: 'xyz:SP500', decimals: 2 },
  // Forex (Yahoo Finance, CORS-safe via proxy fallback)
  { market: 'forex', symbol: 'EUR/USD', name: 'Euro / US Dollar', ref: 'eurusd', yahoo: 'EURUSD=X', decimals: 5 },
  { market: 'forex', symbol: 'GBP/USD', name: 'British Pound / US Dollar', ref: 'gbpusd', yahoo: 'GBPUSD=X', decimals: 5 },
  { market: 'forex', symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', ref: 'usdjpy', yahoo: 'JPY=X', decimals: 3 },
  { market: 'forex', symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', ref: 'audusd', yahoo: 'AUDUSD=X', decimals: 5 },
  { market: 'forex', symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', ref: 'usdchf', yahoo: 'CHF=X', decimals: 5 },
  // Stocks (Yahoo Finance)
  { market: 'stocks', symbol: 'AAPL', name: 'Apple Inc.', ref: 'aapl.us', yahoo: 'AAPL', decimals: 2 },
  { market: 'stocks', symbol: 'MSFT', name: 'Microsoft', ref: 'msft.us', yahoo: 'MSFT', decimals: 2 },
  { market: 'stocks', symbol: 'NVDA', name: 'NVIDIA', ref: 'nvda.us', yahoo: 'NVDA', decimals: 2 },
  { market: 'stocks', symbol: 'TSLA', name: 'Tesla', ref: 'tsla.us', yahoo: 'TSLA', decimals: 2 },
  { market: 'stocks', symbol: 'AMZN', name: 'Amazon', ref: 'amzn.us', yahoo: 'AMZN', decimals: 2 },
  // Commodities (Yahoo futures)
  { market: 'commodities', symbol: 'XAU/USD', name: 'Gold Spot', ref: 'xauusd', yahoo: 'GC=F', decimals: 2 },
  { market: 'commodities', symbol: 'XAG/USD', name: 'Silver Spot', ref: 'xagusd', yahoo: 'SI=F', decimals: 3 },
  { market: 'commodities', symbol: 'WTI', name: 'WTI Crude Oil', ref: 'cl.f', yahoo: 'CL=F', decimals: 2 },
  { market: 'commodities', symbol: 'BRENT', name: 'Brent Crude Oil', ref: 'bz.f', yahoo: 'BZ=F', decimals: 2 }
];

export function assetsForMarket(market) {
  return ASSETS.filter((a) => a.market === market);
}
