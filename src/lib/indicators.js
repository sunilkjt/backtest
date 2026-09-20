// Pure technical-indicator math. All functions accept plain arrays and
// return arrays of the same length (null-padded where undefined).

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) { sum = 0; continue; }
    sum += v;
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = null;
  // seed with SMA of first `period` values
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) { out[i] = null; continue; }
    if (i < period - 1) continue;
    if (i === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line = closes.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null);
  // signal EMA over the macd line (ignore nulls by forward-filling seed)
  const sig = new Array(closes.length).fill(null);
  const k = 2 / (signal + 1);
  let prev = null; let count = 0;
  for (let i = 0; i < closes.length; i++) {
    if (line[i] == null) continue;
    count++;
    if (count <= signal) {
      // seed average
      if (count === signal) {
        let s = 0;
        let seen = 0;
        for (let j = i; j >= 0 && seen < signal; j--) {
          if (line[j] != null) { s += line[j]; seen++; }
        }
        prev = s / signal;
        sig[i] = prev;
      }
      continue;
    }
    prev = line[i] * k + prev * (1 - k);
    sig[i] = prev;
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { macdLine: line, signalLine: sig, hist };
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += closes[j];
    const mean = s / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { mid, upper, lower };
}

export function atr(highs, lows, closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  const trs = closes.map((c, i) => {
    if (i === 0) return highs[0] - lows[0];
    const pc = closes[i - 1];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc));
  });
  let a = 0;
  for (let i = 1; i <= period; i++) a += trs[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < closes.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

export function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    k[i] = range === 0 ? 50 : ((closes[i] - ll) / range) * 100;
  }
  const dRaw = k.map((v) => v);
  const d = sma(dRaw.map((v) => (v == null ? 50 : v)), dPeriod);
  // re-null leading
  for (let i = 0; i < kPeriod - 1; i++) d[i] = null;
  return { k, d };
}

export function donchian(highs, lows, period = 20) {
  const upper = new Array(highs.length).fill(null);
  const lower = new Array(highs.length).fill(null);
  const mid = new Array(highs.length).fill(null);
  for (let i = period - 1; i < highs.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    upper[i] = hh; lower[i] = ll; mid[i] = (hh + ll) / 2;
  }
  return { upper, lower, mid };
}

export function supertrend(highs, lows, closes, period = 10, mult = 3) {
  const a = atr(highs, lows, closes, period);
  const n = closes.length;
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const line = new Array(n).fill(null);
  const dir = new Array(n).fill(null); // 1 bull, -1 bear
  let prevUpper = null, prevLower = null, prevClose = null, prevDir = 1;
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    let ub = hl2 + mult * a[i];
    let lb = hl2 - mult * a[i];
    if (prevUpper != null) {
      if (prevClose <= prevUpper) ub = Math.min(ub, prevUpper);
      if (prevClose >= prevLower) lb = Math.max(lb, prevLower);
    }
    let d = prevDir;
    if (closes[i] > ub) d = 1;
    else if (closes[i] < lb) d = -1;
    upper[i] = ub; lower[i] = lb;
    line[i] = d === 1 ? lb : ub;
    dir[i] = d;
    prevUpper = ub; prevLower = lb; prevClose = closes[i]; prevDir = d;
  }
  return { line, direction: dir, upper, lower };
}

export function roc(closes, period = 12) {
  return closes.map((c, i) =>
    i < period || closes[i - period] === 0 ? null : ((c - closes[i - period]) / closes[i - period]) * 100);
}

export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const smooth = (arr) => {
    const out = new Array(n).fill(null);
    let s = 0;
    for (let i = 1; i <= period; i++) s += arr[i] ?? 0;
    out[period] = s;
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const sTR = smooth(tr), sP = smooth(plusDM), sM = smooth(minusDM);
  const dx = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (!sTR[i]) { dx[i] = 0; continue; }
    const p = (sP[i] / sTR[i]) * 100, m = (sM[i] / sTR[i]) * 100;
    dx[i] = p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100;
  }
  let out = new Array(n).fill(null);
  let s = 0;
  for (let i = period; i < period * 2 && i < n; i++) s += dx[i] ?? 0;
  const first = period * 2 - 1;
  if (first < n) {
    out[first] = s / period;
    for (let i = first + 1; i < n; i++) out[i] = ((out[i - 1] * (period - 1)) + dx[i]) / period;
  }
  return out;
}

export function computeAll(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes, 12, 26, 9);
  const b = bollinger(closes, 20, 2);
  const a = atr(highs, lows, closes, 14);
  const st = stochastic(highs, lows, closes, 14, 3);
  const dc = donchian(highs, lows, 20);
  const stt = supertrend(highs, lows, closes, 10, 3);
  const adxArr = adx(highs, lows, closes, 14);
  return { ema20, ema50, ema200, sma50, sma200, rsi: r, ...m, bbUpper: b.upper, bbMid: b.mid, bbLower: b.lower, atr: a, stochK: st.k, stochD: st.d, donUpper: dc.upper, donLower: dc.lower, donMid: dc.mid, stLine: stt.line, stDir: stt.direction, adx: adxArr };
}
