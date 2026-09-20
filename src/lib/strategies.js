// Rule-based strategies. Each exposes:
// { id, name, tagline, description, signal(candles, ind, i) -> 1 | -1 | 0, longOnly? }
// Signals are computed bar-by-bar so the backtester and the live signal lab
// share identical logic (no lookahead: only data up to index i).

export const STRATEGIES = [
  {
    id: 'sma-cross',
    name: 'SMA Crossover',
    tagline: 'Golden / Death cross of SMA 50 / 200',
    description: 'Classic trend-following: long when SMA-50 crosses above SMA-200, exit/short on the opposite cross.',
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
    description: 'Long on bullish MACD cross above zero-gated histogram; short on bearish cross.',
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
    description: 'Long on 20-bar high breakout with ADX > 15; short on 20-bar low breakdown.',
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
    signal(c, ind, i) {
      const d = ind.stDir[i], pd = ind.stDir[i - 1];
      if (d == null || pd == null) return 0;
      if (pd === -1 && d === 1) return 1;
      if (pd === 1 && d === -1) return -1;
      return 0;
    }
  },
  {
    id: 'ict-smc',
    name: 'ICT / SMC Smart Money',
    tagline: 'Sweep + displacement + order block',
    description: 'Long on bearish liquidity sweep followed by bullish displacement; short on the mirror. Smart-money style.',
    signal(c, ind, i) {
      if (i < 12) return 0;
      const closes = c.map((x) => x.close);
      // recent swing low/high (10-bar lookback excl. current)
      let swingLo = Infinity, swingHi = -Infinity;
      for (let j = i - 11; j < i - 1; j++) {
        if (c[j].low < swingLo) swingLo = c[j].low;
        if (c[j].high > swingHi) swingHi = c[j].high;
      }
      const sweptLow = c[i - 1].low < swingLo && c[i].close > swingLo;
      const sweptHigh = c[i - 1].high > swingHi && c[i].close < swingHi;
      const body = Math.abs(c[i].close - c[i].open);
      const range = c[i].high - c[i].low || 1e-9;
      const displacementUp = c[i].close > c[i].open && body / range > 0.6;
      const displacementDown = c[i].close < c[i].open && body / range > 0.6;
      const emaOkLong = ind.ema50[i] == null || c[i].close > ind.ema50[i];
      const emaOkShort = ind.ema50[i] == null || c[i].close < ind.ema50[i];
      // allow sweep within last 3 bars
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
      void sweptLow; void sweptHigh;
      if (recentSweepLow && displacementUp && emaOkLong) return 1;
      if (recentSweepHigh && displacementDown && emaOkShort) return -1;
      // fallback momentum confirmation
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
