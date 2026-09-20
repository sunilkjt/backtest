// Single-position, bar-close execution backtester with ATR risk management.
// No lookahead: signals at bar i execute at close of bar i.

import { getStrategy, STRATEGIES } from './strategies.js';

export const DEFAULT_RISK = {
  initialCapital: 10000,
  riskPct: 2,          // % of equity risked per trade (via ATR stop)
  feePct: 0.05,        // % per side (0.05% typical)
  slippagePct: 0.02,   // % per side
  stopAtrMult: 2.0,    // stop distance = mult * ATR
  takeProfitRR: 2.0,   // take profit = RR * risk distance
  allowShort: true,
  maxBarsInTrade: 0    // 0 = no time stop
};

function applyCost(notional, pct) {
  return notional * (pct / 100);
}

export function runBacktest(candles, ind, strategyId, risk = {}) {
  const r = { ...DEFAULT_RISK, ...risk };
  const strat = getStrategy(strategyId);
  const equity = [];
  let cash = r.initialCapital;
  let position = null; // {dir, entry, qty, stop, target, entryIdx, entryEquity, riskAmt}
  const trades = [];
  let equityPeak = r.initialCapital;
  let peakIdx = 0;

  const atrArr = ind.atr;

  const markEquity = (i) => {
    const price = candles[i].close;
    let eq = cash;
    if (position) {
      const pnl = (price - position.entry) * position.qty * position.dir;
      eq = position.entryEquity + pnl;
    }
    equity.push({ index: i, timestamp: candles[i].timestamp, equity: eq });
    if (eq > equityPeak) { equityPeak = eq; peakIdx = equity.length - 1; }
    return eq;
  };

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const atr = atrArr[i] ?? (price * 0.01);

    // 1) manage open position (stop / target / time-stop checked on bar high/low)
    if (position) {
      const bar = candles[i];
      const longHitStop = position.dir === 1 && bar.low <= position.stop;
      const longHitTgt = position.dir === 1 && bar.high >= position.target;
      const shortHitStop = position.dir === -1 && bar.high >= position.stop;
      const shortHitTgt = position.dir === -1 && bar.low <= position.target;
      // if both hit same bar, assume stop first (conservative)
      let exitPrice = null, reason = '';
      if (longHitStop || shortHitStop) { exitPrice = position.stop; reason = 'stop'; }
      else if (longHitTgt || shortHitTgt) { exitPrice = position.target; reason = 'target'; }
      else if (r.maxBarsInTrade > 0 && i - position.entryIdx >= r.maxBarsInTrade) { exitPrice = price; reason = 'time-stop'; }

      if (exitPrice != null) {
        const gross = (exitPrice - position.entry) * position.qty * position.dir;
        const notional = Math.abs(position.qty * exitPrice);
        const costs = applyCost(Math.abs(position.qty * position.entry), r.feePct + r.slippagePct)
          + applyCost(notional, r.feePct + r.slippagePct);
        const net = gross - costs;
        cash = position.entryEquity + net;
        trades.push({
          ...position, exit: exitPrice, exitIndex: i, exitTime: candles[i].timestamp,
          gross, costs, net, retPct: (net / position.entryEquity) * 100,
          reason, barsHeld: i - position.entryIdx
        });
        position = null;
        markEquity(i);
        continue;
      }
    }

    // 2) strategy signal
    let sig = 0;
    try { sig = strat.signal(candles, ind, i); } catch { sig = 0; }
    if (sig !== 0 && !(sig === -1 && !r.allowShort)) {
      // flip / reverse: close existing at market then open new
      if (position) {
        const gross = (price - position.entry) * position.qty * position.dir;
        const costs = applyCost(Math.abs(position.qty * position.entry), r.feePct + r.slippagePct)
          + applyCost(Math.abs(position.qty * price), r.feePct + r.slippagePct);
        const net = gross - costs;
        cash = position.entryEquity + net;
        trades.push({
          ...position, exit: price, exitIndex: i, exitTime: candles[i].timestamp,
          gross, costs, net, retPct: (net / position.entryEquity) * 100,
          reason: 'reverse', barsHeld: i - position.entryIdx
        });
        position = null;
      }
      const eqNow = markEquity(i); // equity before entry (position flat now)
      const dir = sig;
      const stopDist = Math.max(atr * r.stopAtrMult, price * 0.0005);
      const stop = dir === 1 ? price - stopDist : price + stopDist;
      const target = dir === 1 ? price + stopDist * r.takeProfitRR : price - stopDist * r.takeProfitRR;
      const riskAmt = eqNow * (r.riskPct / 100);
      const qty = stopDist > 0 ? riskAmt / stopDist : (eqNow * 0.1) / price;
      if (qty > 0 && Number.isFinite(qty)) {
        position = {
          dir, entry: price, qty, stop, target, entryIdx: i,
          entryTime: candles[i].timestamp, entryEquity: eqNow, riskAmt
        };
        // equity unchanged on entry bar (mark already pushed) — avoid double push
        continue;
      }
    }
    markEquity(i);
  }

  // close dangling position at last close
  if (position) {
    const price = candles[candles.length - 1].close;
    const gross = (price - position.entry) * position.qty * position.dir;
    const costs = applyCost(Math.abs(position.qty * position.entry), r.feePct + r.slippagePct)
      + applyCost(Math.abs(position.qty * price), r.feePct + r.slippagePct);
    const net = gross - costs;
    trades.push({
      ...position, exit: price, exitIndex: candles.length - 1,
      exitTime: candles[candles.length - 1].timestamp,
      gross, costs, net, retPct: (net / position.entryEquity) * 100,
      reason: 'end-of-data', barsHeld: candles.length - 1 - position.entryIdx
    });
    cash = position.entryEquity + net;
    equity[equity.length - 1].equity = cash;
  }

  const stats = calcStats(trades, equity, r.initialCapital);
  return { trades, equity, stats, strategyId };
}

export function calcStats(trades, equity, initialCapital) {
  const n = trades.length;
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net, 0));
  const totalNet = trades.reduce((s, t) => s + t.net, 0);
  const finalEquity = equity.length ? equity[equity.length - 1].equity : initialCapital;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  // max drawdown
  let peak = initialCapital, maxDD = 0, maxDDPct = 0;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDD) maxDD = dd;
    const ddp = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddp > maxDDPct) maxDDPct = ddp;
  }

  // Sharpe on per-trade returns (annualized approx with 252 assumption is misleading for mixed TF;
  // we annualize per-bar using equity curve sampling instead)
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
      sharpe = sd > 0 ? (mean / sd) * Math.sqrt(Math.min(rets.length, 252)) : 0;
    }
  }

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const winRate = n > 0 ? (wins.length / n) * 100 : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = n > 0 ? totalNet / n : 0;
  const avgBars = n > 0 ? trades.reduce((s, t) => s + (t.barsHeld || 0), 0) / n : 0;
  const best = n ? Math.max(...trades.map((t) => t.net)) : 0;
  const worst = n ? Math.min(...trades.map((t) => t.net)) : 0;

  return {
    trades: n, wins: wins.length, losses: losses.length, winRate,
    totalNet, totalReturnPct, finalEquity, profitFactor,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct,
    sharpe, expectancy, avgWin, avgLoss, avgBars, best, worst
  };
}

export function compareAll(candles, ind, risk) {
  return STRATEGIES.map((s) => runBacktest(candles, ind, s.id, risk));
}
