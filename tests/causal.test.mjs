// Unit tests: causal engine lifecycles (§2–§6), walk-forward accounting (§9),
// timeframe-aware Sharpe (§11), liquidation models (§10).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEngine, stateAt, causalFor, fvgStateAt, obStateAt } from '../src/lib/ictEngine.js';
import { walkForward, calcStats } from '../src/lib/backtest.js';
import { liquidationPrice, liqLabel, PERIODS_PER_YEAR } from '../src/lib/riskModels.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function C(t, o, h, l, c, v = 100) {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
}

describe('causal engine lifecycles', () => {
  it('swings expose formation + confirmation, hidden until confirmed', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 20; i++) { const p = 100 + Math.sin(i / 2); candles.push(C(t += 36e5, p, p + 0.5, p - 0.5, p)); }
    const eng = buildEngine(candles, { swingL: 3, swingR: 3 });
    for (const s of [...eng.swingsH, ...eng.swingsL]) {
      assert.equal(s.confirmation, s.formation + 3);
      assert.ok(!stateAt(eng, s.confirmation - 1).swingsH.concat(stateAt(eng, s.confirmation - 1).swingsL).some((x) => x.formation === s.formation));
      assert.ok(stateAt(eng, s.confirmation).swingsH.concat(stateAt(eng, s.confirmation).swingsL).some((x) => x.formation === s.formation));
    }
    assert.ok(eng.swingsH.length + eng.swingsL.length > 0);
  });
  it('FVG runs fresh → partial → filled on the exact bars', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 10; i++) candles.push(C(t += 36e5, 100, 100.2, 99.8, 100));
    candles.push(C(t += 36e5, 100, 103, 101, 102.5));    // 10: gap over 100.2 → bullish FVG [100.2,101]
    candles.push(C(t += 36e5, 102.5, 102.8, 100.6, 101.5)); // 11: wick 100.6 enters, close holds → partial
    candles.push(C(t += 36e5, 101.5, 102, 101.2, 101.8));   // 12: holds → stays partial
    candles.push(C(t += 36e5, 101.8, 102, 99.0, 99.5));     // 13: close < bottom → filled
    const eng = buildEngine(candles);
    const g = eng.fvgs.find((x) => x.created === 10);
    assert.ok(g, 'FVG created at bar 10');
    assert.equal(fvgStateAt(g, 10), 'fresh');
    assert.equal(fvgStateAt(g, 11), 'partial');
    assert.equal(fvgStateAt(g, 12), 'partial');
    assert.equal(fvgStateAt(g, 13), 'filled');
    assert.equal(stateAt(eng, 10).fvgs.find((x) => x.created === 10).state, 'fresh');
  });
  it('OB runs candidate → confirmed → active → mitigated → invalidated → breaker', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 10; i++) candles.push(C(t += 36e5, 100, 100.3, 99.7, 100 - (i % 2) * 0.2));
    candles.push(C(t += 36e5, 100.1, 100.3, 99.8, 99.9));   // 10 opposing (down)
    candles.push(C(t += 36e5, 99.9, 103, 99.8, 102.8));     // 11 displacement up → candidate, zone [99.9,100.1]
    candles.push(C(t += 36e5, 102.8, 103.2, 102.0, 103.0)); // 12 intact → confirmed
    candles.push(C(t += 36e5, 103.0, 103.4, 102.5, 103.2)); // 13 untouched → active
    candles.push(C(t += 36e5, 103.2, 103.5, 99.5, 101.5));  // 14 wick in, close above → mitigated
    candles.push(C(t += 36e5, 101.5, 101.8, 99.0, 99.2));   // 15 close below bottom → invalidated
    candles.push(C(t += 36e5, 99.2, 101.5, 99.0, 101.2));   // 16 reclaim above top → breaker
    const eng = buildEngine(candles);
    const o = eng.obs.find((x) => x.created === 11);
    assert.ok(o, 'OB candidate at bar 11');
    assert.equal(obStateAt(o, 11), 'candidate');
    assert.equal(obStateAt(o, 12), 'confirmed');
    assert.equal(obStateAt(o, 13), 'active');
    assert.equal(obStateAt(o, 14), 'mitigated');
    assert.equal(obStateAt(o, 15), 'invalidated');
    assert.equal(obStateAt(o, 16), 'breaker');
    assert.ok(stateAt(eng, 16).breakers.length > 0);
  });
  it('BOS fires only against confirmed swings', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 40; i++) { const p = 100 + Math.sin(i / 3); candles.push(C(t += 36e5, p, p + 0.5, p - 0.5, p)); }
    candles.push(C(t += 36e5, 101, 106, 100.8, 105.8));
    candles.push(C(t += 36e5, 105.8, 107, 105, 106.5));
    candles.push(C(t += 36e5, 106.5, 107.5, 106, 107));
    candles.push(C(t += 36e5, 107, 107.5, 106, 106.8));
    const eng = buildEngine(candles);
    assert.ok(eng.bos.some((e) => e.direction === 1));
    for (const e of eng.bos) assert.ok(e.index >= 3, 'no BOS before any confirmation possible');
  });
  it('causalFor caches per dataset', () => {
    const candles = generateDemoCandles('BTC', '1h', 100);
    assert.equal(causalFor(candles), causalFor(candles));
  });
});

