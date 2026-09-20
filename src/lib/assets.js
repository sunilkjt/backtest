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
  // Hyperliquid perps (coin names)
  { market: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid', ref: 'HYPE', decimals: 2 },
  { market: 'hyperliquid', symbol: 'BTC', name: 'Bitcoin Perp', ref: 'BTC', decimals: 1 },
  { market: 'hyperliquid', symbol: 'ETH', name: 'Ethereum Perp', ref: 'ETH', decimals: 2 },
  { market: 'hyperliquid', symbol: 'SOL', name: 'Solana Perp', ref: 'SOL', decimals: 2 },
  { market: 'hyperliquid', symbol: 'DOGE', name: 'Dogecoin Perp', ref: 'DOGE', decimals: 5 },
  { market: 'hyperliquid', symbol: 'SUI', name: 'Sui Perp', ref: 'SUI', decimals: 4 },
  // Forex (Stooq)
  { market: 'forex', symbol: 'EUR/USD', name: 'Euro / US Dollar', ref: 'eurusd', decimals: 5 },
  { market: 'forex', symbol: 'GBP/USD', name: 'British Pound / US Dollar', ref: 'gbpusd', decimals: 5 },
  { market: 'forex', symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', ref: 'usdjpy', decimals: 3 },
  { market: 'forex', symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', ref: 'audusd', decimals: 5 },
  { market: 'forex', symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', ref: 'usdchf', decimals: 5 },
  // Stocks (Stooq .us)
  { market: 'stocks', symbol: 'AAPL', name: 'Apple Inc.', ref: 'aapl.us', decimals: 2 },
  { market: 'stocks', symbol: 'MSFT', name: 'Microsoft', ref: 'msft.us', decimals: 2 },
  { market: 'stocks', symbol: 'NVDA', name: 'NVIDIA', ref: 'nvda.us', decimals: 2 },
  { market: 'stocks', symbol: 'TSLA', name: 'Tesla', ref: 'tsla.us', decimals: 2 },
  { market: 'stocks', symbol: 'AMZN', name: 'Amazon', ref: 'amzn.us', decimals: 2 },
  // Commodities (Stooq)
  { market: 'commodities', symbol: 'XAU/USD', name: 'Gold Spot', ref: 'xauusd', decimals: 2 },
  { market: 'commodities', symbol: 'XAG/USD', name: 'Silver Spot', ref: 'xagusd', decimals: 3 },
  { market: 'commodities', symbol: 'WTI', name: 'WTI Crude Oil', ref: 'cl.f', decimals: 2 },
  { market: 'commodities', symbol: 'BRENT', name: 'Brent Crude Oil', ref: 'bz.f', decimals: 2 }
];

export function assetsForMarket(market) {
  return ASSETS.filter((a) => a.market === market);
}
