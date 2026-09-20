// Rule-based strategies. Each exposes:
// { id, name, tagline, description, params, entry, exit, signal(candles, ind, i, p) }
// `p` carries user-set parameter values (defaults from `params` when absent).
// Signals are computed bar-by-bar so the backtester and the live signal lab
// share identical logic (no lookahead: only data up to index i).

import { sma, macd as macdInd, bollinger as bollingerInd, donchian as donchianInd, supertrend as supertrendInd } from './indicators.js';

function P(key, label, def, min, max, step) {
  return { key, label, def, min, max, step };
}

export function defaultsFor(strategy) {
  const out = {};
  for (const p of strategy.params || []) out[p.key] = p.def;
  return out;
}

// Per-series cache so parameter variants (e.g. SMA 20/100) are computed once
// per dataset instead of once per bar. Trailing-only math — no lookahead.
const _cache = new WeakMap();
function cached(candles, key, fn) {
  let m = _cache.get(candles);
  if (!m) { m = new Map(); _cache.set(candles, m); }
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}
function closesOf(candles) {
  return cached(candles, '__closes', () => candles.map((c) => c.close));
}
function highsOf(candles) {
  return cached(candles, '__highs', () => candles.map((c) => c.high));
}
function lowsOf(candles) {
  return cached(candles, '__lows', () => candles.map((c) => c.low));
}

