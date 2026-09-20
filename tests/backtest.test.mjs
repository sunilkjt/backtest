import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, calcStats, walkForward, overfitWarnings, fundingCost } from '../src/lib/backtest.js';
import { computeAll } from '../src/lib/indicators.js';
import { STRATEGIES } from '../src/lib/strategies.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function rising(n = 300, start = 100, step = 0.5) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { timestamp: i * 36e5, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 };
  });
}

describe('backtester', () => {
  it('books P&L with costs on a V-recovery (sma-cross)', () => {
    const candles = [];
    for (let i = 0; i < 150; i++) { const p = 200 - i * 0.5; candles.push({ timestamp: i * 36e5, open: p + 0.1, high: p + 0.3, low: p - 0.1, close: p, volume: 1000 }); }
    for (let i = 0; i < 150; i++) { const p = 125 + i * 0.5; candles.push({ timestamp: (150 + i) * 36e5, open: p - 0.1, high: p + 0.2, low: p - 0.2, close: p, volume: 1000 }); }
    const ind = computeAll(candles);
    const res = runBacktest(candles, ind, 'sma-cross', { initialCapital: 10000 });
    assert.ok(res.trades.length > 0);
    assert.equal(res.equity.length, candles.length - 1);
    const s = res.stats;
    assert.equal(s.winRate, (s.wins / s.trades) * 100);
    assert.ok(Math.abs(s.finalEquity - (10000 + s.totalNet)) < 1e-6);
    assert.ok(s.maxDrawdownPct >= 0);
    for (const t of res.trades) assert.ok(t.reason, 'every trade has an exit reason');
  });
  it('leverage caps notional and can liquidate', () => {
    const candles = rising(300, 100, 2); // violent trend
    const ind = computeAll(candles);
    const calm = runBacktest(candles, ind, 'ema-rsi', { leverage: 1 });
    const hot = runBacktest(candles, ind, 'ema-rsi', { leverage: 20 });
    assert.ok(hot.trades.length > 0);
    assert.ok(hot.trades.every((t) => t.leverage === 20));
    assert.ok(calm.stats.maxDrawdownPct >= 0 && hot.stats.maxDrawdownPct >= 0);
  });
  it('funding is charged over the holding period', () => {
    assert.equal(fundingCost([{ timestamp: 5, rate: 0.001 }], 0, 10, 10000, 1), 10);
    assert.equal(fundingCost([{ timestamp: 5, rate: 0.001 }], 0, 10, 10000, -1), -10);
    assert.equal(fundingCost([{ timestamp: 99, rate: 0.001 }], 0, 10, 10000, 1), 0);
  });
  it('walk-forward splits without peeking (indicators recomputed per side)', () => {
    const candles = generateDemoCandles('BTC', '1h', 400);
    const wf = walkForward(candles, 'ema-rsi', {}, 0.7, 200);
    assert.ok(wf.is.trades.length + wf.oos.trades.length > 0);
    assert.ok(wf.oos.trades.every((t) => t.entryIdx >= wf.cut));
  });
  it('overfit warnings fire on thin/degenerate results', () => {
    const w = overfitWarnings({ trades: 5, profitFactor: 5, maxDrawdownPct: 5, totalReturnPct: 10, totalNet: 10 }, { trades: 3, totalReturnPct: -5, totalNet: -5, winRate: 0 }, { leverage: 10 });
    assert.ok(w.some((x) => x.level === 'high'));
  });
  it('NO LOOKAHEAD: scrambling future bars never changes signal at i', () => {
    const candles = generateDemoCandles('ETH', '1h', 300);
    for (const strat of STRATEGIES) {
      for (const i of [60, 150, 290]) {
        const indFull = computeAll(candles);
        const expect = strat.signal(candles, indFull, i);
        const doctored = candles.map((c, j) => (j > i ? { ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3 } : c));
        const indDoc = computeAll(doctored);
        const got = strat.signal(doctored, indDoc, i);
        assert.equal(got, expect, `${strat.id} uses future data at bar ${i}`);
      }
    }
  });
  it('params still respect no-lookahead when overridden', () => {
    const candles = generateDemoCandles('ETH', '1h', 200);
    const ind = computeAll(candles);
    const p = { fast: 10, slow: 30, oversold: 40, overbought: 60, votes: 2, channel: 10, atrPeriod: 5, mult: 2, window: 8, lookback: 8, reclaimBars: 5, swingLR: 5 };
    for (const strat of STRATEGIES) {
      const i = 150;
      const expect = strat.signal(candles, ind, i, p);
      const doctored = candles.map((c, j) => (j > i ? { ...c, close: c.close * 2, high: c.high * 2, low: c.low * 2 } : c));
      assert.equal(strat.signal(doctored, computeAll(doctored), i, p), expect, `${strat.id} leaks with params`);
    }
  });
});

describe('strategy params', () => {
  it('lossRate is 0 (not 100) when no trades fire', () => {
    const s = calcStats([], [], 10000);
    assert.equal(s.trades, 0);
    assert.equal(s.winRate, 0);
    assert.equal(s.lossRate, 0);
  });
  it('rsi-rev gates change the signal series', () => {
    const candles = generateDemoCandles('BTC', '1h', 300);
    const ind = computeAll(candles);
    const strat = STRATEGIES.find((s) => s.id === 'rsi-rev');
    const a = candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i, {})));
    const b = candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i, { oversold: 50, overbought: 50 })));
    assert.ok(a.some((v, i) => v !== b[i]), 'wider gates must change at least one signal');
  });
  it('sma-cross periods change the signal series', () => {
    const candles = generateDemoCandles('BTC', '1h', 400);
    const ind = computeAll(candles);
    const strat = STRATEGIES.find((s) => s.id === 'sma-cross');
    const a = candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i, {})));
    const b = candles.map((_, i) => (i === 0 ? 0 : strat.signal(candles, ind, i, { fast: 10, slow: 30 })));
    assert.ok(a.some((v, i) => v !== b[i]), 'different windows must cross at different bars');
  });
  it('params flow into runBacktest + walkForward', () => {
    const candles = generateDemoCandles('BTC', '1h', 400);
    const ind = computeAll(candles);
    const r1 = runBacktest(candles, ind, 'rsi-rev', { initialCapital: 10000 }, {});
    const r2 = runBacktest(candles, ind, 'rsi-rev', { initialCapital: 10000 }, { oversold: 50, overbought: 50 });
    assert.ok(r1.stats.trades !== r2.stats.trades, 'params must affect the backtest');
    const wf = walkForward(candles, 'rsi-rev', { initialCapital: 10000 }, 0.7, 200, { oversold: 50 });
    assert.ok(wf.oos.trades.every((t) => t.entryIdx >= wf.cut));
  });
});
