// Transparent scoring: separate Technical and ICT/SMC scores (0-100 each),
// a configurable combined confluence score, market-regime detection and
// suggested trade levels. Every point is itemized — a confluence score is
// NOT a win probability and is never presented as one.

export const DEFAULT_WEIGHTS = { technical: 60, ict: 40 };

export function technicalScore(candles, ind) {
  const n = candles.length;
  const out = [];
  if (n < 30) {
    return { score: 50, bull: 0, bear: 0, net: 0, components: [{ label: 'Not enough data', side: 'neutral', points: 0, detail: 'Need 30+ candles.' }] };
  }
  const i = n - 1;
  const c = candles[i], prev = candles[i - 1];
  const push = (label, side, points, detail, cat) => out.push({ label, side, points, detail, cat });
  const f = (v) => fmtN(v);

  if (ind.ema20[i] != null && ind.ema50[i] != null) {
    if (ind.ema20[i] > ind.ema50[i]) push('EMA 20 above EMA 50 — uptrend', 'bull', 12, `EMA20 ${f(ind.ema20[i])} > EMA50 ${f(ind.ema50[i])}`, 'Trend');
    else push('EMA 20 below EMA 50 — downtrend', 'bear', 12, `EMA20 ${f(ind.ema20[i])} < EMA50 ${f(ind.ema50[i])}`, 'Trend');
  }
  if (ind.ema50[i] != null) {
    if (c.close > ind.ema50[i]) push('Price above EMA 50', 'bull', 6, `Close ${f(c.close)} > EMA50 ${f(ind.ema50[i])}`, 'Trend');
    else push('Price below EMA 50', 'bear', 6, `Close ${f(c.close)} < EMA50 ${f(ind.ema50[i])}`, 'Trend');
  }
  const r = ind.rsi[i];
  if (r != null) {
    if (r > 55) push(`RSI ${r.toFixed(1)} — bullish momentum`, 'bull', 8, 'Buyers in control above 55.', 'Momentum');
    else if (r < 45) push(`RSI ${r.toFixed(1)} — bearish momentum`, 'bear', 8, 'Sellers in control below 45.', 'Momentum');
    else push(`RSI ${r.toFixed(1)} — neutral zone`, 'neutral', 0, 'No momentum edge between 45–55.', 'Momentum');
    if (r < 30) push('RSI oversold — bounce possible', 'bull', 3, 'Snap-back risk; do not chase shorts.', 'Momentum');
    if (r > 70) push('RSI overbought — pullback possible', 'bear', 3, 'Chasing longs here is expensive.', 'Momentum');
  }
  if (ind.macdLine[i] != null && ind.signalLine[i] != null) {
    if (ind.macdLine[i] > ind.signalLine[i]) push('MACD above signal — bullish', 'bull', 8, `MACD ${f(ind.macdLine[i])} > signal ${f(ind.signalLine[i])}`, 'Momentum');
    else push('MACD below signal — bearish', 'bear', 8, `MACD ${f(ind.macdLine[i])} < signal ${f(ind.signalLine[i])}`, 'Momentum');
  }
  if (ind.bbUpper[i] != null && ind.bbLower[i] != null) {
    if (c.close > ind.bbUpper[i]) push('Close above upper band — overextended', 'bear', 4, 'Mean-reversion risk up here.', 'Volatility');
    else if (c.close < ind.bbLower[i]) push('Close below lower band — washed out', 'bull', 4, 'Bounce possible, not guaranteed.', 'Volatility');
    else push('Price inside Bollinger Bands', 'neutral', 0, 'No band breakout.', 'Volatility');
  }
  if (ind.stochK[i] != null && ind.stochD[i] != null) {
    if (ind.stochK[i] < 20 && ind.stochD[i] < 20) push(`Stochastic oversold (${ind.stochK[i].toFixed(0)}/${ind.stochD[i].toFixed(0)})`, 'bull', 4, 'Short-term selling exhaustion.', 'Momentum');
    else if (ind.stochK[i] > 80 && ind.stochD[i] > 80) push(`Stochastic overbought (${ind.stochK[i].toFixed(0)}/${ind.stochD[i].toFixed(0)})`, 'bear', 4, 'Short-term buying exhaustion.', 'Momentum');
  }
  if (ind.stDir[i] != null) {
    if (ind.stDir[i] === 1) push('Supertrend bullish', 'bull', 10, 'Price above ATR trailing stop.', 'Trend');
    else push('Supertrend bearish', 'bear', 10, 'Price below ATR trailing stop.', 'Trend');
  }
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  const bullEng = c.close > c.open && prev.close < prev.open && c.close >= prev.open && c.open <= prev.close;
  const bearEng = c.close < c.open && prev.close > prev.open && c.close <= prev.open && c.open >= prev.close;
  if (bullEng) push('Bullish engulfing candle', 'bull', 6, 'Buyers overwhelmed prior sellers.', 'Price action');
  if (bearEng) push('Bearish engulfing candle', 'bear', 6, 'Sellers overwhelmed prior buyers.', 'Price action');
  if (body / range > 0.7 && c.close > c.open) push('Strong bullish displacement', 'bull', 4, 'Wide-range buying candle.', 'Price action');
  if (body / range > 0.7 && c.close < c.open) push('Strong bearish displacement', 'bear', 4, 'Wide-range selling candle.', 'Price action');

  return finishScore(out);
}

