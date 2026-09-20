import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeICT } from '../src/lib/ict.js';
import { technicalScore, ictScore, combineScores, detectRegime, tradeLevels } from '../src/lib/scores.js';
import { computeAll } from '../src/lib/indicators.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function C(t, o, h, l, c, v = 100) {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
}

describe('ICT/SMC', () => {
  it('detects bullish BOS on a range break', () => {
    const candles = [];
    let t = 0;
    for (let i = 0; i < 40; i++) { const p = 100 + Math.sin(i / 3) * 1.5; candles.push(C(t += 36e5, p, p + 1, p - 1, p)); }
    // climb then fade so a confirmed swing high prints above the range
    for (const p of [104, 108, 112, 111, 110, 109, 108, 107]) candles.push(C(t += 36e5, p - 1, p + 0.5, p - 1.5, p));
    const r = analyzeICT(candles);
    assert.ok(r.events.some((e) => e.type === 'bos-bull' || e.type === 'choch-bull'));
  });
  it('detects a sell-side sweep + reclaim', async () => {
    const { findSwings } = await import('../src/lib/ict.js');
    const base = [];
    let t = 0;
    for (let i = 0; i < 40; i++) { const p = 100 + i * 0.15 + Math.sin(i / 2.5); base.push(C(t += 36e5, p, p + 0.8, p - 0.8, p)); }
    const { lows } = findSwings(base, 3, 3);
    assert.ok(lows.length > 0, 'fixture must contain a swing low');
    const ref = lows[lows.length - 1];
    const candles = [...base,
      C(t += 36e5, ref.price + 1, ref.price + 1.5, ref.price - 2, ref.price + 0.5),
      C(t += 36e5, ref.price + 0.5, ref.price + 1.5, ref.price - 0.2, ref.price + 1),
      C(t += 36e5, ref.price + 1, ref.price + 2, ref.price + 0.2, ref.price + 1.5)];
    const r = analyzeICT(candles);
    assert.ok(r.events.some((e) => e.type === 'sweep-low'));
  });
  it('labels swings HH/HL/LH/LL and finds FVG + OB states', () => {
    const candles = generateDemoCandles('BTC', '1h', 200);
    const r = analyzeICT(candles);
    const kinds = new Set([...r.classified.highs.map((s) => s.kind), ...r.classified.lows.map((s) => s.kind)]);
    assert.ok([...kinds].every((k) => ['X', 'HH', 'LH', 'HL', 'LL'].includes(k)));
    assert.ok(r.fvgs.every((g) => ['unfilled', 'partial', 'filled'].includes(g.state)));
    assert.ok(r.orderBlocks.every((o) => ['active', 'mitigated', 'violated'].includes(o.state)));
    assert.ok(r.prevDay && Number.isFinite(r.prevDay.high));
  });
});

describe('scores / regime / levels', () => {
  it('scores stay in 0..100 and list every component', () => {
    const candles = generateDemoCandles('SOL', '1h', 300);
    const ind = computeAll(candles);
    const ict = analyzeICT(candles);
    const t = technicalScore(candles, ind);
    const s = ictScore(candles, ind, ict);
    assert.ok(t.score >= 0 && t.score <= 100 && s.score >= 0 && s.score <= 100);
    assert.ok(t.components.length > 5 && s.components.length > 5);
    const c = combineScores(t, s, { technical: 60, ict: 40 });
    assert.ok(['BUY', 'SELL', 'NEUTRAL'].includes(c.direction));
  });
  it('regime uses only known labels', () => {
    const candles = generateDemoCandles('ETH', '4h', 200);
    const r = detectRegime(candles, computeAll(candles));
    assert.ok(['Strong Bull Trend', 'Strong Bear Trend', 'Bullish', 'Bearish', 'Sideways', 'High Volatility'].includes(r.label));
  });
  it('trade levels sit on the right side of entry', () => {
    const candles = generateDemoCandles('BTC', '1h', 300);
    const ind = computeAll(candles);
    const ict = analyzeICT(candles);
    const L = tradeLevels(candles, ind, ict, 'BUY', { stopAtrMult: 2, takeProfitRR: 2 });
    assert.ok(L.stop < L.entry && L.takeProfit > L.entry && L.rr === 2);
    const S = tradeLevels(candles, ind, ict, 'SELL', { stopAtrMult: 2, takeProfitRR: 2 });
    assert.ok(S.stop > S.entry && S.takeProfit < S.entry);
  });
});
