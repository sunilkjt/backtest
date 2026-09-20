// Rule-based strategies. Each exposes:
// { id, name, tagline, description, params, entry, exit, signal(candles, ind, i) }
// Signals are computed bar-by-bar so the backtester and the live signal lab
// share identical logic (no lookahead: only data up to index i).

function P(key, label, def, min, max, step) {
  return { key, label, def, min, max, step };
}

export const STRATEGIES = [
  {
    id: 'sma-cross',
    name: 'SMA Crossover',
    tagline: 'Golden / Death cross of SMA 50 / 200',
    description: 'Classic trend-following: long when SMA-50 crosses above SMA-200, exit/short on the opposite cross.',
    params: [P('fast', 'Fast SMA', 50, 5, 200, 1), P('slow', 'Slow SMA', 200, 20, 400, 1)],
    entry: 'SMA-50 crosses above SMA-200 → LONG. Crosses below → SHORT.',
    exit: 'Opposite cross, ATR stop, or R-multiple target (risk settings).',
    signal(c, ind, i) {
      const a = ind.sma50[i], b = ind.sma200[i], pa = ind.sma50[i - 1], pb = ind.sma200[i - 1];
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
    description: 'Long when EMA-20 > EMA-50 and RSI > 55. Short when EMA-20 < EMA-50 and RSI < 45. Filters chop.',
    params: [P('rsiLong', 'RSI long gate', 55, 50, 70, 1), P('rsiShort', 'RSI short gate', 45, 30, 50, 1)],
    entry: 'Trend side from EMA 20/50 + RSI beyond the gate.',
    exit: 'Opposite signal, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      const f = ind.ema20[i], s = ind.ema50[i], r = ind.rsi[i];
      if (f == null || s == null || r == null) return 0;
      if (f > s && r > 55) return 1;
      if (f < s && r < 45) return -1;
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
    signal(c, ind, i) {
      const m = ind.macdLine[i], s = ind.signalLine[i], h = ind.hist[i];
      const pm = ind.macdLine[i - 1], ps = ind.signalLine[i - 1];
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
    signal(c, ind, i) {
      const up = ind.bbUpper[i], lo = ind.bbLower[i];
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
    description: 'Long when RSI crosses back above 30 from oversold; short when it crosses back below 70.',
    params: [P('oversold', 'Oversold level', 30, 10, 40, 1), P('overbought', 'Overbought level', 70, 60, 90, 1)],
    entry: 'RSI reclaims 30 from below → LONG. Loses 70 from above → SHORT.',
    exit: 'Opposite reclaim, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      const r = ind.rsi[i], pr = ind.rsi[i - 1];
      if (r == null || pr == null) return 0;
      if (pr <= 30 && r > 30) return 1;
      if (pr >= 70 && r < 70) return -1;
      return 0;
    }
  },
  {
    id: 'donchian',
    name: 'Donchian Breakout',
    tagline: '20-bar channel breakout + ADX gate',
    description: 'Long on 20-bar high breakout with ADX > 12; short on 20-bar low breakdown.',
    params: [P('channel', 'Channel bars', 20, 10, 60, 1), P('adxMin', 'Min ADX', 12, 0, 40, 1)],
    entry: 'Close beyond the channel with trend strength confirmed.',
    exit: 'Opposite breakout, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      const up = ind.donUpper[i - 1], lo = ind.donLower[i - 1];
      const adx = ind.adx[i];
      if (up == null || lo == null) return 0;
      const gate = adx == null || adx > 12;
      if (c[i].close > up && gate) return 1;
      if (c[i].close < lo && gate) return -1;
      return 0;
    }
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    tagline: 'ATR trailing-stop flip system',
    description: 'Follows the Supertrend (10, 3.0) direction flips. Cuts losers fast, rides trends.',
    params: [P('atrPeriod', 'ATR period', 10, 5, 30, 1), P('mult', 'ATR multiple', 3, 1, 6, 0.5)],
    entry: 'Supertrend flips: to bullish → LONG, to bearish → SHORT.',
    exit: 'Opposite flip, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      const d = ind.stDir[i], pd = ind.stDir[i - 1];
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
    entry: 'Net votes ≥ +3 → LONG. Net votes ≤ −3 → SHORT.',
    exit: 'Vote flip, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      let v = 0, n = 0;
      const vote = (x) => { n++; v += x; };
      if (ind.ema20[i] != null && ind.ema50[i] != null) vote(ind.ema20[i] > ind.ema50[i] ? 1 : -1);
      if (ind.rsi[i] != null) { if (ind.rsi[i] > 52) vote(1); else if (ind.rsi[i] < 48) vote(-1); else n++; }
      if (ind.macdLine[i] != null && ind.signalLine[i] != null) vote(ind.macdLine[i] > ind.signalLine[i] ? 1 : -1);
      if (ind.stDir[i] != null) vote(ind.stDir[i]);
      if (n < 3) return 0;
      if (v >= 3) return 1;
      if (v <= -3) return -1;
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
    signal(c, ind, i) {
      if (i < 12) return 0;
      for (let k = Math.max(1, i - 3); k <= i; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = Math.max(0, k - 10); j < k - 1; j++) {
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
    signal(c, ind, i) {
      if (i < 6) return 0;
      const e50 = ind.ema50[i];
      for (let k = Math.max(2, i - 5); k <= i; k++) {
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
    signal(c, ind, i) {
      if (i < 4) return 0;
      const cur = c[i];
      const body = Math.abs(cur.close - cur.open);
      const range = cur.high - cur.low || 1e-9;
      if (body / range < 0.6) return 0;
      const up = cur.close > cur.open;
      for (let j = Math.max(1, i - 12); j < i; j++) {
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
    signal(c, ind, i) {
      if (i < 10) return 0;
      // last fractal swing high/low before bar i
      let swH = null, swL = null;
      for (let j = i - 8; j < i - 1; j++) {
        if (j < 3) continue;
        let isH = true, isL = true;
        for (let k = j - 3; k <= j + 3; k++) {
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
    entry: 'Sweep within 3 bars + displacement + EMA-50 agreement.',
    exit: 'Opposite setup, ATR stop, or R-multiple target.',
    signal(c, ind, i) {
      if (i < 12) return 0;
      const closes = c.map((x) => x.close);
      const emaOkLong = ind.ema50[i] == null || c[i].close > ind.ema50[i];
      const emaOkShort = ind.ema50[i] == null || c[i].close < ind.ema50[i];
      let recentSweepLow = false, recentSweepHigh = false;
      for (let k = Math.max(1, i - 3); k <= i; k++) {
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

export function generateSignalSeries(candles, ind, strategyId) {
  const strat = getStrategy(strategyId);
  return candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i)));
}