// ICT/SMC score with the documented component weights (max 100 per side).
// Structure +20, BOS/CHOCH +15, sweep +15, FVG +10, OB +15, discount/premium +10,
// displacement +10, session +5.
export function ictScore(candles, ind, ict) {
  const out = [];
  const n = candles.length;
  if (!ict || n < 30) {
    return { score: 50, bull: 0, bear: 0, net: 0, components: [{ label: 'No structure data', side: 'neutral', points: 0, detail: 'Need 30+ candles.' }] };
  }
  const push = (label, side, points, detail, cat) => out.push({ label, side, points, detail, cat });
  const c = candles[n - 1];

  // 1) Structure (+20): HH/HL vs LH/LL from classified swings
  const cls = ict.classified || { highs: [], lows: [] };
  const hT = cls.highs.slice(-2).map((s) => s.kind);
  const lT = cls.lows.slice(-2).map((s) => s.kind);
  const upStruct = hT.includes('HH') || lT.includes('HL');
  const dnStruct = hT.includes('LH') || lT.includes('LL');
  if (upStruct && !dnStruct) push('Bullish structure (HH/HL)', 'bull', 20, 'Recent swings print higher highs / higher lows.', 'Structure');
  else if (dnStruct && !upStruct) push('Bearish structure (LH/LL)', 'bear', 20, 'Recent swings print lower highs / lower lows.', 'Structure');
  else push('Mixed structure — no stair-step', 'neutral', 0, 'HH/HL and LH/LL both present or absent.', 'Structure');

  // 2) BOS/CHOCH (+15)
  const bosB = ict.events.filter((e) => e.index >= n - 8 && (e.type === 'bos-bull' || e.type === 'choch-bull')).length;
  const bosS = ict.events.filter((e) => e.index >= n - 8 && (e.type === 'bos-bear' || e.type === 'choch-bear')).length;
  if (bosB && !bosS) push('Recent bullish BOS/CHOCH', 'bull', 15, 'Structure broke upward in the last 8 bars.', 'Breaks');
  else if (bosS && !bosB) push('Recent bearish BOS/CHOCH', 'bear', 15, 'Structure broke downward in the last 8 bars.', 'Breaks');
  else if (bosB && bosS) push('BOS both ways — chop', 'neutral', 0, 'Conflicting breaks = range, not trend.', 'Breaks');
  else push('No recent BOS/CHOCH', 'neutral', 0, 'Structure intact, no fresh break.', 'Breaks');

  // 3) Liquidity sweep (+15)
  const swB = ict.events.filter((e) => e.index >= n - 5 && e.type === 'sweep-low').length;
  const swS = ict.events.filter((e) => e.index >= n - 5 && e.type === 'sweep-high').length;
  if (swB) push('Sell-side liquidity swept', 'bull', 15, 'Stops raided below lows — fuel for longs.', 'Liquidity');
  if (swS) push('Buy-side liquidity swept', 'bear', 15, 'Stops raided above highs — fuel for shorts.', 'Liquidity');
  if (!swB && !swS) push('No fresh liquidity sweep', 'neutral', 0, 'No stop-raid in the last 5 bars.', 'Liquidity');

  // 4) FVG (+10): unfilled gap in the trade direction
  const fB = (ict.fvgs || []).filter((g) => g.direction === 1 && g.state === 'unfilled').length;
  const fS = (ict.fvgs || []).filter((g) => g.direction === -1 && g.state === 'unfilled').length;
  if (fB && fS) push('FVGs both sides — magnet chop', 'neutral', 0, 'Price has unfinished business up and down.', 'FVG');
  else if (fB) push('Unfilled bullish FVG', 'bull', 10, 'Imbalance below that price may revisit and bounce.', 'FVG');
  else if (fS) push('Unfilled bearish FVG', 'bear', 10, 'Imbalance above that price may revisit and reject.', 'FVG');
  else push('No open FVG nearby', 'neutral', 0, 'Gaps already filled or none formed.', 'FVG');

  // 5) Order block (+15): nearest active OB on the right side of price
  const actOB = (ict.orderBlocks || []).filter((o) => o.state === 'active');
  const bullOB = actOB.filter((o) => o.direction === 1 && c.close > o.top).pop();
  const bearOB = actOB.filter((o) => o.direction === -1 && c.close < o.bottom).pop();
  if (bullOB && !bearOB) push('Active bullish order block below', 'bull', 15, `${bullOB.label} — demand shelf under price.`, 'Order blocks');
  else if (bearOB && !bullOB) push('Active bearish order block above', 'bear', 15, `${bearOB.label} — supply shelf over price.`, 'Order blocks');
  else push('No one-sided active order block', 'neutral', 0, 'No fresh shelf backing either side.', 'Order blocks');

  // 6) Premium / discount (+10)
  if (ict.zone && ict.zone.startsWith('Discount')) push('Price in discount', 'bull', 10, 'Lower third of the dealing range — longs pay less.', 'Range');
  else if (ict.zone && ict.zone.startsWith('Premium')) push('Price in premium', 'bear', 10, 'Upper third of the range — shorts get better location.', 'Range');
  else push('Price at equilibrium', 'neutral', 0, 'Mid-range — worst place to chase.', 'Range');

  // 7) Displacement (+10)
  const disp = (ict.displacement || []).filter((d) => d.index >= n - 5);
  const dB = disp.filter((d) => d.direction === 1).length;
  const dS = disp.filter((d) => d.direction === -1).length;
  if (dB && !dS) push('Recent bullish displacement', 'bull', 10, 'Wide-range buying shows initiative.', 'Displacement');
  else if (dS && !dB) push('Recent bearish displacement', 'bear', 10, 'Wide-range selling shows initiative.', 'Displacement');
  else push('No one-sided displacement', 'neutral', 0, 'No initiative candle in the last 5 bars.', 'Displacement');

  // 8) Session (+5)
  const sess = ict.session;
  if (sess?.killzone) push(`${sess.name} killzone active`, sess.bias === 1 ? 'bull' : sess.bias === -1 ? 'bear' : 'neutral', sess.bias === 0 ? 0 : 5, 'Moves made in killzones are more trustworthy.', 'Session');
  else push(sess ? `${sess.name} session — off killzone` : 'Session unknown', 'neutral', 0, 'Patience: wait for London/NY windows.', 'Session');

  // EMA trend gate (no points, context only)
  if (ind?.ema50?.[n - 1] != null) {
    out.push({ label: c.close > ind.ema50[n - 1] ? 'Price holds above EMA 50' : 'Price capped below EMA 50', side: 'neutral', points: 0, detail: 'Context gate for ICT entries.', cat: 'Context' });
  }
  return finishScore(out);
}

