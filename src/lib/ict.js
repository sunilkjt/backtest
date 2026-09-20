// ICT / Smart Money Concepts analysis: swings, structure labels (HH/HL/LH/LL),
// liquidity, BOS/CHOCH, order blocks (+states, breakers), fair value gaps
// (+fill states), premium/discount, displacement, sessions, PDH/PDL/PWH/PWL.

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

function classify(side, pts) {
  // HH/HL for bullish steps, LH/LL for bearish steps, first = 'X'.
  return pts.map((p, k) => {
    if (k === 0) return { ...p, kind: 'X' };
    const prev = pts[k - 1];
    if (side === 'high') return { ...p, kind: p.price > prev.price ? 'HH' : 'LH' };
    return { ...p, kind: p.price > prev.price ? 'HL' : 'LL' };
  });
}

export function sessionFor(ts) {
  const h = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;
  // Killzones: London 7–10 UTC, New York 12–15 UTC (approx).
  if (h >= 7 && h < 10) return { name: 'London', killzone: true, bias: 0 };
  if (h >= 12 && h < 15) return { name: 'New York', killzone: true, bias: 0 };
  if (h >= 0 && h < 7) return { name: 'Asian', killzone: false, bias: 0 };
  if (h >= 10 && h < 12) return { name: 'London close', killzone: false, bias: 0 };
  return { name: 'US afternoon', killzone: false, bias: 0 };
}

