// Canonical trade-plan tests (§20 vectors + validation + sizing + costs +
// liquidation + MTF fallback routing + 4H UTC alignment + candle status).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcRR, sizePosition, expectedForTP, validatePlan, buildCanonicalPlan,
  candleStatus, DEFAULT_MIN_RR
} from '../src/lib/tradePlan.js';
import { loadCandlesWithFallback, resampleToBucket } from '../src/lib/providers.js';
import { liquidationPrice } from '../src/lib/riskModels.js';
import { computeAll } from '../src/lib/indicators.js';
import { analyzeICT } from '../src/lib/ict.js';
import { causalFor } from '../src/lib/ictEngine.js';
import { generateDemoCandles } from '../src/lib/demo.js';

function C(t, o, h, l, c, v = 100) {
  return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
}

describe('RR vectors', () => {
  it('LONG entry 100 SL 98 → 1.5 / 2 / 2.5', () => {
    assert.equal(calcRR(100, 98, 103, 1), 1.5);
    assert.equal(calcRR(100, 98, 104, 1), 2);
    assert.equal(calcRR(100, 98, 105, 1), 2.5);
  });
  it('SHORT entry 100 SL 102 → 1.5 / 2 / 2.5', () => {
    assert.equal(calcRR(100, 102, 97, -1), 1.5);
    assert.equal(calcRR(100, 102, 96, -1), 2);
    assert.equal(calcRR(100, 102, 95, -1), 2.5);
  });
  it('zero risk is NaN, not an RR', () => {
    assert.ok(Number.isNaN(calcRR(100, 100, 105, 1)));
  });
});

describe('plan validation', () => {
  it('accepts ordered LONG and SHORT plans', () => {
    assert.equal(validatePlan({ dir: 1, entry: 100, stop: 98, tps: [103, 104, 105] }).status, 'VALID');
    assert.equal(validatePlan({ dir: -1, entry: 100, stop: 102, tps: [97, 96, 95] }).status, 'VALID');
  });
  it('rejects long SL above entry / short SL below entry', () => {
    const l = validatePlan({ dir: 1, entry: 100, stop: 102, tps: [103, 104, 105] });
    assert.equal(l.status, 'INVALID');
    assert.ok(l.reasons.join(' ').includes('below entry'));
    const s = validatePlan({ dir: -1, entry: 100, stop: 98, tps: [97, 96, 95] });
    assert.equal(s.status, 'INVALID');
    assert.ok(s.reasons.join(' ').includes('above entry'));
  });
  it('rejects TP disorder, missing TP, NaN and Infinity', () => {
    assert.equal(validatePlan({ dir: 1, entry: 100, stop: 98, tps: [103, 103, 105] }).status, 'INVALID');
    assert.equal(validatePlan({ dir: 1, entry: 100, stop: 98, tps: [103, 104] }).status, 'INVALID');
    assert.equal(validatePlan({ dir: 1, entry: NaN, stop: 98, tps: [103, 104, 105] }).status, 'INVALID');
    assert.equal(validatePlan({ dir: 1, entry: 100, stop: 98, tps: [103, 104, Infinity] }).status, 'INVALID');
    assert.equal(validatePlan({ dir: 0, entry: 100, stop: 98, tps: [103, 104, 105] }).status, 'INVALID');
  });
});

describe('position sizing', () => {
  it('percentage risk from canonical entry/stop', () => {
    const s = sizePosition({ balance: 10000, riskPct: 1, entry: 100, stop: 98, lev: 1 });
    assert.equal(s.valid, true);
    assert.equal(s.riskAmount, 100);
    assert.equal(s.riskPerUnit, 2);
    assert.equal(s.positionSize, 50);
    assert.equal(s.notional, 5000);
    assert.equal(s.margin, 5000);
    assert.equal(s.capped, false);
  });
  it('applies leverage to margin, never confuses it with notional', () => {
    const s = sizePosition({ balance: 10000, riskPct: 1, entry: 100, stop: 98, lev: 2 });
    assert.equal(s.notional, 5000);
    assert.equal(s.margin, 2500);
  });
  it('caps notional at balance × leverage like the backtester', () => {
    const s = sizePosition({ balance: 1000, riskPct: 1, entry: 100, stop: 99.9, lev: 1 });
    assert.equal(s.capped, true);
    assert.equal(s.positionSize, 10);
    assert.equal(s.notional, 1000);
  });
  it('rejects zero/negative risk and bad prices', () => {
    assert.equal(sizePosition({ balance: 10000, riskPct: 1, entry: 100, stop: 100, lev: 1 }).valid, false);
    assert.equal(sizePosition({ balance: 10000, riskPct: -1, entry: 100, stop: 98, lev: 1 }).valid, false);
    assert.equal(sizePosition({ balance: 0, riskPct: 1, entry: 100, stop: 98, lev: 1 }).valid, false);
  });
});

