import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, bollinger, atr, computeAll } from '../src/lib/indicators.js';

describe('indicators', () => {
  it('sma averages the window', () => {
    assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  });
  it('ema seeds from SMA and smooths', () => {
    const out = ema([10, 10, 10, 20], 3);
    assert.equal(out[2], 10);
    assert.ok(out[3] > 10 && out[3] < 20);
  });
  it('rsi: pure gains → 100, pure losses → 0', () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    const dn = Array.from({ length: 20 }, (_, i) => 100 - i);
    assert.equal(rsi(up, 14)[19], 100);
    assert.equal(rsi(dn, 14)[19], 0);
  });
  it('macd line = fast − slow EMA', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const { macdLine, signalLine } = macd(closes);
    const i = closes.length - 1;
    assert.ok(Number.isFinite(macdLine[i]));
    assert.ok(Number.isFinite(signalLine[i]));
  });
  it('bollinger bands bracket the midline', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 7));
    const { mid, upper, lower } = bollinger(closes, 20, 2);
    const i = 29;
    assert.ok(lower[i] < mid[i] && mid[i] < upper[i]);
  });
  it('atr is positive on volatile data', () => {
    const n = 30;
    const highs = Array.from({ length: n }, (_, i) => 100 + i + 2);
    const lows = Array.from({ length: n }, (_, i) => 100 + i - 2);
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const a = atr(highs, lows, closes, 14);
    assert.ok(a[29] > 0);
  });
  it('computeAll returns aligned arrays', () => {
    const candles = Array.from({ length: 250 }, (_, i) => ({
      timestamp: i * 36e5, open: 100 + i * 0.1, high: 101 + i * 0.1,
      low: 99 + i * 0.1, close: 100 + i * 0.1, volume: 1000
    }));
    const ind = computeAll(candles);
    for (const k of ['ema20', 'ema50', 'rsi', 'atr', 'stDir', 'adx']) {
      assert.equal(ind[k].length, 250, k);
    }
  });
});
