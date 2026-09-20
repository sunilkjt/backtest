// Setup analysis for the Signals command center.
//
// Built ONLY on causal inputs: trailing indicators, causalFor/stateAt from
// ictEngine.js (never future-resolved states), and past candles. Shared by
// the Signals page; the backtester already uses the same strategy modules,
// so both views agree by construction. Language stays analytical — scores
// are agreement meters, never win probabilities.

import { stateAt } from './ictEngine.js';

// ---- confidence breakdown ------------------------------------------------
// Per-category earned/possible from fired components. Possible = bull+bear
// points that actually fired (mutually exclusive options can't co-fire, so
// the denominator is honest); earned = the leading side.
export function categoryBreakdown(components) {
  const order = [];
  const map = new Map();
  for (const c of components || []) {
    const cat = c.cat || 'Other';
    if (!map.has(cat)) { map.set(cat, { cat, bull: 0, bear: 0 }); order.push(cat); }
    const g = map.get(cat);
    if (c.side === 'bull') g.bull += c.points || 0;
    else if (c.side === 'bear') g.bear += c.points || 0;
  }
  return order.map((cat) => {
    const g = map.get(cat);
    const possible = g.bull + g.bear;
    const earned = Math.max(g.bull, g.bear);
    const side = g.bull > g.bear ? 'bull' : g.bear > g.bull ? 'bear' : 'neutral';
    return { ...g, possible, earned, side };
  });
}

// ---- signal strength tiers ------------------------------------------------
export function setupStrength(direction, score, status) {
  if (status === 'NO TRADE' || direction === 'NEUTRAL') return { label: 'NO TRADE', emoji: '⚪' };
  const strong = Math.abs(score - 50) >= 25;
  if (direction === 'BUY') return strong ? { label: 'STRONG BUY', emoji: '🟢' } : { label: 'BUY', emoji: '🟢' };
  return strong ? { label: 'STRONG SELL', emoji: '🔴' } : { label: 'SELL', emoji: '🔴' };
}

// ---- causal liquidity pools (equal highs/lows from confirmed swings) -----
export function computePools(swingsH, swingsL) {
  const pools = [];
  const tol = (p) => p * 0.0008;
  const cluster = (pts, kind) => {
    const sorted = [...pts].sort((a, b) => a.price - b.price);
    let group = [];
    const flush = () => {
      if (group.length >= 2) {
        pools.push({
          kind, price: group.reduce((s, x) => s + x.price, 0) / group.length,
          touches: group.length, indices: group.map((x) => x.formation ?? x.index)
        });
      }
      group = [];
    };
    for (const p of sorted) {
      if (!group.length || Math.abs(p.price - group[group.length - 1].price) <= tol(p.price)) group.push(p);
      else flush(), group.push(p);
    }
    flush();
  };
  cluster(swingsH.slice(-14), 'high');
  cluster(swingsL.slice(-14), 'low');
  return pools;
}

// ---- liquidity map: swept vs untouched vs potential targets ---------------
export function liquidityMap({ pools, sweeps, prevDay, prevWeek, lastClose }) {
  const sweptNear = (price) => (sweeps || []).some((s) =>
    s.index != null && Number.isFinite(s.price) && Math.abs(s.price - price) / Math.max(1e-9, price) < 0.001);
  const touched = (price, candles) => candles.some((c) => c.low <= price && price <= c.high);
  const mk = (price, label, side, candles) => {
    const sw = sweptNear(price);
    const state = sw ? 'swept' : touched(price, candles.slice(-30)) ? 'untouched-tested' : 'untouched';
    return { price, label, side, state };
  };
  const out = { buySide: [], sellSide: [] };
  for (const p of pools || []) {
    const e = mk(p.price, `${p.kind === 'high' ? 'Equal highs' : 'Equal lows'}×${p.touches}`, p.kind === 'high' ? 'buy' : 'sell', []);
    (p.kind === 'high' ? out.buySide : out.sellSide).push(e);
  }
  if (prevDay) {
    out.buySide.push(mk(prevDay.high, 'Previous day high', 'buy', []));
    out.sellSide.push(mk(prevDay.low, 'Previous day low', 'sell', []));
  }
  if (prevWeek) {
    out.buySide.push(mk(prevWeek.high, 'Previous week high', 'buy', []));
    out.sellSide.push(mk(prevWeek.low, 'Previous week low', 'sell', []));
  }
  const fmt = (a, dir) => a
    .filter((x) => Number.isFinite(x.price))
    .sort((a, b) => (dir === 1 ? a.price - b.price : b.price - a.price));
  out.buySide = fmt(out.buySide.filter((x) => x.price > lastClose), 1);
  out.sellSide = fmt(out.sellSide.filter((x) => x.price < lastClose), -1);
  return out;
}

