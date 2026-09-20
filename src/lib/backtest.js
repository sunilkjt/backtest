// Single-position, bar-close execution backtester with ATR risk management.
// No lookahead: signals at bar i execute at close of bar i.

import { getStrategy, STRATEGIES } from './strategies.js';
import { computeAll } from './indicators.js';
import { liquidationPrice, PERIODS_PER_YEAR } from './riskModels.js';

export { PERIODS_PER_YEAR };

export const DEFAULT_RISK = {
  initialCapital: 10000,
  riskPct: 2,          // % of equity risked per trade (via ATR stop)
  feePct: 0.05,        // % per side (commission)
  slippagePct: 0.02,   // % per side
  stopAtrMult: 2.0,    // stop distance = mult * ATR
  takeProfitRR: 2.0,   // take profit = RR * risk distance
  allowShort: true,
  maxBarsInTrade: 0,   // 0 = no time stop
  leverage: 1,         // 1 = spot; >1 scales notional + liquidation risk
  liquidationModel: 'isolated-simple', // see riskModels.js — always approximate
  liquidationMmr: 0.01, // maintenance margin for venue-style models
  periodsPerYear: 252, // bars/year of the traded timeframe (Sharpe annualization)
  funding: null        // [{timestamp, rate}] perp funding; positive = longs pay
};

function applyCost(notional, pct) {
  return notional * (pct / 100);
}

// Funding paid over a holding period: Σ rate × entry notional (longs pay when positive).
export function fundingCost(funding, entryTime, exitTime, notional, dir) {
  if (!Array.isArray(funding) || !funding.length) return 0;
  let cost = 0;
  for (const f of funding) {
    if (f.timestamp > entryTime && f.timestamp <= exitTime && Number.isFinite(f.rate)) {
      cost += f.rate * notional * (dir === 1 ? 1 : -1);
    }
  }
  return cost;
}

function closePosition(position, exitPrice, exitIndex, exitTime, r, reason) {
  const gross = (exitPrice - position.entry) * position.qty * position.dir;
  const notional = Math.abs(position.qty * exitPrice);
  const costs = applyCost(Math.abs(position.qty * position.entry), r.feePct + r.slippagePct)
    + applyCost(notional, r.feePct + r.slippagePct);
  const fund = fundingCost(r.funding, position.entryTime, exitTime, Math.abs(position.qty * position.entry), position.dir);
  const net = gross - costs - fund;
  return {
    ...position, exit: exitPrice, exitIndex, exitTime,
    gross, costs, fundingPaid: fund, net, retPct: (net / position.entryEquity) * 100,
    reason, barsHeld: exitIndex - position.entryIdx
  };
}

