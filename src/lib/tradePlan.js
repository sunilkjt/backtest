// Canonical trade plan — the ONE authoritative entry → SL → TP → RR →
// size → P&L → liquidation chain for live Signals.
//
// Rule: every downstream number (RR, position size, risk, expected P&L,
// liquidation, leverage math) MUST reference tradePlan.entry and
// tradePlan.stopLoss. No module may substitute last-close, zone midpoint or
// any other price once the plan exists.
//
// Entry convention (explicit): entry is the approved market-execution price
// (the signal engine's reference price, i.e. last close). The entry ZONE is
// displayed separately as the preferred limit-entry region; its midpoint is
// shown for reference only and NEVER enters any calculation.
//
// ICT/SMC methodology is preserved: the zone, stop hierarchy (protected
// swing → order block → FVG → ATR fallback) and structure/liquidity targets
// all come from the causal engine snapshot (stateAt), never future bars.

import { stateAt } from './ictEngine.js';
import { structureTargets } from './setup.js';
import { liquidationPrice, liqLabel } from './riskModels.js';
import { TF_MS } from './providers.js';

// Configurable minimum R:R per target. Flags only — a thin target is
// reported, never silently rewritten (rejection stays with strategy rules).
export const DEFAULT_MIN_RR = { tp1: 1.0, tp2: 1.5, tp3: 2.0 };

const R_LADDER = [1, 2, 2.5];

const fin = (v) => Number.isFinite(v);