// ---- sessions in a selected timezone --------------------------------------
export function sessionInfo(candles, tzOffset = 0) {
  const n = candles.length;
  if (!n) return null;
  const inTz = (ts) => new Date(ts + tzOffset * 36e5);
  const last = candles[n - 1];
  const d = inTz(last.timestamp);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const sameDay = candles.filter((c) => {
    const x = inTz(c.timestamp);
    return `${x.getUTCFullYear()}-${x.getUTCMonth()}-${x.getUTCDate()}` === dayKey;
  });
  const dayHigh = sameDay.length ? Math.max(...sameDay.map((c) => c.high)) : last.high;
  const dayLow = sameDay.length ? Math.min(...sameDay.map((c) => c.low)) : last.low;
  let name = 'Off hours', killzone = false;
  if (h >= 0 && h < 7) name = 'Asian';
  else if (h >= 7 && h < 10) { name = 'London'; killzone = true; }
  else if (h >= 10 && h < 12) name = 'London close';
  else if (h >= 12 && h < 15) { name = 'New York'; killzone = true; }
  else name = 'US afternoon';
  return { name, killzone, hour: h, dayHigh, dayLow, dayRange: dayHigh - dayLow, bars: sameDay.length };
}

// ---- position sizing -------------------------------------------------------
export function sizeFor({ balance, riskPct, entry, stop, takeProfit, lev = 1 }) {
  const stopDist = Math.abs(entry - stop);
  const tpDist = Math.abs(takeProfit - entry);
  const maxLoss = balance * (riskPct / 100);
  const qty = stopDist > 0 ? maxLoss / stopDist : 0;
  const notional = qty * entry;
  return {
    maxLoss, qty, notional,
    margin: lev > 0 ? notional / lev : notional,
    profit: tpDist * qty,
    rr: stopDist > 0 ? tpDist / stopDist : 0
  };
}

// ---- structure-aware targets ------------------------------------------------
// T1 = nearest opposing confirmed swing (else nearest opposing pool, else PDH/PDL).
// T2 = next liquidity beyond T1 (pool / prev-week level), else T1 extended.
// T3 = fixed R projection. Every target carries its reason — never invented.
export function structureTargets({ candles, engState, pools, prevDay, prevWeek, dir, entry, stop }) {
  const n = candles.length;
  const risk = Math.abs(entry - stop);
  const out = [];
  if (dir === 1) {
    const highs = engState.swingsH.filter((s) => s.price > entry).sort((a, b) => a.price - b.price);
    if (highs[0]) out.push({ key: 'T1', price: highs[0].price, reason: 'Previous swing high' });
    else {
      const pool = (pools || []).filter((p) => p.kind === 'high' && p.price > entry).sort((a, b) => a.price - b.price)[0];
      if (pool) out.push({ key: 'T1', price: pool.price, reason: `Buy-side liquidity (equal highs×${pool.touches})` });
      else if (prevDay && prevDay.high > entry) out.push({ key: 'T1', price: prevDay.high, reason: 'Previous day high' });
      else out.push({ key: 'T1', price: entry + risk, reason: '1R projection (no structure above)' });
    }
    const t1 = out[0].price;
    const pool2 = (pools || []).filter((p) => p.kind === 'high' && p.price > t1).sort((a, b) => a.price - b.price)[0];
    if (pool2) out.push({ key: 'T2', price: pool2.price, reason: `Buy-side liquidity (equal highs×${pool2.touches})` });
    else if (prevWeek && prevWeek.high > t1) out.push({ key: 'T2', price: prevWeek.high, reason: 'Previous week high' });
    else if (prevDay && prevDay.high > t1) out.push({ key: 'T2', price: prevDay.high, reason: 'Previous day high' });
    else out.push({ key: 'T2', price: entry + risk * 2, reason: '2R projection (no further liquidity)' });
    out.push({ key: 'T3', price: entry + risk * 2.5, reason: '2.5R projection' });
  } else {
    const lows = engState.swingsL.filter((s) => s.price < entry).sort((a, b) => b.price - a.price);
    if (lows[0]) out.push({ key: 'T1', price: lows[0].price, reason: 'Previous swing low' });
    else {
      const pool = (pools || []).filter((p) => p.kind === 'low' && p.price < entry).sort((a, b) => b.price - a.price)[0];
      if (pool) out.push({ key: 'T1', price: pool.price, reason: `Sell-side liquidity (equal lows×${pool.touches})` });
      else if (prevDay && prevDay.low < entry) out.push({ key: 'T1', price: prevDay.low, reason: 'Previous day low' });
      else out.push({ key: 'T1', price: entry - risk, reason: '1R projection (no structure below)' });
    }
    const t1 = out[0].price;
    const pool2 = (pools || []).filter((p) => p.kind === 'low' && p.price < t1).sort((a, b) => b.price - a.price)[0];
    if (pool2) out.push({ key: 'T2', price: pool2.price, reason: `Sell-side liquidity (equal lows×${pool2.touches})` });
    else if (prevWeek && prevWeek.low < t1) out.push({ key: 'T2', price: prevWeek.low, reason: 'Previous week low' });
    else if (prevDay && prevDay.low < t1) out.push({ key: 'T2', price: prevDay.low, reason: 'Previous day low' });
    else out.push({ key: 'T2', price: entry - risk * 2, reason: '2R projection (no further liquidity)' });
    out.push({ key: 'T3', price: entry - risk * 2.5, reason: '2.5R projection' });
  }
  return out;
}