export function runBacktest(candles, ind, strategyId, risk = {}, sparams = {}) {
  const r = { ...DEFAULT_RISK, ...risk };
  const lev = Math.max(1, Number(r.leverage) || 1);
  const strat = getStrategy(strategyId);
  const equity = [];
  let cash = r.initialCapital;
  let position = null; // {dir, entry, qty, stop, target, liq, entryIdx, entryEquity, riskAmt}
  const trades = [];
  let equityPeak = r.initialCapital;

  const atrArr = ind.atr;

  const markEquity = (i) => {
    const price = candles[i].close;
    let eq = cash;
    if (position) {
      const pnl = (price - position.entry) * position.qty * position.dir;
      eq = position.entryEquity + pnl;
    }
    equity.push({ index: i, timestamp: candles[i].timestamp, equity: eq });
    if (eq > equityPeak) equityPeak = eq;
    return eq;
  };

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const atr = atrArr[i] ?? (price * 0.01);

    // 1) manage open position (liquidation → stop → target → time-stop)
    if (position) {
      const bar = candles[i];
      const liqHit = lev > 1 && position.liq != null && (
        (position.dir === 1 && bar.low <= position.liq) ||
        (position.dir === -1 && bar.high >= position.liq));
      const longHitStop = position.dir === 1 && bar.low <= position.stop;
      const longHitTgt = position.dir === 1 && bar.high >= position.target;
      const shortHitStop = position.dir === -1 && bar.high >= position.stop;
      const shortHitTgt = position.dir === -1 && bar.low <= position.target;
      let exitPrice = null, reason = '';
      if (liqHit) { exitPrice = position.liq; reason = 'liquidation'; }
      else if (longHitStop || shortHitStop) { exitPrice = position.stop; reason = 'stop'; }
      else if (longHitTgt || shortHitTgt) { exitPrice = position.target; reason = 'target'; }
      else if (r.maxBarsInTrade > 0 && i - position.entryIdx >= r.maxBarsInTrade) { exitPrice = price; reason = 'time-stop'; }

      if (exitPrice != null) {
        const t = closePosition(position, exitPrice, i, candles[i].timestamp, r, reason);
        cash = position.entryEquity + t.net;
        trades.push(t);
        position = null;
        markEquity(i);
        continue;
      }
    }

    // 2) strategy signal (user params threaded through — defaults when absent)
    let sig = 0;
    try { sig = strat.signal(candles, ind, i, sparams); } catch { sig = 0; }
    if (sig !== 0 && !(sig === -1 && !r.allowShort)) {
      if (position) {
        const t = closePosition(position, price, i, candles[i].timestamp, r, 'reverse');
        cash = position.entryEquity + t.net;
        trades.push(t);
        position = null;
      }
      const eqNow = markEquity(i);
      const dir = sig;
      const stopDist = Math.max(atr * r.stopAtrMult, price * 0.0005);
      const stop = dir === 1 ? price - stopDist : price + stopDist;
      const target = dir === 1 ? price + stopDist * r.takeProfitRR : price - stopDist * r.takeProfitRR;
      const riskAmt = eqNow * (r.riskPct / 100);
      let qty = stopDist > 0 ? riskAmt / stopDist : (eqNow * 0.1) / price;
      // leverage caps notional at equity × leverage
      const maxQty = (eqNow * lev) / price;
      if (qty > maxQty) qty = maxQty;
      if (qty > 0 && Number.isFinite(qty)) {
        const liq = lev > 1 ? liquidationPrice(r.liquidationModel || 'isolated-simple', price, dir, lev, r.liquidationMmr) : null;
        position = {
          dir, entry: price, qty, stop, target, liq, entryIdx: i,
          entryTime: candles[i].timestamp, entryEquity: eqNow, riskAmt, leverage: lev
        };
        continue;
      }
    }
    markEquity(i);
  }

  // close dangling position at last close
  if (position) {
    const t = closePosition(position, candles[candles.length - 1].close, candles.length - 1, candles[candles.length - 1].timestamp, r, 'end-of-data');
    trades.push(t);
    cash = position.entryEquity + t.net;
    equity[equity.length - 1].equity = cash;
  }

  const stats = calcStats(trades, equity, r.initialCapital, r.periodsPerYear);
  return { trades, equity, stats, strategyId };
}

export function calcStats(trades, equity, initialCapital, periodsPerYear = 252) {
  const n = trades.length;
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net, 0));
  const totalNet = trades.reduce((s, t) => s + t.net, 0);
  const finalEquity = equity.length ? equity[equity.length - 1].equity : initialCapital;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  let peak = initialCapital, maxDD = 0, maxDDPct = 0;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDD) maxDD = dd;
    const ddp = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddp > maxDDPct) maxDDPct = ddp;
  }

  let sharpe = 0;
  if (equity.length > 2) {
    const rets = [];
    for (let i = 1; i < equity.length; i++) {
      const prev = equity[i - 1].equity;
      if (prev > 0) rets.push((equity[i].equity - prev) / prev);
    }
    if (rets.length > 1) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
      // Timeframe-aware annualization: per-bar returns scale by bars/year
      // for the traded timeframe. Still an approximation — labeled Sharpe-like.
      const ppy = Number.isFinite(periodsPerYear) && periodsPerYear > 0 ? periodsPerYear : 252;
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(Math.min(rets.length, ppy)) : 0;
    }
  }

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const winRate = n > 0 ? (wins.length / n) * 100 : 0;
  const lossRate = n > 0 ? (losses.length / n) * 100 : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = n > 0 ? totalNet / n : 0;
  const avgBars = n > 0 ? trades.reduce((s, t) => s + (t.barsHeld || 0), 0) / n : 0;
  const best = n ? Math.max(...trades.map((t) => t.net)) : 0;
  const worst = n ? Math.min(...trades.map((t) => t.net)) : 0;

  return {
    trades: n, wins: wins.length, losses: losses.length, winRate, lossRate,
    totalNet, totalReturnPct, finalEquity,
    startEquity: equity.length ? equity[0].equity : initialCapital,
    profitFactor,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct,
    sharpe, expectancy, avgWin, avgLoss, avgBars,
    largestWin: best, largestLoss: worst, best, worst
  };
}