describe('expected profit with costs', () => {
  it('charges fee+slippage once per side, never double', () => {
    const p = expectedForTP({ entry: 100, tp: 103, size: 5, dir: 1, feePct: 0.05, slippagePct: 0.02 });
    assert.equal(p.gross, 15);
    assert.ok(Math.abs(p.costs - 0.7105) < 1e-9, `costs ${p.costs}`);
    assert.ok(Math.abs(p.net - 14.2895) < 1e-9, `net ${p.net}`);
  });
  it('is cost-free when fees are zero', () => {
    const p = expectedForTP({ entry: 100, tp: 97, size: 5, dir: -1, feePct: 0, slippagePct: 0 });
    assert.equal(p.gross, 15);
    assert.equal(p.net, 15);
  });
});

describe('canonical plan integration', () => {
  function ctx(dir, lev = 3) {
    const candles = generateDemoCandles('BTC', '1h', 300);
    const ind = computeAll(candles);
    const ict = analyzeICT(candles);
    const eng = causalFor(candles);
    const entry = candles[candles.length - 1].close;
    const plan = buildCanonicalPlan({
      candles, ind, eng, dir, entry,
      pools: ict.pools || [], prevDay: ict.prevDay, prevWeek: ict.prevWeek,
      account: { balance: 10000, riskPct: 1 }, leverage: lev,
      costs: { feePct: 0.05, slippagePct: 0.02 },
      liqModel: 'isolated-simple', liqMmr: 0.01, stopAtrMult: 2
    });
    return { candles, plan, entry };
  }
  for (const dir of [1, -1]) {
    it(`${dir === 1 ? 'LONG' : 'SHORT'}: one entry drives RR, size, P&L and liq`, () => {
      const { plan, entry } = ctx(dir);
      assert.equal(plan.status, 'VALID', plan.validation.reasons.join('; '));
      assert.equal(plan.entry, entry);
      const risk = Math.abs(entry - plan.stopLoss);
      const tp = [plan.targets[0].price, plan.targets[1].price, plan.targets[2].price];
      // RR identity from the canonical entry (not the zone midpoint)
      const expectRR = dir === 1
        ? tp.map((p) => (p - entry) / risk)
        : tp.map((p) => (entry - p) / risk);
      assert.ok(Math.abs(plan.rr.tp1 - expectRR[0]) < 1e-9);
      assert.ok(Math.abs(plan.rr.tp2 - expectRR[1]) < 1e-9);
      assert.ok(Math.abs(plan.rr.tp3 - expectRR[2]) < 1e-9);
      // sizing references the same entry/stop
      assert.equal(plan.sizing.notional, plan.sizing.positionSize * entry);
      assert.equal(plan.sizing.riskPerUnit, risk);
      assert.equal(plan.sizing.margin, plan.sizing.notional / plan.sizing.leverage);
      // expected P&L references the same size + entry
      assert.ok(Math.abs(plan.expected.tp1.gross - Math.abs(tp[0] - entry) * plan.sizing.positionSize) < 1e-6);
      // liquidation references the same entry
      assert.equal(plan.liq.price, liquidationPrice('isolated-simple', entry, dir, plan.sizing.leverage, 0.01));
      // every target carries a reason; SL carries a reason
      assert.ok(plan.targets.every((t) => typeof t.reason === 'string' && t.reason.length > 3));
      assert.ok(plan.stopReason.length > 3);
      // min-RR defaults are configurable thresholds, flags honest
      assert.deepEqual(plan.minRR, DEFAULT_MIN_RR);
    });
  }
  it('dir 0 → null; bad entry → INVALID, never a trade', () => {
    const candles = generateDemoCandles('BTC', '1h', 120);
    const ind = computeAll(candles);
    const eng = causalFor(candles);
    assert.equal(buildCanonicalPlan({ candles, ind, eng, dir: 0, entry: 100 }), null);
    const bad = buildCanonicalPlan({ candles, ind, eng, dir: 1, entry: NaN });
    assert.equal(bad.status, 'INVALID');
    assert.ok(bad.validation.reasons.length > 0);
  });
  it('lev 1 → no liquidation price', () => {
    const { plan } = ctx(1, 1);
    assert.equal(plan.liq.price, null);
  });
});