// ---- full trade plan -------------------------------------------------------
export function buildTradePlan({ candles, ind, eng, levels, dir, pools, prevDay, prevWeek }) {
  const n = candles.length;
  if (!n || !levels || (dir !== 1 && dir !== -1)) return null;
  const entry = levels.entry;
  const engState = stateAt(eng, n - 1);
  const targets = structureTargets({ candles, engState, pools, prevDay, prevWeek, dir, entry, stop: levels.stop });
  const t1 = targets[0];
  // Entry zone: between last close and the nearest demand/supply reference.
  const c = candles[n - 1];
  let zoneRef = null, zoneLabel = '';
  if (dir === 1) {
    const sup = [
      ...engState.fvgs.filter((g) => g.direction === 1 && g.state !== 'filled').map((g) => ({ p: g.top, l: 'FVG top' })),
      ...engState.obs.filter((o) => o.direction === 1 && (o.state === 'active' || o.state === 'mitigated')).map((o) => ({ p: o.top, l: 'Order block top' })),
      ...engState.swingsL.slice(-3).map((s) => ({ p: s.price, l: 'Swing low' }))
    ].filter((x) => x.p <= entry).sort((a, b) => b.p - a.p)[0];
    if (sup) { zoneRef = sup.p; zoneLabel = sup.l; }
  } else {
    const res = [
      ...engState.fvgs.filter((g) => g.direction === -1 && g.state !== 'filled').map((g) => ({ p: g.bottom, l: 'FVG bottom' })),
      ...engState.obs.filter((o) => o.direction === -1 && (o.state === 'active' || o.state === 'mitigated')).map((o) => ({ p: o.bottom, l: 'Order block bottom' })),
      ...engState.swingsH.slice(-3).map((s) => ({ p: s.price, l: 'Swing high' }))
    ].filter((x) => x.p >= entry).sort((a, b) => a.p - b.p)[0];
    if (res) { zoneRef = res.p; zoneLabel = res.l; }
  }
  const atr = ind.atr?.[n - 1] ?? Math.abs(entry - levels.stop);
  let zone = [entry, entry];
  if (zoneRef != null && Math.abs(entry - zoneRef) <= atr * 1.5) {
    zone = dir === 1 ? [zoneRef, entry] : [entry, zoneRef];
  } else {
    zone = dir === 1 ? [entry - atr * 0.25, entry] : [entry, entry + atr * 0.25];
    zoneLabel = zoneLabel || 'Last close ± ¼ ATR';
  }
  const risk = Math.abs(entry - levels.stop) || atr;
  const rr = Math.abs(t1.price - entry) / risk;
  const invalidation = dir === 1
    ? `Bullish setup fails on a close below ${zoneLabel} / stop ${fmt$(levels.stop)}. Structure break against the trade confirms it.`
    : `Bearish setup fails on a close above ${zoneLabel} / stop ${fmt$(levels.stop)}. Structure break against the trade confirms it.`;
  return {
    dir, entry, zone, zoneLabel, stop: levels.stop,
    invalidation, targets, t1, rr,
    reasons: { t1: t1.reason }
  };
}

