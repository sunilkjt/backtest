// Causal ICT engine — the backtest-safe counterpart to ict.js.
//
// ict.js is RETROSPECTIVE: it may inspect the whole dataset (final FVG fill
// states, violated OBs, confirmed-after-the-fact swings) for visualization
// and for the live last-bar signal. Nothing historical may consume it.
//
// This module is CAUSAL: every fact carries the bar at which it became
// knowable, and stateAt(eng, i) exposes only information available at the
// close of bar i:
//   - swings: usable only once confirmationIndex (formation + swingR) is reached
//   - BOS/CHOCH: only against confirmed swings
//   - sweeps: only against levels confirmed before the sweep bar
//   - FVG: fresh at creation; partial/filled transitions only from later bars
//   - OB: candidate → confirmed → active → mitigated → invalidated → breaker,
//     with transitions dated; never resolved with future candles
//
// Strategies and any historical analysis must use this module, never ict.js.

const _engCache = new WeakMap();

export function causalFor(candles, opts) {
  let m = _engCache.get(candles);
  const key = JSON.stringify(opts || { l: 3, r: 3 });
  if (m && m.has(key)) return m.get(key);
  const eng = buildEngine(candles, opts);
  if (!m) { m = new Map(); _engCache.set(candles, m); }
  m.set(key, eng);
  return eng;
}

export function buildEngine(candles, { swingL = 3, swingR = 3 } = {}) {
  const n = candles.length;
  const eng = {
    n, swingL, swingR,
    swingsH: [], // {formation, confirmation, price}
    swingsL: [],
    bos: [],     // {index, direction, price, type}
    sweeps: [],  // {index, direction, price, type}
    fvgs: [],    // {created, direction, top, bottom, transitions:[{index,to}]}
    obs: []      // {zoneBar, direction, top, bottom, created, confirmedAt, transitions:[{index,to}]}
  };

  // ---- 1) swings with confirmation dates (single forward pass) ----
  for (let j = swingL; j + swingR < n; j++) {
    let isH = true, isL = true;
    for (let k = j - swingL; k <= j + swingR; k++) {
      if (k === j) continue;
      if (candles[k].high > candles[j].high) isH = false;
      if (candles[k].low < candles[j].low) isL = false;
    }
    if (isH) eng.swingsH.push({ formation: j, confirmation: j + swingR, price: candles[j].high });
    if (isL) eng.swingsL.push({ formation: j, confirmation: j + swingR, price: candles[j].low });
  }

  // ---- 2) walk bars in order; everything below uses only bars <= i ----
  let lastConfH = null, lastConfL = null; // last confirmed swing levels
  let trend = 0;
  let hiPtr = 0, loPtr = 0; // swings sorted by confirmation (formation order)
  const byConfH = [...eng.swingsH].sort((a, b) => a.confirmation - b.confirmation);
  const byConfL = [...eng.swingsL].sort((a, b) => a.confirmation - b.confirmation);

  for (let i = 0; i < n; i++) {
    const c = candles[i];

    // Newly confirmed swings become reference levels at their confirmation bar.
    while (hiPtr < byConfH.length && byConfH[hiPtr].confirmation <= i) lastConfH = byConfH[hiPtr++];
    while (loPtr < byConfL.length && byConfL[loPtr].confirmation <= i) lastConfL = byConfL[loPtr++];

    // BOS/CHOCH: EVERY bar's close is tested against the latest confirmed
    // levels (cross-based). A breakout between confirmations must still fire —
    // evaluating only on confirmation bars would miss it (audit finding).
    if (i > 0) {
      const pc = candles[i - 1].close;
      if (lastConfH != null && pc <= lastConfH.price && c.close > lastConfH.price) {
        const chop = trend === -1;
        eng.bos.push({ index: i, direction: 1, price: lastConfH.price, type: chop ? 'choch-bull' : 'bos-bull' });
        trend = 1;
      }
      if (lastConfL != null && pc >= lastConfL.price && c.close < lastConfL.price) {
        const chop = trend === 1;
        eng.bos.push({ index: i, direction: -1, price: lastConfL.price, type: chop ? 'choch-bear' : 'bos-bear' });
        trend = -1;
      }
    }

    // sweeps: wick beyond the latest CONFIRMED level, close back inside.
    // (levels confirmed at bar i itself are excluded — not knowable intraday.)
    const refH = latestConfirmed(byConfH, i - 1);
    const refL = latestConfirmed(byConfL, i - 1);
    if (refL && c.low < refL.price && c.close > refL.price) {
      eng.sweeps.push({ index: i, direction: 1, price: refL.price, type: 'sweep-low' });
    }
    if (refH && c.high > refH.price && c.close < refH.price) {
      eng.sweeps.push({ index: i, direction: -1, price: refH.price, type: 'sweep-high' });
    }

    // FVG creation (uses bars i-2..i only) + transitions of older FVGs
    if (i >= 2) {
      const a = candles[i - 2];
      if (c.low > a.high) eng.fvgs.push({ created: i, direction: 1, top: c.low, bottom: a.high, transitions: [] });
      else if (c.high < a.low) eng.fvgs.push({ created: i, direction: -1, top: a.low, bottom: c.high, transitions: [] });
    }
    for (const g of eng.fvgs) {
      if (g.created >= i || fvgStateAt(g, i - 1) === 'filled') continue;
      if (g.direction === 1) {
        if (c.close < g.bottom) g.transitions.push({ index: i, to: 'filled' });
        else if (c.low <= g.top && fvgStateAt(g, i - 1) === 'fresh') g.transitions.push({ index: i, to: 'partial' });
      } else {
        if (c.close > g.top) g.transitions.push({ index: i, to: 'filled' });
        else if (c.high >= g.bottom && fvgStateAt(g, i - 1) === 'fresh') g.transitions.push({ index: i, to: 'partial' });
      }
    }

    // OB lifecycle. Candidate at displacement close (zone = last opposite
    // candle within 5 bars); confirmed next bar if not closed through.
    if (i >= 1) {
      const body = Math.abs(c.close - c.open);
      const range = c.high - c.low || 1e-9;
      if (body / range > 0.6) {
        const up = c.close > c.open;
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const q = candles[j];
          const qUp = q.close > q.open;
          if (up === qUp) continue;
          eng.obs.push({
            zoneBar: j, direction: up ? 1 : -1,
            top: Math.max(q.open, q.close), bottom: Math.min(q.open, q.close),
            created: i, confirmedAt: null, transitions: [{ index: i, to: 'candidate' }]
          });
          break;
        }
      }
    }
    for (const o of eng.obs) {
      if (o.created >= i) continue;
      const st = obStateAt(o, i - 1);
      if (st === 'candidate') {
        // confirmation: survive the next close without a close-through
        if (o.direction === 1) {
          if (c.close < o.bottom) o.transitions.push({ index: i, to: 'invalidated' });
          else o.transitions.push({ index: i, to: 'confirmed' });
        } else {
          if (c.close > o.top) o.transitions.push({ index: i, to: 'invalidated' });
          else o.transitions.push({ index: i, to: 'confirmed' });
        }
      } else if (st === 'confirmed' || st === 'active' || st === 'mitigated') {
        if (o.direction === 1) {
          if (c.close < o.bottom) o.transitions.push({ index: i, to: 'invalidated' });
          else if (c.low <= o.top && st !== 'mitigated') o.transitions.push({ index: i, to: 'mitigated' });
          else if (st === 'confirmed') o.transitions.push({ index: i, to: 'active' });
        } else {
          if (c.close > o.top) o.transitions.push({ index: i, to: 'invalidated' });
          else if (c.high >= o.bottom && st !== 'mitigated') o.transitions.push({ index: i, to: 'mitigated' });
          else if (st === 'confirmed') o.transitions.push({ index: i, to: 'active' });
        }
      } else if (st === 'invalidated') {
        // reclaim of a dead bearish-turned zone (or vice versa) => breaker
        if (o.direction === 1 && c.close > o.top) o.transitions.push({ index: i, to: 'breaker' });
        else if (o.direction === -1 && c.close < o.bottom) o.transitions.push({ index: i, to: 'breaker' });
      }
    }
  }
  return eng;
}

