// Setup-engine tests: structure-derived targets, NO-TRADE filters, status,
// sessions, liquidity map. All inputs causal; plans must cite real levels.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../src/lib/indicators.js';
import { analyzeICT } from '../src/lib/ict.js';
import { buildSignal } from '../src/lib/signals.js';
import { tradeLevels } from '../src/lib/scores.js';
import { causalFor, stateAt } from '../src/lib/ictEngine.js';
import {
  categoryBreakdown, setupStrength, computePools, liquidityMap,
  sessionInfo, sizeFor, structureTargets, buildTradePlan, whyWait, assessSetup
} from '../src/lib/setup.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function ctx(sym = 'BTC', n = 300) {
  const candles = generateDemoCandles(sym, '1h', n);
  const ind = computeAll(candles);
  const ict = analyzeICT(candles);
  const signal = buildSignal(candles, ind, ict, { technical: 60, ict: 40 });
  const eng = causalFor(candles);
  const st = stateAt(eng, n - 1);
  const pools = computePools(st.swingsH, st.swingsL);
  return { candles, ind, ict, signal, eng, pools, n };
}

describe('setup engine', () => {
  it('breakdown earns/possible per category from fired components', () => {
    const { signal } = ctx();
    // Categories present depend on market conditions (only fired checks appear):
    // technical always covers Trend/Momentum/Volatility at minimum.
    const techRows = categoryBreakdown(signal.tech.components);
    const ictRows = categoryBreakdown(signal.ictS.components);
    assert.ok(techRows.length >= 3, `tech cats: ${techRows.map((r) => r.cat)}`);
    assert.ok(ictRows.length >= 8, `ict cats: ${ictRows.map((r) => r.cat)}`);
    for (const r of [...techRows, ...ictRows]) {
      assert.equal(r.possible, r.bull + r.bear);
      assert.equal(r.earned, Math.max(r.bull, r.bear));
    }
  });
  it('targets cite structure/liquidity and sit on the right side', () => {
    const { candles, ind, eng, pools, ict } = ctx();
    for (const dir of [1, -1]) {
      const levels = tradeLevels(candles, ind, ict, dir === 1 ? 'BUY' : 'SELL', {});
      const plan = buildTradePlan({ candles, ind, eng, levels, dir, pools, prevDay: ict.prevDay, prevWeek: ict.prevWeek });
      assert.ok(plan, 'plan exists');
      assert.ok(plan.targets.length === 3);
      for (const t of plan.targets) {
        assert.ok(Number.isFinite(t.price) && typeof t.reason === 'string' && t.reason.length > 3);
        if (dir === 1) assert.ok(t.price > plan.entry, 'long targets above entry');
        else assert.ok(t.price < plan.entry, 'short targets below entry');
      }
      assert.ok(plan.zone[0] <= plan.zone[1]);
      assert.ok(typeof plan.invalidation === 'string' && plan.invalidation.length > 10);
    }
  });
  it('NO TRADE fires on low confluence and thin RR', () => {
    const { candles, eng, signal } = ctx();
    const low = assessSetup({ candles, eng, signal, plan: { rr: 3, t1: { price: 1 }, stop: 0 }, mtf: null, minConf: 99, minRR: 1.5 });
    assert.equal(low.status, 'NO TRADE');
    const thin = assessSetup({ candles, eng, signal: { ...signal, direction: 'BUY', score: 80 }, plan: { rr: 0.5, t1: { price: 1 }, stop: 0 }, mtf: null, minConf: 50, minRR: 2 });
    assert.equal(thin.status, 'NO TRADE');
    assert.ok(thin.statusReasons.join(' ').includes('Risk/reward'));
  });
  it('strength tiers never promise probability', () => {
    assert.equal(setupStrength('BUY', 85, 'CONFIRMED').label, 'STRONG BUY');
    assert.equal(setupStrength('SELL', 60, 'CONFIRMED').label, 'SELL');
    assert.equal(setupStrength('BUY', 90, 'NO TRADE').label, 'NO TRADE');
    assert.equal(setupStrength('NEUTRAL', 50, 'WAIT FOR CONFIRMATION').label, 'NO TRADE');
  });
  it('whyWait surfaces evidence, capped and honest', () => {
    const { candles, ind, eng, signal, ict } = ctx();
    const dir = signal.direction === 'BUY' ? 1 : -1;
    const levels = tradeLevels(candles, ind, ict, signal.direction === 'NEUTRAL' ? 'BUY' : signal.direction, {});
    const plan = buildTradePlan({ candles, ind, eng, levels, dir, pools: computePools(...(() => { const s = stateAt(eng, candles.length - 1); return [s.swingsH, s.swingsL]; })()), prevDay: ict.prevDay, prevWeek: ict.prevWeek });
    const risks = whyWait({ candles, ind, eng, signal, regime: null, mtf: null, plan, minRR: 2, dir });
    assert.ok(Array.isArray(risks) && risks.length <= 8);
    for (const r of risks) assert.ok(r.text.length > 10 && !/guarantee|will win|100%/i.test(r.text));
  });
  it('sessions respect timezone and report range', () => {
    const { candles } = ctx();
    const a = sessionInfo(candles, 0);
    const b = sessionInfo(candles, 8);
    assert.ok(a && b && Number.isFinite(a.dayHigh) && a.dayHigh >= a.dayLow);
    assert.ok(a.dayRange >= 0);
  });
  it('liquidity map splits buy/sell sides with states', () => {
    const { candles, eng, ict } = ctx();
    const st = stateAt(eng, candles.length - 1);
    const pools = computePools(st.swingsH, st.swingsL);
    const m = liquidityMap({ pools, sweeps: st.sweeps, prevDay: ict.prevDay, prevWeek: ict.prevWeek, lastClose: candles[candles.length - 1].close });
    assert.ok(m.buySide.every((x) => x.price > candles[candles.length - 1].close));
    assert.ok(m.sellSide.every((x) => x.price < candles[candles.length - 1].close));
    for (const x of [...m.buySide, ...m.sellSide]) {
      assert.ok(['swept', 'untouched-tested', 'untouched'].includes(x.state));
      assert.ok(!/guaranteed/i.test(x.label));
    }
  });
  it('sizer math: risk → qty → margin → RR', () => {
    const s = sizeFor({ balance: 10000, riskPct: 1, entry: 100, stop: 99, takeProfit: 102, lev: 5 });
    assert.equal(s.maxLoss, 100);
    assert.equal(s.qty, 100);
    assert.equal(s.margin, 2000);
    assert.equal(s.rr, 2);
  });
});
