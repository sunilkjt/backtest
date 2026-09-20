// MarketDataProvider abstraction. Every provider normalizes to:
// { timestamp(ms), open, high, low, close, volume }
// Never fabricate live data: on failure throw Error('Historical data unavailable from this provider.')

export const UNAVAILABLE = 'Historical data unavailable from this provider.';

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export class MarketDataProvider {
  constructor() {
    if (new.target === MarketDataProvider) throw new Error('Abstract');
  }
  get id() { return 'base'; }
  get label() { return 'Base'; }
  // eslint-disable-next-line no-unused-vars
  async getCandles({ symbol, ref, timeframe, limit = 300 }) { throw new Error(UNAVAILABLE); }
  // eslint-disable-next-line no-unused-vars
  async getPrice({ symbol, ref }) { return null; }
  async discover() { return []; }
}

export const TF_MS = { '15m': 15 * 60e3, '1h': 36e5, '4h': 4 * 36e5, '1d': 864e5, '1w': 7 * 864e5 };
const BINANCE_INTERVAL = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' };
const HL_INTERVAL = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' };

// ---------------- Hyperliquid (public perps market data, no keys) ----------------
export class HyperliquidProvider extends MarketDataProvider {
  get id() { return 'hyperliquid'; }
  get label() { return 'Hyperliquid'; }
  endpoint() { return 'https://api.hyperliquid.xyz/info'; }

  async discover() {
    try {
      const data = await fetchJson(this.endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' })
      });
      const universe = data?.universe || data?.[0]?.universe || [];
      return universe.map((u) => ({ symbol: u.name, ref: u.name, maxLeverage: u.maxLeverage })).slice(0, 60);
    } catch {
      return [];
    }
  }

  async getPrice({ ref }) {
    const data = await fetchJson(this.endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' })
    });
    const mids = data?.mids || data;
    if (mids && mids[ref] != null) return parseFloat(mids[ref]);
    return null;
  }

  async getCandles({ ref, timeframe, limit = 300 }) {
    const interval = HL_INTERVAL[timeframe];
    if (!interval) throw new Error(UNAVAILABLE);
    const step = TF_MS[timeframe];
    const endTime = Date.now();
    const startTime = endTime - limit * step;
    let data;
    try {
      data = await fetchJson(this.endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'candle', req: { coin: ref, interval, startTime, endTime } })
      });
    } catch (e) {
      throw new Error(UNAVAILABLE);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) throw new Error(UNAVAILABLE);
    const candles = rows.map((r) => ({
      timestamp: r.t ?? r.T ?? r.time ?? r.startTime,
      open: parseFloat(r.o ?? r.open),
      high: parseFloat(r.h ?? r.high),
      low: parseFloat(r.l ?? r.low),
      close: parseFloat(r.c ?? r.close),
      volume: parseFloat(r.v ?? r.volume ?? 0)
    })).filter((c) => Number.isFinite(c.close));
    if (!candles.length) throw new Error(UNAVAILABLE);
    return candles.slice(-limit);
  }
}

// ---------------- Crypto via Binance public spot klines (no key, CORS-open) ----------------
export class CryptoProvider extends MarketDataProvider {
  get id() { return 'crypto'; }
  get label() { return 'Crypto (Binance Spot)'; }

  async getCandles({ ref, timeframe, limit = 300 }) {
    const interval = BINANCE_INTERVAL[timeframe];
    if (!interval) throw new Error(UNAVAILABLE);
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(ref)}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch {
      throw new Error(UNAVAILABLE);
    }
    if (!Array.isArray(data) || !data.length) throw new Error(UNAVAILABLE);
    return data.map((k) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  }

