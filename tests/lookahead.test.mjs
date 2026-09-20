// Look-ahead regression tests (§12 + §13 of the correctness audit).
//
// Critical invariant: for every timestamp T, running the backtester on
// DATA[0:T] (with indicators recomputed on the prefix — recomputing on the
// full series and slicing would itself be the leak) must produce the same
// signals and the same fully-closed trades up to T as the full run.
// Targeted tests then engineer specific futures (FVG fill, OB invalidation,
// swing confirmation, BOS, late liquidity) and assert the prefix is blind.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../src/lib/backtest.js';
import { computeAll } from '../src/lib/indicators.js';
import { generateSignalSeries, STRATEGIES } from '../src/lib/strategies.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function C(t, o, h, l, c, v = 100) {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
}

// Full §13 harness: prefix run vs full run, compared strictly before the
// truncation boundary (the dangling end-of-data exit is a truncation artifact,
// not bias, so only trades closed before the last prefix bar are compared).
function assertPrefixInvariant(candles, T, ids, label) {
  const prefix = candles.slice(0, T);
  const indPre = computeAll(prefix);
  const indFull = computeAll(candles);
  for (const id of ids) {
    const sigPre = generateSignalSeries(prefix, indPre, id, {});
    const sigFull = generateSignalSeries(candles, indFull, id, {});
    for (let i = 0; i < T; i++) {
      assert.equal(sigPre[i], sigFull[i], `${label}/${id}: signal at bar ${i} changed when future appended`);
    }
    const rPre = runBacktest(prefix, indPre, id, { initialCapital: 10000 });
    const rFull = runBacktest(candles, indFull, id, { initialCapital: 10000 });
    const closedPre = rPre.trades.filter((t) => t.exitIndex < T - 1);
    const closedFull = rFull.trades.filter((t) => t.exitIndex < T - 1);
    assert.equal(closedPre.length, closedFull.length, `${label}/${id}: trade count before T diverged`);
    for (let k = 0; k < closedPre.length; k++) {
      const a = closedPre[k], b = closedFull[k];
      for (const f of ['entryIdx', 'exitIndex', 'entry', 'exit', 'qty', 'reason', 'dir']) {
        assert.equal(a[f], b[f], `${label}/${id}: trade ${k} field ${f} diverged`);
      }
      assert.ok(Math.abs(a.net - b.net) < 1e-9, `${label}/${id}: trade ${k} net diverged`);
    }
  }
}

const ALL_IDS = STRATEGIES.map((s) => s.id);

describe('§13 backtest invariant (prefix == full up to T)', () => {
  it('holds on demo data for all 13 strategies at two cut points', () => {
    for (const sym of ['BTC', 'ETH']) {
      const candles = generateDemoCandles(sym, '1h', 400);
      assertPrefixInvariant(candles, 200, ALL_IDS, `demo-${sym}@200`);
      assertPrefixInvariant(candles, 300, ALL_IDS, `demo-${sym}@300`);
    }
  });
  it('holds with leverage + params active', () => {
    const candles = generateDemoCandles('SOL', '1h', 400);
    const T = 250;
    const prefix = candles.slice(0, T);
    const iP = computeAll(prefix), iF = computeAll(candles);
    for (const id of ['ema-rsi', 'ict-fvg', 'ict-ob', 'smc-bos']) {
      const p = { oversold: 40, minSizeATR: 0.5, dispMin: 0.5, atrMin: 0.3 };
      const a = runBacktest(prefix, iP, id, { initialCapital: 5000, leverage: 5 }, p);
      const b = runBacktest(candles, iF, id, { initialCapital: 5000, leverage: 5 }, p);
      const ca = a.trades.filter((t) => t.exitIndex < T - 1);
      const cb = b.trades.filter((t) => t.exitIndex < T - 1);
      assert.equal(ca.length, cb.length, `${id}: leveraged trade count diverged`);
      for (let k = 0; k < ca.length; k++) assert.equal(ca[k].exit, cb[k].exit, `${id}: trade ${k} exit diverged`);
    }
  });
});

