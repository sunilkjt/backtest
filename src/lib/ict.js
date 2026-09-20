// ICT / Smart Money Concepts analysis: swings, liquidity, BOS/CHOCH,
// order blocks, fair value gaps, premium/discount.

export function findSwings(candles, left = 3, right = 3) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high > candles[i].high) isH = false;
      if (candles[j].low < candles[i].low) isL = false;
    }
    if (isH) highs.push({ index: i, price: candles[i].high, time: candles[i].timestamp });
    if (isL) lows.push({ index: i, price: candles[i].low, time: candles[i].timestamp });
  }
  return { highs, lows };
}

export function analyzeICT(candles) {
  const n = candles.length;
  if (n < 30) {
    return { swings: { highs: [], lows: [] }, events: [], orderBlocks: [], fvgs: [], range: null, bias: 'NEUTRAL', biasScore: 50, dealingRange: null };
  }
  const swings = findSwings(candles, 3, 3);
  const events = []; // {index, type, label, direction}
  const orderBlocks = [];
  const fvgs = [];

  // Liquidity pools = equal highs/lows clusters (within 0.05% tolerance)
  const pools = [];
  const tol = (p) => p * 0.0008;
  const cluster = (pts, kind) => {
    const sorted = [...pts].sort((a, b) => a.price - b.price);
    let group = [];
    for (const p of sorted) {
      if (!group.length || Math.abs(p.price - group[group.length - 1].price) <= tol(p.price)) group.push(p);
      else {
        if (group.length >= 2) pools.push({ kind, price: group.reduce((s, x) => s + x.price, 0) / group.length, touches: group.length, indices: group.map((x) => x.index) });
        group = [p];
      }
    }
    if (group.length >= 2) pools.push({ kind, price: group.reduce((s, x) => s + x.price, 0) / group.length, touches: group.length, indices: group.map((x) => x.index) });
  };
  cluster(swings.highs.slice(-14), 'high');
  cluster(swings.lows.slice(-14), 'low');

  // Sweeps: wick beyond swing then close back inside
  const recentHighs = swings.highs.slice(-6);
  const recentLows = swings.lows.slice(-6);
  for (let i = Math.max(10, n - 120); i < n; i++) {
    for (const s of recentLows) {
      if (s.index < i - 25 || s.index >= i) continue;
      if (candles[i].low < s.price && candles[i].close > s.price) {
        events.push({ index: i, type: 'sweep-low', label: `Liquidity sweep of lows @ ${fmtP(s.price)}`, direction: 1 });
      }
    }
    for (const s of recentHighs) {
      if (s.index < i - 25 || s.index >= i) continue;
      if (candles[i].high > s.price && candles[i].close < s.price) {
        events.push({ index: i, type: 'sweep-high', label: `Liquidity sweep of highs @ ${fmtP(s.price)}`, direction: -1 });
      }
    }
  }

  // BOS / CHOCH: close beyond last opposite swing
  let lastHigh = null, lastLow = null;
  let trend = 0; // 1 up, -1 down
  for (let i = 0; i < n; i++) {
    const sh = swings.highs.find((s) => s.index === i);
    const sl = swings.lows.find((s) => s.index === i);
    if (sh) {
      if (lastHigh != null && candles[i].close > lastHigh.price) {
        const isChoch = trend === -1;
        events.push({ index: i, type: isChoch ? 'choch-bull' : 'bos-bull', label: `${isChoch ? 'CHOCH' : 'BOS'} bullish — close above ${fmtP(lastHigh.price)}`, direction: 1 });
        trend = 1;
      }
      lastHigh = sh;
    }
    if (sl) {
      if (lastLow != null && candles[i].close < lastLow.price) {
        const isChoch = trend === 1;
        events.push({ index: i, type: isChoch ? 'choch-bear' : 'bos-bear', label: `${isChoch ? 'CHOCH' : 'BOS'} bearish — close below ${fmtP(lastLow.price)}`, direction: -1 });
        trend = -1;
      }
      lastLow = sl;
    }
  }

  // Order blocks: last opposite-bodied candle before a displacement candle (body > 60% range, big move)
  for (let i = 2; i < n; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    if (body / range > 0.6 && range > 0) {
      const up = c.close > c.open;
      const prev = candles[i - 1];
      const isOpp = up ? prev.close < prev.open : prev.close > prev.open;
      if (isOpp) {
        orderBlocks.push({
          index: i - 1, direction: up ? 1 : -1,
          top: Math.max(prev.open, prev.close), bottom: Math.min(prev.open, prev.close),
          label: `${up ? 'Bullish' : 'Bearish'} OB @ ${fmtP(prev.close)}`
        });
      }
    }
  }

  // FVG: 3-candle imbalance (low[i] > high[i-2] bullish, high[i] < low[i-2] bearish)
  for (let i = 2; i < n; i++) {
    const a = candles[i - 2], c = candles[i];
    if (c.low > a.high) fvgs.push({ index: i, direction: 1, top: c.low, bottom: a.high, label: `Bullish FVG ${fmtP(a.high)}–${fmtP(c.low)}` });
    else if (c.high < a.low) fvgs.push({ index: i, direction: -1, top: a.low, bottom: c.high, label: `Bearish FVG ${fmtP(c.high)}–${fmtP(a.low)}` });
  }

  // Dealing range: highest high / lowest low of last 60 bars
  const lookback = candles.slice(-60);
  const rangeHigh = Math.max(...lookback.map((c) => c.high));
  const rangeLow = Math.min(...lookback.map((c) => c.low));
  const eq = (rangeHigh + rangeLow) / 2;
  const last = candles[n - 1].close;
  const pos = rangeHigh !== rangeLow ? (last - rangeLow) / (rangeHigh - rangeLow) : 0.5;
  const zone = pos > 0.7 ? 'Premium (expensive — prefer shorts)' : pos < 0.3 ? 'Discount (cheap — prefer longs)' : 'Equilibrium';

  // Bias score: weigh recent events + position in range
  let score = 50;
  const recent = events.filter((e) => e.index >= n - 40);
  for (const e of recent) score += e.direction * 4;
  score += (0.5 - pos) * 24; // discount adds bullish
  const lastClose = candles[n - 1].close;
  const prevClose = candles[Math.max(0, n - 6)].close;
  if (lastClose > prevClose) score += 4; else score -= 4;
  score = Math.max(2, Math.min(98, Math.round(score)));
  const bias = score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';

  return {
    swings, events: events.slice(-30), orderBlocks: orderBlocks.slice(-8), fvgs: fvgs.slice(-8),
    pools, range: { high: rangeHigh, low: rangeLow, eq },
    positionInRange: pos, zone, bias, biasScore: score,
    dealingRange: { high: rangeHigh, low: rangeLow, eq }
  };
}

function fmtP(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