// Walk-forward: train on first `split` fraction (indicators recomputed on the
// slice — no peeking), test on the rest. Warmup history before the boundary
// feeds INDICATORS only: the OOS portfolio starts flat at the cut bar with
// fresh capital, so no pre-OOS P/L can leak into OOS accounting.
export function walkForward(candles, strategyId, risk = {}, split = 0.7, warmup = 200, sparams = {}) {
  const n = candles.length;
  const cut = Math.max(60, Math.floor(n * split));
  const isCandles = candles.slice(0, cut);
  const isRes = runBacktest(isCandles, computeAll(isCandles), strategyId, risk, sparams);
  const start = Math.max(0, cut - warmup);
  const indLong = computeAll(candles.slice(start));
  const off = cut - start;
  const oosCandles = candles.slice(cut);
  const oosInd = {};
  for (const k of Object.keys(indLong)) {
    oosInd[k] = Array.isArray(indLong[k]) ? indLong[k].slice(off) : indLong[k];
  }
  const oosRes = runBacktest(oosCandles, oosInd, strategyId, risk, sparams);
  const oosTrades = oosRes.trades
    .map((t) => ({ ...t, entryIdx: t.entryIdx + cut, exitIndex: t.exitIndex + cut }));
  const oosEquity = oosRes.equity
    .map((p) => ({ ...p, index: p.index + cut }));
  const oosStats = calcStats(oosTrades, oosEquity, risk.initialCapital ?? DEFAULT_RISK.initialCapital, risk.periodsPerYear);
  // OOS accounting is a fresh run: starting capital = initial capital, no
  // pre-OOS P/L leaks in. Reported explicitly per the audit spec.
  return {
    split, cut,
    is: { ...isRes, label: `In-sample (first ${Math.round(split * 100)}%)` },
    oos: {
      trades: oosTrades, equity: oosEquity, stats: oosStats, strategyId,
      label: `Out-of-sample (last ${Math.round((1 - split) * 100)}%)`,
      startEquity: oosStats.startEquity,
      endEquity: oosStats.finalEquity,
      oosReturn: oosStats.totalReturnPct,
      oosMaxDrawdown: oosStats.maxDrawdownPct,
      oosWinRate: oosStats.winRate,
      oosProfitFactor: oosStats.profitFactor
    }
  };
}

export function overfitWarnings(stats, oosStats, risk = {}) {
  const out = [];
  if (stats.trades < 20) out.push({ level: 'high', text: `Only ${stats.trades} trades — far too few to trust. Noise can look like edge. Widen the date range or candle count.` });
  else if (stats.trades < 50) out.push({ level: 'med', text: `${stats.trades} trades is a thin sample. Prefer 50+ before sizing up.` });
  if (stats.trades > 0 && stats.trades < 50 && Number.isFinite(stats.profitFactor) && stats.profitFactor > 3) out.push({ level: 'high', text: `Profit factor ${stats.profitFactor.toFixed(2)} on few trades — classic overfit signature. Verify out-of-sample.` });
  if (stats.maxDrawdownPct > 30) out.push({ level: 'med', text: `Max drawdown ${stats.maxDrawdownPct.toFixed(1)}% is severe — live slippage would likely make it worse.` });
  if (stats.totalReturnPct > 200) out.push({ level: 'med', text: `Return of ${stats.totalReturnPct.toFixed(0)}% is extraordinary — extraordinary claims need out-of-sample proof.` });
  if (oosStats) {
    if (oosStats.trades > 0 && stats.totalReturnPct > 0 && oosStats.totalReturnPct < stats.totalReturnPct * 0.5) out.push({ level: 'high', text: `Out-of-sample return (${oosStats.totalReturnPct.toFixed(1)}%) collapsed vs in-sample (${stats.totalReturnPct.toFixed(1)}%) — the edge did not travel. Possible overfitting.` });
    if (oosStats.trades > 0 && stats.totalNet > 0 && oosStats.totalNet < 0) out.push({ level: 'high', text: 'In-sample wins but out-of-sample loses — do not trade this as-is.' });
    if (oosStats.trades === 0) out.push({ level: 'med', text: 'No out-of-sample trades — the test window may be too short to judge.' });
  }
  if ((risk.leverage ?? 1) > 5) out.push({ level: 'med', text: `Leverage ${risk.leverage}× puts liquidation close to entry — one wick can end the backtest (and an account).` });
  return out;
}

export function compareAll(candles, ind, risk) {
  return STRATEGIES.map((s) => runBacktest(candles, ind, s.id, risk));
}

export function compareSelected(candles, ind, ids, risk, sparamsById = {}) {
  return STRATEGIES.filter((s) => ids.includes(s.id)).map((s) => runBacktest(candles, ind, s.id, risk, sparamsById[s.id] || {}));
}