describe('MTF/provider fallback routing', () => {
  const rows = [C(1, 1, 2, 0.5, 1.5)];
  const hlOk = { getCandles: async () => rows, label: 'HL' };
  const hlBad = { getCandles: async () => { throw new Error('nope'); }, label: 'HL' };
  const yOk = { getCandles: async () => rows, lastSource: 'Y', label: 'Y' };
  const yBad = { getCandles: async () => { throw new Error('nope'); } };
  const req = { market: 'hyperliquid', symbol: 'AAPL', ref: 'xyz:AAPL', timeframe: '1h' };
  it('HL first: success stays native', async () => {
    const r = await loadCandlesWithFallback(req, { primary: hlOk, fallback: yOk });
    assert.equal(r.usedFallback, false);
    assert.equal(r.source, 'hyperliquid');
  });
  it('HL first: failure falls back to Yahoo, labeled', async () => {
    const r = await loadCandlesWithFallback(req, { primary: hlBad, fallback: yOk });
    assert.equal(r.usedFallback, true);
    assert.equal(r.source, 'yahoo-fallback');
  });
  it('Yahoo first: success stays Yahoo; failure uses HL backup', async () => {
    const a = await loadCandlesWithFallback({ ...req, yahoo: 'KO' }, { primary: hlOk, fallback: yOk });
    void a;
    const b = await loadCandlesWithFallback({ market: 'hyperliquid', symbol: 'KO', ref: 'KO', yahoo: 'KO', timeframe: '1h', preferYahoo: true }, { primary: hlOk, fallback: yOk });
    assert.equal(b.usedFallback, true);
    const c = await loadCandlesWithFallback({ market: 'hyperliquid', symbol: 'KO', ref: 'KO', yahoo: 'KO', timeframe: '1h', preferYahoo: true }, { primary: hlOk, fallback: yBad });
    assert.equal(c.usedFallback, false);
  });
  it('both fail → throws the honest primary error', async () => {
    await assert.rejects(loadCandlesWithFallback(req, { primary: hlBad, fallback: yBad }));
  });
  it('non-HL markets never touch Yahoo', async () => {
    const r = await loadCandlesWithFallback(
      { market: 'crypto', symbol: 'BTC', ref: 'BTCUSDT', timeframe: '1h' },
      { primary: hlOk, fallback: yBad }
    );
    assert.equal(r.usedFallback, false);
  });
});

describe('4H UTC alignment', () => {
  it('buckets to 00/04/08/12/16/20 with correct OHLCV', () => {
    const H = 36e5;
    const day = Date.UTC(2026, 4, 5); // midnight UTC
    const candles = [];
    for (let h = 1; h <= 8; h++) {
      const t = day + h * H;
      candles.push(C(t, 100 + h, 101 + h, 99 + h, 100.5 + h, 10));
    }
    const out = resampleToBucket(candles, 4 * H);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((c) => c.timestamp), [day, day + 4 * H, day + 8 * H]);
    assert.equal(out[0].open, 101);
    assert.equal(out[0].close, 103.5);
    assert.equal(out[0].high, 104);
    assert.equal(out[0].low, 100);
    assert.equal(out[0].volume, 30);
    assert.equal(out[2].volume, 10); // incomplete (forming) bucket kept
  });
  it('keeps chronological order across days', () => {
    const H = 36e5;
    const d0 = Date.UTC(2026, 4, 4);
    const candles = [C(d0 + 22 * H, 1, 2, 0.5, 1.5), C(d0 + 23 * H, 1.5, 2.5, 1, 2), C(d0 + 24 * H + H, 2, 3, 1.5, 2.5)];
    const out = resampleToBucket(candles, 4 * H);
    assert.ok(out.every((c, i) => i === 0 || c.timestamp > out[i - 1].timestamp));
    assert.equal(out[0].timestamp, Date.UTC(2026, 4, 4, 20));
  });
});

describe('candle status', () => {
  it('old bars are CLOSED, the live bucket is FORMING', () => {
    const old = [C(Date.UTC(2020, 0, 1), 1, 2, 0.5, 1.5), C(Date.UTC(2020, 0, 1, 1), 1, 2, 0.5, 1.5)];
    assert.equal(candleStatus(old, '1h').label, 'CLOSED');
    const now = Date.now();
    const ms = 36e5;
    const bs = Math.floor(now / ms) * ms; // current UTC hour bucket, deterministic
    const live = [C(bs - ms, 1, 2, 0.5, 1.5), C(bs + ms / 2, 1, 2, 0.5, 1.5)];
    const s = candleStatus(live, '1h');
    assert.equal(s.forming, true);
    assert.ok(s.label.startsWith('FORMING'));
  });
});