  async getPrice({ ref }) {
    try {
      const data = await fetchJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(ref)}`);
      return data?.price ? parseFloat(data.price) : null;
    } catch { return null; }
  }
}

// ---------------- Yahoo Finance (Forex / Stocks / Commodities, all timeframes) ----------------
// Why Yahoo and not Stooq? Stooq's CSV endpoint sends no CORS headers and
// increasingly serves a bot-challenge page, so browser fetch() from GitHub
// Pages is blocked and users saw "Historical data unavailable". Yahoo has
// full intraday history but also no CORS headers, so we fetch it through a
// CORS-friendly proxy fallback (AllOrigins, then corsproxy.io). No keys.
const YAHOO_CONF = {
  '15m': { interval: '15m', range: '1mo', resample: 1 },
  '1h': { interval: '1h', range: '6mo', resample: 1 },
  '4h': { interval: '1h', range: '1y', resample: 4 },
  '1d': { interval: '1d', range: '5y', resample: 1 },
  '1w': { interval: '1wk', range: '10y', resample: 1 }
};

const STOOQ_TO_YAHOO = {
  eurusd: 'EURUSD=X', gbpusd: 'GBPUSD=X', usdjpy: 'JPY=X', audusd: 'AUDUSD=X', usdchf: 'CHF=X',
  'aapl.us': 'AAPL', 'msft.us': 'MSFT', 'nvda.us': 'NVDA', 'tsla.us': 'TSLA', 'amzn.us': 'AMZN',
  xauusd: 'GC=F', xagusd: 'SI=F', 'cl.f': 'CL=F', 'bz.f': 'BZ=F'
};

function yahooSymbol({ symbol, ref, yahoo }) {
  if (yahoo) return yahoo;
  const key = String(ref || '').toLowerCase();
  if (STOOQ_TO_YAHOO[key]) return STOOQ_TO_YAHOO[key];
  return symbol;
}

function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(UNAVAILABLE);
  if (result.meta?.message === 'Not Found' || json?.chart?.error) throw new Error(UNAVAILABLE);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const opens = q.open || [], highs = q.high || [], lows = q.low || [], closes = q.close || [], vols = q.volume || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    out.push({
      timestamp: ts[i] * 1000,
      open: Number.isFinite(opens[i]) ? opens[i] : close,
      high: Number.isFinite(highs[i]) ? highs[i] : close,
      low: Number.isFinite(lows[i]) ? lows[i] : close,
      close,
      volume: Number.isFinite(vols[i]) ? vols[i] : 0
    });
  }
  return out;
}

function resampleCandles(candles, factor) {
  if (!factor || factor <= 1) return candles;
  const out = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      timestamp: chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume || 0), 0)
    });
  }
  return out;
}

async function fetchYahooCandles(ySym, timeframe) {
  const conf = YAHOO_CONF[timeframe];
  if (!conf) throw new Error(UNAVAILABLE);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${conf.interval}&range=${conf.range}`;
  const attempts = [
    yahooUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`
  ];
  let lastErr = null;
  for (const url of attempts) {
    try {
      const json = await fetchJson(url, {}, 20000);
      const parsed = parseYahooChart(json);
      if (parsed.length >= 10) return resampleCandles(parsed, conf.resample);
      lastErr = new Error('empty');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr? new Error(UNAVAILABLE) : new Error(UNAVAILABLE);
}

// Stooq CSV kept as a last-resort fallback for daily/weekly.
function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, open, high, low, close, volume] = lines[i].split(',');
    if (!date || close === undefined) continue;
    const ts = Date.parse(date);
    if (Number.isNaN(ts)) continue;
    out.push({
      timestamp: ts,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      volume: volume ? parseFloat(volume) : 0
    });
  }
  return out.filter((c) => Number.isFinite(c.close));
}

class StooqProvider extends MarketDataProvider {
  stooqInterval(timeframe) {
    if (timeframe === '1d') return 'd';
    if (timeframe === '1w') return 'w';
    return null;
  }
  yahooFirst(req, timeframe, limit) {
    return fetchYahooCandles(yahooSymbol(req), timeframe).then((c) => c.slice(-limit));
  }
  async getCandles(req) {
    const { ref, timeframe, limit = 300 } = req;
    // 1) Yahoo covers every timeframe incl. intraday — try it first.
    try {
      return await this.yahooFirst(req, timeframe, limit);
    } catch {
      // 2) Fall back to Stooq daily/weekly for 1d/1w.
    }
    const i = this.stooqInterval(timeframe);
    if (!i) throw new Error(UNAVAILABLE);
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ref.toLowerCase())}&i=${i}`;
    let text;
    try {
      text = await fetchText(url);
    } catch {
      throw new Error(UNAVAILABLE);
    }
    if (!text || text.includes('Exceeded') || text.trim().split('\n').length < 5) throw new Error(UNAVAILABLE);
    const candles = parseStooqCsv(text);
    if (!candles.length) throw new Error(UNAVAILABLE);
    return candles.slice(-limit);
  }
  async getPrice(req) {
    // Prefer Yahoo quote (CORS-safe via proxy); Stooq last-resort.
    try {
      const ySym = yahooSymbol(req);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=5d`;
      const tries = [url, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`];
      for (const u of tries) {
        try {
          const json = await fetchJson(u, {}, 15000);
          const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v) => Number.isFinite(v));
          if (closes?.length) return closes[closes.length - 1];
          const meta = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (Number.isFinite(meta)) return meta;
        } catch { /* next */ }
      }
    } catch { /* fallback below */ }
    try {
      const text = await fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(req.ref.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`);
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) return null;
      const parts = lines[1].split(',');
      const close = parseFloat(parts[6]);
      return Number.isFinite(close) ? close : null;
    } catch { return null; }
  }
}

export class ForexProvider extends StooqProvider {
  get id() { return 'forex'; }
  get label() { return 'Forex (Yahoo Finance)'; }
}
export class StockProvider extends StooqProvider {
  get id() { return 'stocks'; }
  get label() { return 'Stocks (Yahoo Finance)'; }
}
export class CommodityProvider extends StooqProvider {
  get id() { return 'commodities'; }
  get label() { return 'Commodities (Yahoo Finance)'; }
}

export function providerForMarket(market) {
  switch (market) {
    case 'hyperliquid': return new HyperliquidProvider();
    case 'crypto': return new CryptoProvider();
    case 'forex': return new ForexProvider();
    case 'stocks': return new StockProvider();
    case 'commodities': return new CommodityProvider();
    default: return new CryptoProvider();
  }
}