function fmt$(v) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ---- WHY WAIT: balanced contrarian evidence --------------------------------
export function whyWait({ candles, ind, eng, signal, regime, mtf, plan, minRR, dir }) {
  const out = [];
  const n = candles.length;
  if (!n) return out;
  const c = candles[n - 1];
  const atr = ind.atr?.[n - 1] ?? 0;
  const engState = stateAt(eng, n - 1);

  // 1) strongest counter-evidence already scored
  const contra = (signal?.reasons || [])
    .filter((r) => r.points > 0 && ((dir === 1 && r.side === 'bear') || (dir === -1 && r.side === 'bull')))
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);
  for (const r of contra) out.push({ icon: '🟠', text: `${r.label} — ${r.detail}` });

  // 2) opposing structure within 1.5 ATR
  if (atr > 0) {
    const near = dir === 1
      ? engState.swingsH.filter((s) => s.price > c.close && s.price - c.close <= atr * 1.5).sort((a, b) => a.price - b.price)[0]
      : engState.swingsL.filter((s) => s.price < c.close && c.close - s.price <= atr * 1.5).sort((a, b) => b.price - a.price)[0];
    if (near) {
      const d = dir === 1 ? (near.price - c.close) / atr : (c.close - near.price) / atr;
      out.push({ icon: '🟠', text: `${dir === 1 ? 'Resistance' : 'Support'} ${fmt$(near.price)} only ${d.toFixed(1)} ATR away caps the move.` });
    }
  }

  // 3) weak volume
  const vols = candles.slice(-20).map((x) => x.volume || 0);
  const meanV = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
  if (meanV > 0 && (c.volume || 0) < meanV * 0.7) {
    out.push({ icon: '🟠', text: `Volume confirmation is weak — last bar ${(c.volume || 0).toFixed(0)} vs 20-bar average ${meanV.toFixed(0)}.` });
  }

  // 4) MTF conflict
  if (mtf && mtf.some((r) => r.ok)) {
    const dirs = [...new Set(mtf.filter((r) => r.ok).map((r) => r.direction))];
    if (dirs.length > 1) out.push({ icon: '🟠', text: `Higher and lower timeframes disagree (${dirs.join(' / ')}).` });
  }

  // 5) thin reward
  if (plan && plan.rr < minRR) {
    out.push({ icon: '🟠', text: `Risk/reward ${plan.rr.toFixed(2)} is below the ${minRR} minimum.` });
  } else if (plan && plan.rr < minRR + 0.5) {
    out.push({ icon: '🟠', text: `Risk/reward ${plan.rr.toFixed(2)} is thin — little room for error.` });
  }

  // 6) FVG already partially filled in trade direction
  const partial = engState.fvgs.filter((g) =>
    g.state === 'partial' && ((dir === 1 && g.direction === 1) || (dir === -1 && g.direction === -1)));
  if (partial.length) out.push({ icon: '🟠', text: `The ${dir === 1 ? 'bullish' : 'bearish'} FVG was already partially filled — leftovers, not fresh.` });

  // 7) chop / volatility regime
  const adx = ind.adx?.[n - 1];
  if (adx != null && adx < 15) out.push({ icon: '🟠', text: `ADX ${adx.toFixed(1)} — choppy market, trend setups misfire here.` });
  if (atr > 0 && c.close && (atr / c.close) * 100 >= 3) {
    out.push({ icon: '🟠', text: `ATR is ${((atr / c.close) * 100).toFixed(2)}% of price — violent conditions, size down or wait.` });
  }

  // 8) bad location: premium longs / discount shorts
  const pos = orderingPosition(candles);
  if (dir === 1 && pos != null && pos > 0.7) out.push({ icon: '🟠', text: 'Price sits in premium — longs are paying up.' });
  if (dir === -1 && pos != null && pos < 0.3) out.push({ icon: '🟠', text: 'Price sits in discount — shorts are selling cheap.' });

  // 9) off killzone
  const h = new Date(c.timestamp).getUTCHours();
  const kz = (h >= 7 && h < 10) || (h >= 12 && h < 15);
  if (!kz) out.push({ icon: '🟠', text: 'Outside London/New York killzones — moves here are less trustworthy.' });

  void regime;
  return out.slice(0, 8);
}