describe('walk-forward accounting (§9)', () => {
  it('OOS starts at initial capital with explicit start/end reporting', () => {
    const candles = generateDemoCandles('ETH', '1h', 400);
    const wf = walkForward(candles, 'ema-rsi', { initialCapital: 10000 }, 0.7, 200);
    assert.equal(wf.oos.equity[0].equity, 10000);
    assert.equal(wf.oos.startEquity, 10000);
    assert.equal(wf.oos.endEquity, wf.oos.stats.finalEquity);
    assert.ok(wf.oos.trades.every((t) => t.entryIdx >= wf.cut));
    for (const f of ['oosReturn', 'oosMaxDrawdown', 'oosWinRate', 'oosProfitFactor']) {
      assert.ok(Number.isFinite(wf.oos[f]) || wf.oos[f] === Infinity, f);
    }
  });
});

describe('Sharpe annualization (§11)', () => {
  it('scales with bars-per-year of the timeframe', () => {
    const equity = Array.from({ length: 300 }, (_, i) => ({ index: i, timestamp: i * 36e5, equity: 10000 + i * 10 + (i % 2) * 3 }));
    const a = calcStats([], equity, 10000, 252);
    const b = calcStats([], equity, 10000, 8760);
    assert.ok(a.sharpe > 0 && b.sharpe > 0);
    const L = equity.length - 1;
    const expected = Math.sqrt(Math.min(L, 8760) / Math.min(L, 252));
    assert.ok(Math.abs(b.sharpe / a.sharpe - expected) < 1e-9);
  });
  it('PERIODS_PER_YEAR covers every supported timeframe', () => {
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d', '1w']) {
      assert.ok(Number.isFinite(PERIODS_PER_YEAR[tf]) && PERIODS_PER_YEAR[tf] > 0, tf);
    }
  });
});

describe('liquidation models (§10)', () => {
  it('isolated-simple matches margin math, lev 1 → null', () => {
    assert.equal(liquidationPrice('isolated-simple', 100, 1, 10), 90);
    assert.ok(Math.abs(liquidationPrice('isolated-simple', 100, -1, 10) - 110) < 1e-9);
    assert.equal(liquidationPrice('isolated-simple', 100, 1, 1), null);
  });
  it('hyperliquid model differs by maintenance margin and stays labeled approx', () => {
    const a = liquidationPrice('isolated-simple', 100, 1, 10);
    const b = liquidationPrice('hyperliquid', 100, 1, 10);
    assert.ok(b > a, 'maintenance margin pushes liq closer to entry');
    assert.ok(liqLabel('hyperliquid').startsWith('Approx.'));
    assert.ok(liqLabel('isolated-simple').startsWith('Approx.'));
  });
});