function finishScore(list) {
  let bull = 0, bear = 0;
  for (const x of list) {
    if (x.side === 'bull') bull += x.points;
    if (x.side === 'bear') bear += x.points;
  }
  const total = bull + bear;
  return { score: total === 0 ? 50 : Math.round((bull / total) * 100), bull, bear, net: bull - bear, components: list };
}

export function combineScores(tech, ictS, weights = DEFAULT_WEIGHTS) {
  const wt = Math.max(0, Math.min(100, weights.technical ?? 60)) / 100;
  const wi = 1 - wt;
  const score = Math.round(tech.score * wt + ictS.score * wi);
  const net = Math.round(tech.net * wt + ictS.net * wi);
  const direction = score >= 60 && net >= 4 ? 'BUY' : score <= 40 && net <= -4 ? 'SELL' : 'NEUTRAL';
  const confidence = Math.abs(score - 50) >= 25 ? 'High' : Math.abs(score - 50) >= 12 ? 'Medium' : 'Low';
  return { score, net, direction, confidence, wt: Math.round(wt * 100), wi: Math.round(wi * 100) };
}

// Market regime from measurable conditions only.
export function detectRegime(candles, ind) {
  const n = candles.length;
  if (n < 60) return { label: 'Sideways', emoji: '🟡', detail: 'Not enough history to classify.' };
  const i = n - 1, c = candles[i];
  const adx = ind.adx?.[i];
  const atr = ind.atr?.[i];
  const atrPct = atr && c.close ? (atr / c.close) * 100 : 0;
  const e20 = ind.ema20?.[i], e50 = ind.ema50?.[i];
  const up = e20 != null && e50 != null && c.close > e50 && e20 > e50;
  const dn = e20 != null && e50 != null && c.close < e50 && e20 < e50;
  const bbU = ind.bbUpper?.[i], bbL = ind.bbLower?.[i];
  const squeeze = bbU != null && bbL != null && c.close ? ((bbU - bbL) / c.close) * 100 < 2 : false;
  if (adx != null && adx >= 25 && up) return { label: 'Strong Bull Trend', emoji: '🟢', detail: `ADX ${adx.toFixed(1)} + price over stacked EMAs.` };
  if (adx != null && adx >= 25 && dn) return { label: 'Strong Bear Trend', emoji: '🔴', detail: `ADX ${adx.toFixed(1)} + price under stacked EMAs.` };
  if (atrPct >= 3) return { label: 'High Volatility', emoji: '🟠', detail: `ATR is ${atrPct.toFixed(2)}% of price — wide stops or sit out.` };
  if (up) return { label: 'Bullish', emoji: '🟢', detail: 'Uptrend stack, momentum not extreme.' };
  if (dn) return { label: 'Bearish', emoji: '🔴', detail: 'Downtrend stack, momentum not extreme.' };
  if (squeeze) return { label: 'Sideways', emoji: '🟡', detail: 'Bollinger squeeze — compression before expansion.' };
  return { label: 'Sideways', emoji: '🟡', detail: 'No trend stack — range tactics beat trend tactics.' };
}