function fmtP(v) {
  if (!fin(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ---------------------------------------------------------------------------
// Pure math units (directly unit-tested)
// ---------------------------------------------------------------------------

// Reward:risk of one target from the canonical entry. Signed-positive when
// the target sits on the profitable side, as validated separately.
export function calcRR(entry, stop, tp, dir) {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return NaN;
  const reward = dir === 1 ? tp - entry : entry - tp;
  return reward / risk;
}

// Percentage-risk sizing from the canonical entry + stop. Mirrors the
// backtester's leverage cap (notional capped at balance × leverage).
export function sizePosition({ balance, riskPct, entry, stop, lev = 1 }) {
  const reasons = [];
  if (!(balance > 0)) reasons.push('Account balance must be positive.');
  if (!(riskPct > 0)) reasons.push('Risk % must be positive.');
  if (!fin(entry) || !(entry > 0)) reasons.push('Entry must be a finite positive price.');
  if (!fin(stop)) reasons.push('Stop must be finite.');
  const riskPerUnit = Math.abs(entry - stop);
  if (!(riskPerUnit > 0)) reasons.push('Risk per unit must be positive (entry ≠ stop).');
  const leverage = Math.max(1, Number(lev) || 1);
  if (reasons.length) {
    return { valid: false, reasons, riskAmount: 0, riskPerUnit, positionSize: 0, notional: 0, margin: 0, leverage, capped: false };
  }
  const riskAmount = balance * (riskPct / 100);
  let positionSize = riskAmount / riskPerUnit;
  let capped = false;
  const maxSize = (balance * leverage) / entry;
  if (positionSize > maxSize) {
    positionSize = maxSize;
    capped = true;
    reasons.push(`Size capped: notional limited to balance × ${leverage}× leverage.`);
  }
  const notional = positionSize * entry;
  return {
    valid: positionSize > 0 && fin(positionSize),
    reasons: positionSize > 0 && fin(positionSize) ? reasons : [...reasons, 'Position size is not positive.'],
    riskAmount, riskPerUnit, positionSize, notional,
    margin: notional / leverage, leverage, capped
  };
}

// Expected P&L for one target from the same position size. Costs follow the
// backtester convention exactly: (fee% + slippage%) on entry notional AND on
// exit notional, counted once each — never double-counted. Funding is
// excluded (holding time unknown live) and stated as such.
export function expectedForTP({ entry, tp, size, dir, feePct = 0, slippagePct = 0 }) {
  void dir; // direction is encoded in the caller's (TP − entry) sign convention
  const costRate = (Number(feePct) || 0) + (Number(slippagePct) || 0);
  const gross = Math.abs(tp - entry) * size;
  const entryCost = Math.abs(entry * size) * (costRate / 100);
  const exitCost = Math.abs(tp * size) * (costRate / 100);
  const costs = entryCost + exitCost;
  void dir;
  return { gross, costs, net: gross - costs, entryCost, exitCost };
}

// Structural validation (§10). Never show an INVALID plan as BUY/SELL.
export function validatePlan({ dir, entry, stop, tps }) {
  const reasons = [];
  if (dir !== 1 && dir !== -1) reasons.push('Direction must be LONG (1) or SHORT (-1).');
  if (!fin(entry) || !(entry > 0)) reasons.push('Entry must be a finite positive price.');
  if (!fin(stop)) reasons.push('Stop loss must be finite.');
  const prices = tps || [];
  if (prices.length < 3) reasons.push('Three targets (TP1/TP2/TP3) are required.');
  prices.forEach((t, k) => {
    if (!fin(t)) reasons.push(`TP${k + 1} must be a finite price.`);
  });
  if (dir === 1 && fin(stop) && fin(entry) && !(stop < entry)) {
    reasons.push(`Invalid LONG: stop ${fmtP(stop)} must be below entry ${fmtP(entry)}.`);
  }
  if (dir === -1 && fin(stop) && fin(entry) && !(stop > entry)) {
    reasons.push(`Invalid SHORT: stop ${fmtP(stop)} must be above entry ${fmtP(entry)}.`);
  }
  if (dir === 1) {
    if (fin(prices[0]) && fin(entry) && !(prices[0] > entry)) reasons.push('Invalid LONG: TP1 must be above entry.');
    if (fin(prices[1]) && fin(prices[0]) && !(prices[1] > prices[0])) reasons.push('Invalid LONG: TP2 must be above TP1.');
    if (fin(prices[2]) && fin(prices[1]) && !(prices[2] > prices[1])) reasons.push('Invalid LONG: TP3 must be above TP2.');
  }
  if (dir === -1) {
    if (fin(prices[0]) && fin(entry) && !(prices[0] < entry)) reasons.push('Invalid SHORT: TP1 must be below entry.');
    if (fin(prices[1]) && fin(prices[0]) && !(prices[1] < prices[0])) reasons.push('Invalid SHORT: TP2 must be below TP1.');
    if (fin(prices[2]) && fin(prices[1]) && !(prices[2] < prices[1])) reasons.push('Invalid SHORT: TP3 must be below TP2.');
  }
  return { status: reasons.length ? 'INVALID' : 'VALID', reasons };
}

// ---------------------------------------------------------------------------
// Structure-derived inputs (causal engine snapshot only)
// ---------------------------------------------------------------------------

function resolveStop({ engState, dir, entry, atr, stopAtrMult }) {
  const buf = atr * 0.2;
  const cands = [];
  if (dir === 1) {
    const lows = (engState.swingsL || []).filter((s) => s.price < entry).sort((a, b) => b.price - a.price);
    if (lows[0] && entry - lows[0].price <= atr * 3) {
      cands.push({ price: lows[0].price - buf, reason: `Below protected swing low ${fmtP(lows[0].price)} + 0.2 ATR buffer` });
    }
    const obs = (engState.obs || [])
      .filter((o) => o.direction === 1 && (o.state === 'active' || o.state === 'mitigated') && o.top <= entry)
      .sort((a, b) => b.top - a.top);
    if (obs[0] && entry - obs[0].top <= atr * 3) {
      cands.push({ price: obs[0].top - buf, reason: `Below bullish order-block top ${fmtP(obs[0].top)} (OB invalidation) + 0.2 ATR buffer` });
    }
    const fvgs = (engState.fvgs || [])
      .filter((g) => g.direction === 1 && g.state !== 'filled' && g.top <= entry)
      .sort((a, b) => b.top - a.top);
    if (fvgs[0] && entry - fvgs[0].top <= atr * 3) {
      cands.push({ price: fvgs[0].top - buf, reason: `Below bullish FVG top ${fmtP(fvgs[0].top)} (FVG invalidation) + 0.2 ATR buffer` });
    }
  } else {
    const highs = (engState.swingsH || []).filter((s) => s.price > entry).sort((a, b) => a.price - b.price);
    if (highs[0] && highs[0].price - entry <= atr * 3) {
      cands.push({ price: highs[0].price + buf, reason: `Above protected swing high ${fmtP(highs[0].price)} + 0.2 ATR buffer` });
    }
    const obs = (engState.obs || [])
      .filter((o) => o.direction === -1 && (o.state === 'active' || o.state === 'mitigated') && o.bottom >= entry)
      .sort((a, b) => a.bottom - b.bottom);
    if (obs[0] && obs[0].bottom - entry <= atr * 3) {
      cands.push({ price: obs[0].bottom + buf, reason: `Above bearish order-block bottom ${fmtP(obs[0].bottom)} (OB invalidation) + 0.2 ATR buffer` });
    }
    const fvgs = (engState.fvgs || [])
      .filter((g) => g.direction === -1 && g.state !== 'filled' && g.bottom >= entry)
      .sort((a, b) => a.bottom - b.bottom);
    if (fvgs[0] && fvgs[0].bottom - entry <= atr * 3) {
      cands.push({ price: fvgs[0].bottom + buf, reason: `Above bearish FVG bottom ${fmtP(fvgs[0].bottom)} (FVG invalidation) + 0.2 ATR buffer` });
    }
  }
  if (cands.length) return cands[0];
  const fallback = dir === 1 ? entry - atr * stopAtrMult : entry + atr * stopAtrMult;
  return { price: fallback, reason: `${stopAtrMult}× ATR fallback (no structure within 3 ATR)` };
}

function resolveEntryZone({ candles, ind, engState, dir, entry }) {
  const n = candles.length;
  const atr = ind.atr?.[n - 1] ?? Math.abs(entry) * 0.01;
  let zoneRef = null;
  let zoneLabel = '';
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
  let zone;
  if (zoneRef != null && Math.abs(entry - zoneRef) <= atr * 1.5) {
    zone = dir === 1 ? { low: zoneRef, high: entry } : { low: entry, high: zoneRef };
  } else {
    zone = dir === 1 ? { low: entry - atr * 0.25, high: entry } : { low: entry, high: entry + atr * 0.25 };
    zoneLabel = zoneLabel || 'Last close ± ¼ ATR';
  }
  return { zone, zoneLabel, zoneMid: (zone.low + zone.high) / 2 };
}

// Order + gap enforcement: structural targets that are too close or out of
// order are skipped in favour of the next candidate; empty slots use honest
// R-multiple projections (labeled as projections, never as structure).
function resolveTargets({ candles, engState, pools, prevDay, prevWeek, dir, entry, risk, atr }) {
  const raw = structureTargets({ candles, engState, pools, prevDay, prevWeek, dir, entry, stop: dir === 1 ? entry - risk : entry + risk });
  const minGap = Math.max(risk * 0.25, atr * 0.1, 1e-9);
  const kept = [];
  for (const t of raw) {
    if (!fin(t.price)) continue;
    const prev = kept.length ? kept[kept.length - 1].price : entry;
    const ok = dir === 1 ? t.price > prev + minGap : t.price < prev - minGap;
    if (ok) kept.push({ key: `T${kept.length + 1}`, price: t.price, reason: t.reason });
    if (kept.length === 3) break;
  }
  while (kept.length < 3) {
    const k = kept.length;
    const rMult = R_LADDER[k];
    const prev = kept.length ? kept[k - 1].price : entry;
    let price = dir === 1 ? entry + risk * rMult : entry - risk * rMult;
    // Projections must still respect ordering — extend past the last kept level.
    if (dir === 1) price = Math.max(price, prev + minGap);
    else price = Math.min(price, prev - minGap);
    const actualRR = dir === 1 ? (price - entry) / risk : (entry - price) / risk;
    kept.push({ key: `T${k + 1}`, price, reason: `${actualRR.toFixed(2)}R projection (no further structure)` });
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Canonical builder — single authority for the live trade plan
// ---------------------------------------------------------------------------

export function buildCanonicalPlan({
  candles, ind, eng, dir, entry,
  pools = [], prevDay = null, prevWeek = null,
  account = { balance: 10000, riskPct: 1 },
  leverage = 1,
  costs = { feePct: 0.05, slippagePct: 0.02 },
  liqModel = 'isolated-simple', liqMmr = 0.01,
  stopAtrMult = 2,
  minRR = DEFAULT_MIN_RR
}) {
  const n = (candles || []).length;
  if (dir !== 1 && dir !== -1) return null; // no directional edge → no plan
  if (!n || !ind || !eng) return null;
  if (!fin(entry) || !(entry > 0)) {
    return invalidPlan(dir, entry, 'Entry must be a finite positive price.');
  }
  const atr = ind.atr?.[n - 1] ?? Math.abs(entry) * 0.01;
  if (!(atr > 0)) return invalidPlan(dir, entry, 'ATR must be positive.');
  const engState = stateAt(eng, n - 1);

  // ONE canonical entry: the approved execution price. The zone is display only.
  const { zone, zoneLabel, zoneMid } = resolveEntryZone({ candles, ind, engState, dir, entry });

  const stop = resolveStop({ engState, dir, entry, atr, stopAtrMult });
  const risk = Math.abs(entry - stop.price);
  if (!(risk > 0)) return invalidPlan(dir, entry, 'Risk distance must be positive (entry ≠ stop).');

  const targets = resolveTargets({ candles, engState, pools, prevDay, prevWeek, dir, entry, risk, atr });
  const tps = targets.map((t) => t.price);

  const rr = {
    tp1: calcRR(entry, stop.price, tps[0], dir),
    tp2: calcRR(entry, stop.price, tps[1], dir),
    tp3: calcRR(entry, stop.price, tps[2], dir)
  };
  const rrFlags = {
    tp1: fin(rr.tp1) && rr.tp1 < (minRR.tp1 ?? DEFAULT_MIN_RR.tp1),
    tp2: fin(rr.tp2) && rr.tp2 < (minRR.tp2 ?? DEFAULT_MIN_RR.tp2),
    tp3: fin(rr.tp3) && rr.tp3 < (minRR.tp3 ?? DEFAULT_MIN_RR.tp3)
  };

  const sizing = sizePosition({
    balance: account.balance, riskPct: account.riskPct,
    entry, stop: stop.price, lev: leverage
  });

  const feePct = Number(costs.feePct) || 0;
  const slippagePct = Number(costs.slippagePct) || 0;
  const expected = { tp1: null, tp2: null, tp3: null };
  if (sizing.valid) {
    ['tp1', 'tp2', 'tp3'].forEach((k, i) => {
      expected[k] = expectedForTP({ entry, tp: tps[i], size: sizing.positionSize, dir, feePct, slippagePct });
    });
  }
  const stopExitCost = sizing.valid
    ? Math.abs(stop.price * sizing.positionSize) * ((feePct + slippagePct) / 100)
    : 0;
  const entryCost = sizing.valid
    ? Math.abs(entry * sizing.positionSize) * ((feePct + slippagePct) / 100)
    : 0;
  const maxLoss = sizing.valid
    ? { gross: sizing.riskAmount, costs: entryCost + stopExitCost, net: sizing.riskAmount + entryCost + stopExitCost }
    : { gross: 0, costs: 0, net: 0 };

  const lev = Math.max(1, Number(leverage) || 1);
  const liqPrice = lev > 1 ? liquidationPrice(liqModel, entry, dir, lev, liqMmr) : null;
  const stopDist = Math.abs(entry - stop.price);
  const liq = {
    model: liqModel, modelLabel: liqLabel(liqModel),
    price: liqPrice,
    distance: liqPrice != null ? Math.abs(entry - liqPrice) : null,
    distancePct: liqPrice != null && entry ? (Math.abs(entry - liqPrice) / entry) * 100 : null,
    stopDistance: stopDist,
    stopDistancePct: entry ? (stopDist / entry) * 100 : 0,
    warnings: []
  };
  if (liqPrice != null) {
    const diesFirst = dir === 1 ? liqPrice > stop.price : liqPrice < stop.price;
    if (diesFirst) liq.warnings.push('Liquidation is reached BEFORE the stop — the position dies first. Lower leverage.');
    else if (liq.distance < stopDist * 1.5) liq.warnings.push('Liquidation sits uncomfortably close to the stop. Lower leverage or widen the distance.');
  }

  const validation = validatePlan({ dir, entry, stop: stop.price, tps });
  if (!sizing.valid) {
    validation.reasons.push(...sizing.reasons.map((r) => `Sizing: ${r}`));
    validation.status = 'INVALID';
  }
  if (!fin(rr.tp1) || !fin(rr.tp2) || !fin(rr.tp3)) {
    validation.reasons.push('RR values must be finite.');
    validation.status = 'INVALID';
  }

  const direction = dir === 1 ? 'LONG' : 'SHORT';
  return {
    // Canonical core — everything downstream references these.
    direction, dir, entry,
    entryZone: { low: zone.low, high: zone.high },
    zoneLabel, zoneMid,
    stopLoss: stop.price, stopReason: stop.reason,
    stopDistance: stopDist,
    stopDistancePercent: entry ? (stopDist / entry) * 100 : 0,
    riskPerUnit: stopDist,
    targets: targets.map((t, i) => ({
      key: t.key, price: t.price, reason: t.reason,
      rr: [rr.tp1, rr.tp2, rr.tp3][i],
      meetsMinRR: ![rrFlags.tp1, rrFlags.tp2, rrFlags.tp3][i]
    })),
    rr, rrFlags, minRR: { ...DEFAULT_MIN_RR, ...minRR },
    sizing, expected, maxLoss, liq,
    validation,
    status: validation.status,
    fundingNote: 'Funding excluded: holding time is unknown before entry.',
    // Legacy-shaped fields for existing consumers (assessSetup, chart levels).
    stop: stop.price,
    t1: { price: tps[0], reason: targets[0].reason },
    zone: [zone.low, zone.high]
  };
}

function invalidPlan(dir, entry, reason) {
  return {
    direction: dir === 1 ? 'LONG' : 'SHORT', dir, entry,
    entryZone: null, zoneLabel: '', zoneMid: null,
    stopLoss: null, stopReason: '', stopDistance: 0, stopDistancePercent: 0, riskPerUnit: 0,
    targets: [], rr: { tp1: NaN, tp2: NaN, tp3: NaN },
    rrFlags: { tp1: false, tp2: false, tp3: false }, minRR: { ...DEFAULT_MIN_RR },
    sizing: { valid: false, reasons: [reason], riskAmount: 0, riskPerUnit: 0, positionSize: 0, notional: 0, margin: 0, leverage: 1, capped: false },
    expected: { tp1: null, tp2: null, tp3: null },
    maxLoss: { gross: 0, costs: 0, net: 0 },
    liq: { model: 'isolated-simple', modelLabel: liqLabel('isolated-simple'), price: null, distance: null, distancePct: null, stopDistance: 0, stopDistancePercent: 0, warnings: [] },
    validation: { status: 'INVALID', reasons: [reason] },
    status: 'INVALID',
    fundingNote: 'Funding excluded: holding time is unknown before entry.',
    stop: null, t1: { price: NaN, reason: '' }, zone: null
  };
}

// ---------------------------------------------------------------------------
// Candle status (§13): CLOSED vs FORMING bar, from UTC bucket alignment
// ---------------------------------------------------------------------------

export function candleStatus(candles, timeframe) {
  const n = (candles || []).length;
  if (!n) return { forming: false, label: 'NO DATA', ageBars: 0 };
  const ms = TF_MS[timeframe] || 36e5;
  const last = candles[n - 1].timestamp;
  const bucketStart = Math.floor(last / ms) * ms;
  const forming = bucketStart + ms > Date.now();
  const ageMs = Date.now() - last;
  return {
    forming,
    label: forming ? 'FORMING — may change before close' : 'CLOSED',
    ageBars: ageMs / ms,
    bucketStart
  };
}