export const STRATEGIES = [
  {
    id: 'sma-cross',
    name: 'SMA Crossover',
    tagline: 'Golden / Death cross of SMA 50 / 200',
    description: 'Classic trend-following: long when SMA-50 crosses above SMA-200, exit/short on the opposite cross.',
    params: [P('fast', 'Fast SMA', 50, 5, 200, 1), P('slow', 'Slow SMA', 200, 20, 400, 1)],
    entry: 'SMA-fast crosses above SMA-slow → LONG. Crosses below → SHORT.',
    exit: 'Opposite cross, ATR stop, or R-multiple target (risk settings).',
    signal(c, ind, i, p = {}) {
      const fast = Math.max(2, Math.round(p.fast ?? 50));
      const slow = Math.max(fast + 1, Math.round(p.slow ?? 200));
      const cl = closesOf(c);
      const A = cached(c, `sma:${fast}`, () => sma(cl, fast));
      const B = cached(c, `sma:${slow}`, () => sma(cl, slow));
      const a = A[i], b = B[i], pa = A[i - 1], pb = B[i - 1];
      if (a == null || b == null || pa == null || pb == null) return 0;
      if (pa <= pb && a > b) return 1;
      if (pa >= pb && a < b) return -1;
      return 0;
    }
  },
  {
    id: 'ema-rsi',
    name: 'EMA Trend + RSI Filter',
    tagline: 'EMA 20/50 trend with RSI momentum gate',
    description: 'Long when EMA-20 > EMA-50 and RSI above the long gate. Short when EMA-20 < EMA-50 and RSI below the short gate. Filters chop.',
    params: [P('rsiLong', 'RSI long gate', 55, 50, 70, 1), P('rsiShort', 'RSI short gate', 45, 30, 50, 1)],
    entry: 'Trend side from EMA 20/50 + RSI beyond the gate.',
    exit: 'Opposite signal, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const f = ind.ema20[i], s = ind.ema50[i], r = ind.rsi[i];
      const gL = p.rsiLong ?? 55, gS = p.rsiShort ?? 45;
      if (f == null || s == null || r == null) return 0;
      if (f > s && r > gL) return 1;
      if (f < s && r < gS) return -1;
      return 0;
    }
  },
  {
    id: 'macd',
    name: 'MACD Momentum',
    tagline: 'MACD line / signal cross + histogram',
    description: 'Long on bullish MACD cross with positive histogram; short on bearish cross.',
    params: [P('fast', 'Fast EMA', 12, 5, 30, 1), P('slow', 'Slow EMA', 26, 10, 60, 1), P('signal', 'Signal EMA', 9, 3, 30, 1)],
    entry: 'MACD line crosses signal in the histogram direction.',
    exit: 'Opposite cross, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const fast = Math.max(2, Math.round(p.fast ?? 12));
      const slow = Math.max(fast + 1, Math.round(p.slow ?? 26));
      const sig = Math.max(2, Math.round(p.signal ?? 9));
      const M = cached(c, `macd:${fast}/${slow}/${sig}`, () => macdInd(closesOf(c), fast, slow, sig));
      const m = M.macdLine[i], s = M.signalLine[i], h = M.hist[i];
      const pm = M.macdLine[i - 1], ps = M.signalLine[i - 1];
      if (m == null || s == null || pm == null || ps == null) return 0;
      if (pm <= ps && m > s && (h ?? 0) > 0) return 1;
      if (pm >= ps && m < s && (h ?? 0) < 0) return -1;
      return 0;
    }
  },
  {
    id: 'bollinger',
    name: 'Bollinger Mean Reversion',
    tagline: 'Fade the bands, target the midline',
    description: 'Long when price closes below the lower band, short above the upper band. Mean-reversion.',
    params: [P('period', 'Band period', 20, 10, 50, 1), P('mult', 'StdDev multiple', 2, 1, 3, 0.5)],
    entry: 'Close outside the band → fade toward the midline.',
    exit: 'Opposite band tag, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const per = Math.max(5, Math.round(p.period ?? 20));
      const mult = p.mult ?? 2;
      const B = cached(c, `bb:${per}/${mult}`, () => bollingerInd(closesOf(c), per, mult));
      const up = B.upper[i], lo = B.lower[i];
      if (up == null || lo == null) return 0;
      if (c[i].close < lo) return 1;
      if (c[i].close > up) return -1;
      return 0;
    }
  },
  {
    id: 'rsi-rev',
    name: 'RSI Reversion',
    tagline: 'Buy oversold, sell overbought',
    description: 'Long when RSI crosses back above the oversold level; short when it crosses back below the overbought level.',
    params: [P('oversold', 'Oversold level', 30, 10, 40, 1), P('overbought', 'Overbought level', 70, 60, 90, 1)],
    entry: 'RSI reclaims oversold from below → LONG. Loses overbought from above → SHORT.',
    exit: 'Opposite reclaim, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const os = p.oversold ?? 30, ob = p.overbought ?? 70;
      const r = ind.rsi[i], pr = ind.rsi[i - 1];
      if (r == null || pr == null) return 0;
      if (pr <= os && r > os) return 1;
      if (pr >= ob && r < ob) return -1;
      return 0;
    }
  },
  {
    id: 'donchian',
    name: 'Donchian Breakout',
    tagline: '20-bar channel breakout + ADX gate',
    description: 'Long on channel-high breakout with ADX above the gate; short on channel-low breakdown.',
    params: [P('channel', 'Channel bars', 20, 10, 60, 1), P('adxMin', 'Min ADX', 12, 0, 40, 1)],
    entry: 'Close beyond the channel with trend strength confirmed.',
    exit: 'Opposite breakout, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const ch = Math.max(5, Math.round(p.channel ?? 20));
      const gate0 = p.adxMin ?? 12;
      const D = cached(c, `don:${ch}`, () => donchianInd(highsOf(c), lowsOf(c), ch));
      const up = D.upper[i - 1], lo = D.lower[i - 1];
      const adx = ind.adx[i];
      if (up == null || lo == null) return 0;
      const gate = adx == null || adx > gate0;
      if (c[i].close > up && gate) return 1;
      if (c[i].close < lo && gate) return -1;
      return 0;
    }
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    tagline: 'ATR trailing-stop flip system',
    description: 'Follows Supertrend direction flips. Cuts losers fast, rides trends.',
    params: [P('atrPeriod', 'ATR period', 10, 5, 30, 1), P('mult', 'ATR multiple', 3, 1, 6, 0.5)],
    entry: 'Supertrend flips: to bullish → LONG, to bearish → SHORT.',
    exit: 'Opposite flip, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const per = Math.max(2, Math.round(p.atrPeriod ?? 10));
      const mult = p.mult ?? 3;
      const S = cached(c, `st:${per}/${mult}`, () => supertrendInd(highsOf(c), lowsOf(c), closesOf(c), per, mult));
      const d = S.direction[i], pd = S.direction[i - 1];
      if (d == null || pd == null) return 0;
      if (pd === -1 && d === 1) return 1;
      if (pd === 1 && d === -1) return -1;
      return 0;
    }
  },
  {
    id: 'multi',
    name: 'Multi-Indicator Vote',
    tagline: 'EMA + RSI + MACD + Supertrend ballot',
    description: 'Each indicator casts one vote. 3+ net votes in a direction trigger the trade — no single indicator rules.',
    params: [P('votes', 'Votes required', 3, 2, 4, 1)],
    entry: 'Net votes ≥ threshold → LONG. Net votes ≤ −threshold → SHORT.',
    exit: 'Vote flip, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const need = Math.max(2, Math.min(4, Math.round(p.votes ?? 3)));
      let v = 0, n = 0;
      const vote = (x) => { n++; v += x; };
      if (ind.ema20[i] != null && ind.ema50[i] != null) vote(ind.ema20[i] > ind.ema50[i] ? 1 : -1);
      if (ind.rsi[i] != null) { if (ind.rsi[i] > 52) vote(1); else if (ind.rsi[i] < 48) vote(-1); else n++; }
      if (ind.macdLine[i] != null && ind.signalLine[i] != null) vote(ind.macdLine[i] > ind.signalLine[i] ? 1 : -1);
      if (ind.stDir[i] != null) vote(ind.stDir[i]);
      if (n < 3) return 0;
      if (v >= need) return 1;
      if (v <= -need) return -1;
      return 0;
    }
  },
  {
    id: 'sweep-rev',
    name: 'ICT Liquidity Sweep',
    tagline: 'Sweep of equal highs/lows + reclaim',
    description: 'Long when price sweeps below a recent swing low and reclaims it within 3 bars. Short on the mirror. Pure sweep-reclaim, no displacement needed.',
    params: [P('lookback', 'Swing lookback', 10, 5, 30, 1), P('reclaimBars', 'Reclaim window', 3, 1, 6, 1)],
    entry: 'Wick beyond swing + close back inside within the window.',
    exit: 'Opposite sweep, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const lb = Math.max(5, Math.round(p.lookback ?? 10));
      const win = Math.max(1, Math.round(p.reclaimBars ?? 3));
      if (i < lb + 2) return 0;
      for (let k = Math.max(1, i - win); k <= i; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = Math.max(0, k - lb); j < k - 1; j++) {
          if (c[j].low < lo) lo = c[j].low;
          if (c[j].high > hi) hi = c[j].high;
        }
        if (c[k].low < lo && c[k].close > lo) return 1;
        if (c[k].high > hi && c[k].close < hi) return -1;
      }
      return 0;
    }
  },
  {
    id: 'ict-fvg',
    name: 'ICT FVG Entry',
    tagline: 'Trade away from fresh imbalances',
    description: 'Long when a bullish FVG formed in the last 5 bars and price holds above EMA-50. Short on bearish FVG below EMA-50.',
    params: [P('window', 'FVG lookback', 5, 2, 15, 1)],
    entry: 'Fresh 3-candle imbalance + EMA-50 trend filter.',
    exit: 'Opposite FVG, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const win = Math.max(2, Math.round(p.window ?? 5));
      if (i < 6) return 0;
      const e50 = ind.ema50[i];
      for (let k = Math.max(2, i - win); k <= i; k++) {
        const a = c[k - 2], b = c[k];
        if (b.low > a.high && (e50 == null || c[i].close > e50)) return 1;
        if (b.high < a.low && (e50 == null || c[i].close < e50)) return -1;
      }
      return 0;
    }
  },
  {
    id: 'ict-ob',
    name: 'ICT Order Block',
    tagline: 'Tap into the block, ride displacement',
    description: 'Long when price taps a recent bullish order block and prints displacement up. Short on the mirror.',
    params: [P('lookback', 'OB lookback', 12, 5, 30, 1)],
    entry: 'Wick into active OB + displacement candle (body > 60% of range).',
    exit: 'OB violation close, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const lb = Math.max(5, Math.round(p.lookback ?? 12));
      if (i < 4) return 0;
      const cur = c[i];
      const body = Math.abs(cur.close - cur.open);
      const range = cur.high - cur.low || 1e-9;
      if (body / range < 0.6) return 0;
      const up = cur.close > cur.open;
      for (let j = Math.max(1, i - lb); j < i; j++) {
        const p = c[j];
        const pUp = p.close > p.open;
        if (up === pUp) continue;
        const top = Math.max(p.open, p.close), bot = Math.min(p.open, p.close);
        if (up && cur.low <= top && cur.close > top && (ind.ema50[i] == null || cur.close > ind.ema50[i])) return 1;
        if (!up && cur.high >= bot && cur.close < bot && (ind.ema50[i] == null || cur.close < ind.ema50[i])) return -1;
      }
      return 0;
    }
  },
  {
    id: 'smc-bos',
    name: 'SMC Structure Break',
    tagline: 'Trade the BOS / CHOCH itself',
    description: 'Long on a bullish BOS/CHOCH (close beyond the last swing high) within 3 bars. Short on the bearish mirror.',
    params: [P('swingLR', 'Swing strength', 3, 2, 8, 1)],
    entry: 'Close beyond the most recent opposite fractal swing.',
    exit: 'Opposite break, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const lr = Math.max(2, Math.min(8, Math.round(p.swingLR ?? 3)));
      if (i < lr + 7) return 0;
      // last fractal swing high/low before bar i
      let swH = null, swL = null;
      for (let j = i - (lr + 5); j < i - 1; j++) {
        if (j < lr) continue;
        let isH = true, isL = true;
        for (let k = j - lr; k <= j + lr; k++) {
          if (k === j || k >= i) continue;
          if (c[k].high > c[j].high) isH = false;
          if (c[k].low < c[j].low) isL = false;
        }
        if (isH) swH = c[j].high;
        if (isL) swL = c[j].low;
      }
      if (swH != null && c[i].close > swH && c[i - 1].close <= swH) return 1;
      if (swL != null && c[i].close < swL && c[i - 1].close >= swL) return -1;
      return 0;
    }
  },
  {
    id: 'ict-smc',
    name: 'ICT / SMC Smart Money',
    tagline: 'Sweep + displacement + order block',
    description: 'Long on bearish liquidity sweep followed by bullish displacement; short on the mirror. Smart-money style.',
    params: [P('reclaimBars', 'Sweep window', 3, 1, 6, 1)],
    entry: 'Sweep within window + displacement + EMA-50 agreement.',
    exit: 'Opposite setup, ATR stop, or R-multiple target.',
    signal(c, ind, i, p = {}) {
      const win = Math.max(1, Math.round(p.reclaimBars ?? 3));
      if (i < 12) return 0;
      const closes = c.map((x) => x.close);
      const emaOkLong = ind.ema50[i] == null || c[i].close > ind.ema50[i];
      const emaOkShort = ind.ema50[i] == null || c[i].close < ind.ema50[i];
      let recentSweepLow = false, recentSweepHigh = false;
      for (let k = Math.max(1, i - win); k <= i; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = k - 10; j < k - 1; j++) {
          if (j < 0) continue;
          if (c[j].low < lo) lo = c[j].low;
          if (c[j].high > hi) hi = c[j].high;
        }
        if (c[k].low < lo && c[k].close > lo) recentSweepLow = true;
        if (c[k].high > hi && c[k].close < hi) recentSweepHigh = true;
      }
      const body = Math.abs(c[i].close - c[i].open);
      const range = c[i].high - c[i].low || 1e-9;
      const displacementUp = c[i].close > c[i].open && body / range > 0.6;
      const displacementDown = c[i].close < c[i].open && body / range > 0.6;
      if (recentSweepLow && displacementUp && emaOkLong) return 1;
      if (recentSweepHigh && displacementDown && emaOkShort) return -1;
      if (displacementUp && closes[i] > closes[i - 3] && emaOkLong && ind.rsi[i] > 50) return 1;
      if (displacementDown && closes[i] < closes[i - 3] && emaOkShort && ind.rsi[i] < 50) return -1;
      return 0;
    }
  }
];

export function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) || STRATEGIES[0];
}

export function generateSignalSeries(candles, ind, strategyId, sparams = {}) {
  const strat = getStrategy(strategyId);
  return candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i, sparams)));
}