function orderingPosition(candles) {
  const look = candles.slice(-60);
  if (!look.length) return null;
  const hi = Math.max(...look.map((c) => c.high));
  const lo = Math.min(...look.map((c) => c.low));
  if (hi === lo) return 0.5;
  return (candles[candles.length - 1].close - lo) / (hi - lo);
}

// ---- setup status -----------------------------------------------------------
export function assessSetup({ candles, eng, signal, plan, mtf, minConf = 60, minRR = 1.5, gated }) {
  const reasons = [];
  const n = candles.length;
  const dir = signal?.direction === 'BUY' ? 1 : signal?.direction === 'SELL' ? -1 : 0;
  const score = signal?.score ?? 50;
  if (!signal || dir === 0) {
    return { status: 'NO TRADE', statusReasons: ['No directional edge — confluence sits at neutral.'], dir, score };
  }
  if (score < minConf) {
    reasons.push(`Confluence ${score} is below the ${minConf} minimum.`);
    return { status: 'NO TRADE', statusReasons: reasons, dir, score };
  }
  if (!plan) {
    reasons.push('No calculable trade plan at current prices.');
    return { status: 'NO TRADE', statusReasons: reasons, dir, score };
  }
  if (plan.rr < minRR) {
    reasons.push(`Risk/reward ${plan.rr.toFixed(2)} is below the ${minRR} minimum.`);
    return { status: 'NO TRADE', statusReasons: reasons, dir, score };
  }
  // stale: target already reached or stop already through
  const c = candles[n - 1].close;
  if ((dir === 1 && (c >= plan.t1.price || c <= plan.stop)) || (dir === -1 && (c <= plan.t1.price || c >= plan.stop))) {
    reasons.push('Price already beyond the entry/target/stop geometry — setup is stale.');
    return { status: 'INVALIDATED', statusReasons: reasons, dir, score };
  }
  if (gated) {
    reasons.push('Direction conflicts with the market regime gate.');
    return { status: 'WAIT FOR CONFIRMATION', statusReasons: reasons, dir, score };
  }
  const st = stateAt(eng, n - 1);
  const dispSide = recentDisplacement(candles, n - 1, 3) === dir;
  const bosHere = st.bos.filter((e) => e.index >= n - 3 && e.direction === dir).length > 0;
  const sweepHere = st.sweeps.filter((e) => e.index >= n - 8 && e.direction === dir).length > 0;
  if ((dispSide || bosHere) && (sweepHere || bosHere || dispSide)) {
    reasons.push('Fresh confirmation (displacement/structure) aligns with the setup.');
    return { status: 'CONFIRMED', statusReasons: reasons, dir, score };
  }
  if (sweepHere) {
    reasons.push('Liquidity swept — awaiting confirmation candle.');
    return { status: 'DEVELOPING', statusReasons: reasons, dir, score };
  }
  if (score >= 55 && score <= 65) {
    reasons.push('Edge is marginal — confirmation still required.');
    return { status: 'WAIT FOR CONFIRMATION', statusReasons: reasons, dir, score };
  }
  if (signal.net >= 10) {
    reasons.push('Broad confluence across independent checks.');
    return { status: 'CONFIRMED', statusReasons: reasons, dir, score };
  }
  reasons.push('Direction exists but confirmation is thin.');
  return { status: 'WAIT FOR CONFIRMATION', statusReasons: reasons, dir, score };
}

// Most recent displacement direction within window bars (0 if none).
// Pure function of bars <= i — causal.
function recentDisplacement(candles, i, window) {
  for (let k = i; k > Math.max(0, i - window); k--) {
    const c = candles[k];
    if (!c) continue;
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    if (body / range > 0.6) return c.close > c.open ? 1 : -1;
  }
  return 0;
}