describe('§12 targeted futures (prefix must stay blind)', () => {
  it('future FVG fill does not rewrite history', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 30; i++) { const p = 100 + Math.sin(i / 3); candles.push(C(t += 36e5, p, p + 0.4, p - 0.4, p)); }
    candles.push(C(t += 36e5, 100.4, 102.5, 100.3, 102.3)); // bullish FVG ~[101,102]
    for (let i = 0; i < 9; i++) candles.push(C(t += 36e5, 102.3, 102.8, 101.8, 102.4)); // holds (unfilled at T=40)
    const T = candles.length;
    for (let i = 0; i < 8; i++) candles.push(C(t += 36e5, 102 - i, 102.2 - i, 100.5 - i, 101 - i)); // crash fills it later
    assertPrefixInvariant(candles, T, ['ict-fvg', 'ict-smc', 'ema-rsi', 'smc-bos'], 'fvg-fill');
  });
  it('future OB invalidation does not rewrite history', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 30; i++) { const p = 100 + Math.sin(i / 4); candles.push(C(t += 36e5, p, p + 0.5, p - 0.5, p)); }
    candles.push(C(t += 36e5, 99.5, 100.2, 99.4, 100));   // opposing candle
    candles.push(C(t += 36e5, 100, 104, 99.8, 103.8));    // displacement → bullish OB
    for (let i = 0; i < 8; i++) candles.push(C(t += 36e5, 103.8, 104.4, 102.8, 103.5)); // intact at T
    const T = candles.length;
    for (let i = 0; i < 6; i++) candles.push(C(t += 36e5, 103 - i * 1.5, 103.2 - i * 1.5, 101 - i * 1.5, 101.5 - i * 1.5)); // violated later
    assertPrefixInvariant(candles, T, ['ict-ob', 'ict-smc', 'smc-bos', 'supertrend'], 'ob-kill');
  });
  it('swing confirmed only after its right-side bars complete', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 30; i++) { const p = 100 + Math.sin(i / 3); candles.push(C(t += 36e5, p, p + 0.5, p - 0.5, p)); }
    // sharp peak at bar 37: confirmation needs bars 38..40
    candles.push(C(t += 36e5, 101, 102, 100.8, 101.5));
    candles.push(C(t += 36e5, 101.5, 103, 101.4, 102.8));
    candles.push(C(t += 36e5, 102.8, 103.5, 102.6, 103.2));
    candles.push(C(t += 36e5, 103.2, 106, 103, 105.8));   // 33
    candles.push(C(t += 36e5, 105.8, 110, 105.5, 109.5)); // 34
    candles.push(C(t += 36e5, 109.5, 112, 109, 111.5));   // 35
    candles.push(C(t += 36e5, 111.5, 113, 111, 112.5));   // 36
    candles.push(C(t += 36e5, 112.5, 116, 112, 115.5));   // 37 peak
    candles.push(C(t += 36e5, 115.5, 116, 113, 114));     // 38
    candles.push(C(t += 36e5, 114, 114.5, 112, 113));     // 39 → T=40, peak unconfirmed
    const T = candles.length;
    candles.push(C(t += 36e5, 113, 113.5, 110, 111));     // 40 confirms the 37 peak
    candles.push(C(t += 36e5, 111, 111.5, 108, 109));
    assertPrefixInvariant(candles, T, ALL_IDS, 'swing-confirm');
  });
  it('BOS and late liquidity levels do not leak backwards', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 40; i++) { const p = 100 + Math.sin(i / 3) * 1.5; candles.push(C(t += 36e5, p, p + 0.6, p - 0.6, p)); }
    const T = candles.length; // 40: range only, levels of the future unknown
    for (const p of [104, 108, 112, 111, 110, 109, 108, 107]) candles.push(C(t += 36e5, p - 1, p + 0.5, p - 1.5, p));
    assertPrefixInvariant(candles, T, ALL_IDS, 'bos-future');
  });
});