function latestConfirmed(sortedByConf, i) {
  let out = null;
  for (const s of sortedByConf) {
    if (s.confirmation > i) break;
    out = s;
  }
  return out;
}

export function fvgStateAt(g, i) {
  let st = 'fresh';
  for (const t of g.transitions) {
    if (t.index > i) break;
    st = t.to;
  }
  return st;
}

export function obStateAt(o, i) {
  let st = 'candidate';
  for (const t of o.transitions) {
    if (t.index > i) break;
    st = t.to;
  }
  return st;
}

// Snapshot of everything knowable at the close of bar i. All lists contain
// only facts with effect dates <= i — safe for historical strategies.
// Transition logs are clipped to i: the raw log keeps growing with future
// bars, and spreading it unclipped would leak future resolutions into the
// snapshot object even though .state itself is correct.
export function stateAt(eng, i) {
  const swingsH = eng.swingsH.filter((s) => s.confirmation <= i);
  const swingsL = eng.swingsL.filter((s) => s.confirmation <= i);
  const bos = eng.bos.filter((e) => e.index <= i);
  const sweeps = eng.sweeps.filter((e) => e.index <= i);
  const fvgs = eng.fvgs
    .filter((g) => g.created <= i)
    .map((g) => ({ ...g, transitions: g.transitions.filter((t) => t.index <= i), state: fvgStateAt(g, i), age: i - g.created }));
  const obs = eng.obs
    .filter((o) => o.created <= i)
    .map((o) => ({ ...o, transitions: o.transitions.filter((t) => t.index <= i), state: obStateAt(o, i) }));
  const breakers = obs.filter((o) => o.state === 'breaker');
  return { swingsH, swingsL, bos, sweeps, fvgs, obs, breakers };
}
