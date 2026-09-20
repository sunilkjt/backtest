// Transparent confluence engine. Every input is listed in `reasons` so the
// user can see exactly WHY a BUY / SELL / NEUTRAL signal was produced.

export function buildSignal(candles, ind, ict) {
  const n = candles.length;
  const reasons = [];
  if (n < 30) {
    return { direction: 'NEUTRAL', score: 50, confidence: 'Low', reasons: [{ label: 'Not enough data — need at least 30 candles', points: 0, side: 'neutral', detail: 'Fetch more history.' }] };
  }
  const i = n - 1;
  const c = candles[i];
  const prev = candles[i - 1];

  const push = (label, side, points, detail) => reasons.push({ label, side, points, detail });

  // 1) Trend: EMA stack
  if (ind.ema20[i] != null && ind.ema50[i] != null) {
    if (ind.ema20[i] > ind.ema50[i]) push('EMA 20 above EMA 50 — uptrend', 'bull', 12, `EMA20 ${f(ind.ema20[i])} > EMA50 ${f(ind.ema50[i])}`);
    else push('EMA 20 below EMA 50 — downtrend', 'bear', 12, `EMA20 ${f(ind.ema20[i])} < EMA50 ${f(ind.ema50[i])}`);
  }
  if (ind.ema50[i] != null) {
    if (c.close > ind.ema50[i]) push('Price above EMA 50', 'bull', 6, `Close ${f(c.close)} > EMA50 ${f(ind.ema50[i])}`);
    else push('Price below EMA 50', 'bear', 6, `Close ${f(c.close)} < EMA50 ${f(ind.ema50[i])}`);
  }

  // 2) RSI
  const r = ind.rsi[i];
  if (r != null) {
    if (r > 55) push(`RSI ${r.toFixed(1)} — bullish momentum`, 'bull', 8, 'RSI above 55 shows buyers in control.');
    else if (r < 45) push(`RSI ${r.toFixed(1)} — bearish momentum`, 'bear', 8, 'RSI below 45 shows sellers in control.');
    else push(`RSI ${r.toFixed(1)} — neutral zone`, 'neutral', 0, 'RSI between 45–55: no momentum edge.');
    if (r < 30) push('RSI oversold — bounce possible (contrarian caution)', 'bull', 3, 'Oversold can snap back, but do not fight a cascade.');
    if (r > 70) push('RSI overbought — pullback possible (contrarian caution)', 'bear', 3, 'Overbought can extend; tight risk.');
  }

  // 3) MACD
  if (ind.macdLine[i] != null && ind.signalLine[i] != null) {
    if (ind.macdLine[i] > ind.signalLine[i]) push('MACD line above signal — bullish', 'bull', 8, `MACD ${f(ind.macdLine[i])} > signal ${f(ind.signalLine[i])}`);
    else push('MACD line below signal — bearish', 'bear', 8, `MACD ${f(ind.macdLine[i])} < signal ${f(ind.signalLine[i])}`);
  }

  // 4) Bollinger position
  if (ind.bbUpper[i] != null && ind.bbLower[i] != null) {
    if (c.close > ind.bbUpper[i]) push('Close above upper Bollinger Band — overextended', 'bear', 4, 'Mean-reversion risk to the upside; chasers beware.');
    else if (c.close < ind.bbLower[i]) push('Close below lower Bollinger Band — washed out', 'bull', 4, 'Mean-reversion bounce possible.');
    else push('Price inside Bollinger Bands — balanced', 'neutral', 0, 'No band squeeze breakout right now.');
  }

  // 5) Stochastic
  if (ind.stochK[i] != null && ind.stochD[i] != null) {
    if (ind.stochK[i] < 20 && ind.stochD[i] < 20) push(`Stochastic oversold (${ind.stochK[i].toFixed(0)}/${ind.stochD[i].toFixed(0)})`, 'bull', 4, 'Short-term selling exhaustion.');
    else if (ind.stochK[i] > 80 && ind.stochD[i] > 80) push(`Stochastic overbought (${ind.stochK[i].toFixed(0)}/${ind.stochD[i].toFixed(0)})`, 'bear', 4, 'Short-term buying exhaustion.');
  }

  // 6) Supertrend
  if (ind.stDir[i] != null) {
    if (ind.stDir[i] === 1) push('Supertrend bullish (price above ATR trailing stop)', 'bull', 10, 'Trend-following tailwind for longs.');
    else push('Supertrend bearish (price below ATR trailing stop)', 'bear', 10, 'Trend-following headwind for longs.');
  }

  // 7) ADX trend strength
  if (ind.adx[i] != null) {
    if (ind.adx[i] > 25) push(`ADX ${ind.adx[i].toFixed(1)} — strong trend (respect momentum)`, 'neutral', 0, 'High ADX: trend strategies favored over fades.');
    else push(`ADX ${ind.adx[i].toFixed(1)} — weak/ranging market`, 'neutral', 0, 'Low ADX: expect chop; mean-reversion favored.');
  }

  // 8) Price action: engulfing / momentum candle
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  const bullishEngulf = c.close > c.open && prev.close < prev.open && c.close >= prev.open && c.open <= prev.close;
  const bearishEngulf = c.close < c.open && prev.close > prev.open && c.close <= prev.open && c.open >= prev.close;
  if (bullishEngulf) push('Bullish engulfing candle', 'bull', 6, 'Buyers overwhelmed prior-bar sellers.');
  if (bearishEngulf) push('Bearish engulfing candle', 'bear', 6, 'Sellers overwhelmed prior-bar buyers.');
  if (body / range > 0.7 && c.close > c.open) push('Strong bullish displacement candle', 'bull', 4, 'Wide-range body shows initiative buying.');
  if (body / range > 0.7 && c.close < c.open) push('Strong bearish displacement candle', 'bear', 4, 'Wide-range body shows initiative selling.');

  // 9) ICT overlays
  if (ict) {
    if (ict.bias === 'BULLISH') push(`SMC bias bullish (score ${ict.biasScore})`, 'bull', 8, `Structure + range position favor buyers. Zone: ${ict.zone}.`);
    else if (ict.bias === 'BEARISH') push(`SMC bias bearish (score ${ict.biasScore})`, 'bear', 8, `Structure + range position favor sellers. Zone: ${ict.zone}.`);
    else push(`SMC bias neutral (score ${ict.biasScore}) — ${ict.zone}`, 'neutral', 0, 'Smart-money picture is mixed.');
    const recentSweepBull = ict.events.filter((e) => e.index >= n - 5 && e.type === 'sweep-low').length;
    const recentSweepBear = ict.events.filter((e) => e.index >= n - 5 && e.type === 'sweep-high').length;
    if (recentSweepBull) push('Recent sweep of sell-side liquidity — fuel for longs', 'bull', 7, 'Stops raided below lows; watch for displacement up.');
    if (recentSweepBear) push('Recent sweep of buy-side liquidity — fuel for shorts', 'bear', 7, 'Stops raided above highs; watch for displacement down.');
    const bosBull = ict.events.filter((e) => e.index >= n - 8 && (e.type === 'bos-bull' || e.type === 'choch-bull')).length;
    const bosBear = ict.events.filter((e) => e.index >= n - 8 && (e.type === 'bos-bear' || e.type === 'choch-bear')).length;
    if (bosBull) push('Recent bullish BOS/CHOCH — structure broke up', 'bull', 6, 'Market structure shifted toward buyers.');
    if (bosBear) push('Recent bearish BOS/CHOCH — structure broke down', 'bear', 6, 'Market structure shifted toward sellers.');
  }

  let bull = 0, bear = 0;
  for (const x of reasons) {
    if (x.side === 'bull') bull += x.points;
    if (x.side === 'bear') bear += x.points;
  }
  const total = bull + bear;
  const score = total === 0 ? 50 : Math.round((bull / total) * 100);
  const net = bull - bear;
  const direction = score >= 60 && net >= 6 ? 'BUY' : score <= 40 && net <= -6 ? 'SELL' : 'NEUTRAL';
  const confidence = Math.abs(score - 50) >= 25 ? 'High' : Math.abs(score - 50) >= 12 ? 'Medium' : 'Low';

  return { direction, score, bull, bear, net, confidence, reasons };
}

function f(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 10) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(3);
  return v.toFixed(5);
}
