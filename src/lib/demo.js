// Deterministic demo candles. NEVER presented as live data — the UI always
// labels these "DEMO · simulated". Used when a provider is unreachable or
// the user explicitly toggles demo mode.

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TF_MS = { '15m': 15 * 60e3, '1h': 36e5, '4h': 4 * 36e5, '1d': 864e5, '1w': 7 * 864e5 };

export function generateDemoCandles(symbol, timeframe, n = 300, basePrice = 100) {
  const rnd = mulberry32(hashSeed(symbol + '|' + timeframe));
  const step = TF_MS[timeframe] || 36e5;
  const now = Date.now();
  const aligned = Math.floor(now / step) * step;
  // scale base price by asset so charts look realistic-ish
  const baseBySymbol = /BTC/i.test(symbol) ? 67000 : /ETH/i.test(symbol) ? 3500
    : /SOL/i.test(symbol) ? 170 : /BNB/i.test(symbol) ? 600
    : /XAU/i.test(symbol) ? 2380 : /XAG/i.test(symbol) ? 28
    : /JPY/i.test(symbol) ? 155 : /EUR|GBP|AUD/i.test(symbol) ? 1.08
    : /NVDA/i.test(symbol) ? 880 : /AAPL/i.test(symbol) ? 225
    : /MSFT/i.test(symbol) ? 425 : /TSLA/i.test(symbol) ? 175
    : /AMZN/i.test(symbol) ? 185 : basePrice;
  let price = baseBySymbol;
  const drift = 0.0004;
  const vol = 0.011;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = aligned - i * step;
    // regime shifts: sin drift + noise so strategies behave differently
    const regime = Math.sin((n - i) / 34) * 0.35;
    const shock = (rnd() - 0.5) * 2 * vol;
    const ret = drift * regime + shock;
    const open = price;
    const close = Math.max(open * (1 + ret), baseBySymbol * 0.05);
    const high = Math.max(open, close) * (1 + rnd() * vol * 0.5);
    const low = Math.min(open, close) * (1 - rnd() * vol * 0.5);
    const volume = Math.round(500 + rnd() * 4500 + Math.abs(ret) * 220000);
    out.push({ timestamp: t - (n - 1 - (n - 1 - i)) * 0, open, high, low, close, volume });
    // fix timestamp ordering (oldest first)
    out[out.length - 1].timestamp = aligned - i * step;
    price = close;
  }
  return out;
}