// Suggested trade plan: ATR stop + structure-aware stop, R-multiple target.
export function tradeLevels(candles, ind, ict, direction, { stopAtrMult = 2, takeProfitRR = 2 } = {}) {
  const n = candles.length;
  if (!n) return null;
  const entry = candles[n - 1].close;
  const atr = ind.atr?.[n - 1] ?? entry * 0.01;
  const dir = direction === 'SELL' ? -1 : 1;
  let stop;
  if (ict?.swings) {
    const lows = ict.swings.lows.filter((s) => s.index >= n - 60);
    const highs = ict.swings.highs.filter((s) => s.index >= n - 60);
    if (dir === 1 && lows.length) {
      const sw = Math.max(...lows.map((s) => s.price));
      stop = sw < entry && entry - sw <= atr * 3 ? sw - atr * 0.2 : entry - atr * stopAtrMult;
    } else if (dir === -1 && highs.length) {
      const sw = Math.min(...highs.map((s) => s.price));
      stop = sw > entry && sw - entry <= atr * 3 ? sw + atr * 0.2 : entry + atr * stopAtrMult;
    } else {
      stop = dir === 1 ? entry - atr * stopAtrMult : entry + atr * stopAtrMult;
    }
  } else {
    stop = dir === 1 ? entry - atr * stopAtrMult : entry + atr * stopAtrMult;
  }
  const riskDist = Math.abs(entry - stop) || atr;
  const target = dir === 1 ? entry + riskDist * takeProfitRR : entry - riskDist * takeProfitRR;
  return { entry, stop, takeProfit: target, rr: takeProfitRR, riskPct: entry ? (riskDist / entry) * 100 : 0, dir };
}

// 24h price change from the candle series itself.
export function dayChange(candles) {
  if (candles.length < 2) return null;
  const end = candles[candles.length - 1].timestamp;
  const from = end - 24 * 3600e3;
  let ref = candles[0].close;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].timestamp <= from) { ref = candles[i].close; break; }
  }
  if (!ref) return null;
  return ((candles[candles.length - 1].close - ref) / ref) * 100;
}

function fmtN(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 10) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(3);
  return v.toFixed(5);
}