export function analyzeICT(candles) {
  const n = candles.length;
  if (n < 30) {
    return { swings: { highs: [], lows: [] }, classified: { highs: [], lows: [] }, events: [], orderBlocks: [], breakers: [], fvgs: [], displacement: [], pools: [], range: null, bias: 'NEUTRAL', biasScore: 50, dealingRange: null, session: null, prevDay: null, prevWeek: null, positionInRange: 0.5, zone: 'Equilibrium' };
  }
  const swings = findSwings(candles, 3, 3);
  const classified = { highs: classify('high', swings.highs), lows: classify('low', swings.lows) };
  const events = []; // {index, type, label, direction}
  const orderBlocks = [];
  const breakers = [];
  const fvgs = [];
  const displacement = [];

  // Liquidity pools = equal highs/lows clusters (within tolerance)
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

  // Sweeps: wick beyond swing then close back inside (price kept for overlays)
  const recentHighs = swings.highs.slice(-6);
  const recentLows = swings.lows.slice(-6);
  for (let i = Math.max(10, n - 120); i < n; i++) {
    for (const s of recentLows) {
      if (s.index < i - 25 || s.index >= i) continue;
      if (candles[i].low < s.price && candles[i].close > s.price) {
        events.push({ index: i, type: 'sweep-low', label: `Liquidity sweep of lows @ ${fmtP(s.price)}`, direction: 1, price: s.price });
      }
    }
    for (const s of recentHighs) {
      if (s.index < i - 25 || s.index >= i) continue;
      if (candles[i].high > s.price && candles[i].close < s.price) {
        events.push({ index: i, type: 'sweep-high', label: `Liquidity sweep of highs @ ${fmtP(s.price)}`, direction: -1, price: s.price });
      }
    }
  }

  // BOS / CHOCH: close beyond last opposite swing (level kept for overlays)
  let lastHigh = null, lastLow = null;
  let trend = 0; // 1 up, -1 down
  for (let i = 0; i < n; i++) {
    const sh = swings.highs.find((s) => s.index === i);
    const sl = swings.lows.find((s) => s.index === i);
    if (sh) {
      if (lastHigh != null && candles[i].close > lastHigh.price) {
        const isChoch = trend === -1;
        events.push({ index: i, type: isChoch ? 'choch-bull' : 'bos-bull', label: `${isChoch ? 'CHOCH' : 'BOS'} bullish — close above ${fmtP(lastHigh.price)}`, direction: 1, price: lastHigh.price });
        trend = 1;
      }
      lastHigh = sh;
    }
    if (sl) {
      if (lastLow != null && candles[i].close < lastLow.price) {
        const isChoch = trend === 1;
        events.push({ index: i, type: isChoch ? 'choch-bear' : 'bos-bear', label: `${isChoch ? 'CHOCH' : 'BOS'} bearish — close below ${fmtP(lastLow.price)}`, direction: -1, price: lastLow.price });
        trend = -1;
      }
      lastLow = sl;
    }
  }

  // Displacement log (measurable: body > 60% of range)
  for (let i = 2; i < n; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    if (body / range > 0.6) displacement.push({ index: i, direction: c.close > c.open ? 1 : -1 });
  }

  // Order blocks + states: last opposite-bodied candle before displacement.
  // state: active (untouched) | mitigated (wick touched, body intact) | violated (close through → breaker source)
  for (let i = 2; i < n; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    if (body / range > 0.6 && range > 0) {
      const up = c.close > c.open;
      const prev = candles[i - 1];
      const isOpp = up ? prev.close < prev.open : prev.close > prev.open;
      if (isOpp) {
        const top = Math.max(prev.open, prev.close), bottom = Math.min(prev.open, prev.close);
        let state = 'active';
        for (let j = i + 1; j < n; j++) {
          const f = candles[j];
          if (up) {
            if (f.close < bottom) { state = 'violated'; break; }
            if (f.low <= top) state = 'mitigated';
          } else {
            if (f.close > top) { state = 'violated'; break; }
            if (f.high >= bottom) state = 'mitigated';
          }
        }
        orderBlocks.push({
          index: i - 1, direction: up ? 1 : -1, top, bottom, state,
          label: `${up ? 'Bullish' : 'Bearish'} OB @ ${fmtP(prev.close)} (${state})`
        });
        if (state === 'violated') {
          breakers.push({
            index: i - 1, direction: up ? -1 : 1, top, bottom,
            label: `${up ? 'Bearish' : 'Bullish'} breaker @ ${fmtP(prev.close)}`
          });
        }
      }
    }
  }

  // FVG with fill states: filled (closed through) | partial (wick entered) | unfilled
  for (let i = 2; i < n; i++) {
    const a = candles[i - 2], c = candles[i];
    let g = null;
    if (c.low > a.high) g = { index: i, direction: 1, top: c.low, bottom: a.high };
    else if (c.high < a.low) g = { index: i, direction: -1, top: a.low, bottom: c.high };
    if (!g) continue;
    let state = 'unfilled';
    for (let j = i + 1; j < n; j++) {
      const f = candles[j];
      if (g.direction === 1) {
        if (f.close < g.bottom) { state = 'filled'; break; }
        if (f.low <= g.top) state = 'partial';
      } else {
        if (f.close > g.top) { state = 'filled'; break; }
        if (f.high >= g.bottom) state = 'partial';
      }
    }
    g.state = state;
    g.label = `${g.direction === 1 ? 'Bullish' : 'Bearish'} FVG ${fmtP(g.bottom)}–${fmtP(g.top)} (${state})`;
    fvgs.push(g);
  }

  // Previous day / week high-low from UTC sessions (intraday) or prior candles (daily+).
  const tfGuess = n > 1 ? candles[n - 1].timestamp - candles[n - 2].timestamp : 864e5;
  let prevDay = null, prevWeek = null;
  if (tfGuess >= 864e5) {
    if (n >= 2) prevDay = { high: candles[n - 2].high, low: candles[n - 2].low, label: 'Previous candle H/L' };
    if (n >= 6) {
      const wk = candles.slice(n - 6, n - 1);
      prevWeek = { high: Math.max(...wk.map((c) => c.high)), low: Math.min(...wk.map((c) => c.low)), label: 'Prior 5-candle H/L' };
    }
  } else {
    const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
    const days = new Map();
    for (const c of candles) {
      const d = dayOf(c.timestamp);
      if (!days.has(d)) days.set(d, { high: -Infinity, low: Infinity });
      const g = days.get(d);
      if (c.high > g.high) g.high = c.high;
      if (c.low < g.low) g.low = c.low;
    }
    const keys = [...days.keys()].sort();
    const lastKey = dayOf(candles[n - 1].timestamp);
    const done = keys.filter((k) => k < lastKey);
    if (done.length >= 1) {
      const pd = days.get(done[done.length - 1]);
      prevDay = { high: pd.high, low: pd.low, label: `PDH/PDL ${done[done.length - 1]}` };
    }
    if (done.length >= 5) {
      const wk = done.slice(-5).map((k) => days.get(k));
      prevWeek = { high: Math.max(...wk.map((g) => g.high)), low: Math.min(...wk.map((g) => g.low)), label: 'PWH/PWL (5 sessions)' };
    } else if (done.length >= 2) {
      const wk = done.slice(-done.length).map((k) => days.get(k));
      prevWeek = { high: Math.max(...wk.map((g) => g.high)), low: Math.min(...wk.map((g) => g.low)), label: `PWH/PWL (${wk.length} sessions)` };
    }
  }

  // Dealing range: highest high / lowest low of last 60 bars
  const lookback = candles.slice(-60);
  const rangeHigh = Math.max(...lookback.map((c) => c.high));
  const rangeLow = Math.min(...lookback.map((c) => c.low));
  const last = candles[n - 1].close;
  const pos = rangeHigh !== rangeLow ? (last - rangeLow) / (rangeHigh - rangeLow) : 0.5;
  const zone = pos > 0.7 ? 'Premium (expensive — prefer shorts)' : pos < 0.3 ? 'Discount (cheap — prefer longs)' : 'Equilibrium';

  // Bias score: weigh recent events + position in range
  let score = 50;
  const recent = events.filter((e) => e.index >= n - 40);
  for (const e of recent) score += e.direction * 4;
  score += (0.5 - pos) * 24; // discount adds bullish
  const prevClose = candles[Math.max(0, n - 6)].close;
  if (last > prevClose) score += 4; else score -= 4;
  score = Math.max(2, Math.min(98, Math.round(score)));
  const bias = score >= 58 ? 'BULLISH' : score <= 42 ? 'BEARISH' : 'NEUTRAL';

  const sess = sessionFor(candles[n - 1].timestamp);
  // Session bias follows the most recent displacement (within 10 bars):
  // killzone moves with initiative behind them score higher.
  const lastDisp = displacement.length ? displacement[displacement.length - 1] : null;
  sess.bias = lastDisp && lastDisp.index >= n - 10 ? lastDisp.direction : 0;

  return {
    swings, classified, events: events.slice(-30), orderBlocks: orderBlocks.slice(-10),
    breakers: breakers.slice(-6), fvgs: fvgs.slice(-10), displacement: displacement.slice(-12),
    pools, range: { high: rangeHigh, low: rangeLow, eq: (rangeHigh + rangeLow) / 2 },
    positionInRange: pos, zone, bias, biasScore: score, session: sess,
    prevDay, prevWeek,
    dealingRange: { high: rangeHigh, low: rangeLow, eq: (rangeHigh + rangeLow) / 2 }
  };
}

function fmtP(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}
