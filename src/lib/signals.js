// Combined signal: merges the Technical and ICT/SMC scorers so the Lab,
// the SignalBot card and the backtest explainer all share one engine.
// Output shape is kept stable: { direction, score, bull, bear, net,
// confidence, reasons } plus { tech, ictS, combined } detail.
// Optional regime gate (opts.gateRegime + opts.regime): a BUY against a
// bearish regime (or SELL against bullish) is downgraded to NEUTRAL unless
// the confluence is extreme (>= 78) — and the veto is listed as a reason.

import { technicalScore, ictScore, combineScores, DEFAULT_WEIGHTS } from './scores.js';

export { DEFAULT_WEIGHTS };

export function buildSignal(candles, ind, ict, weights = DEFAULT_WEIGHTS, opts = {}) {
  const tech = technicalScore(candles, ind);
  const ictS = ictScore(candles, ind, ict);
  const combined = combineScores(tech, ictS, weights);
  const reasons = [
    ...tech.components.map((c) => ({ ...c, group: 'technical' })),
    ...ictS.components.map((c) => ({ ...c, group: 'ict' }))
  ];
  let { direction, score, confidence } = combined;
  let gated = false;
  const regime = opts.regime;
  if (opts.gateRegime && regime && (direction === 'BUY' || direction === 'SELL')) {
    const bullReg = /bull/i.test(regime.label || '');
    const bearReg = /bear/i.test(regime.label || '');
    const conflict = (direction === 'BUY' && bearReg && !bullReg) || (direction === 'SELL' && bullReg && !bearReg);
    if (conflict && score < 78) {
      gated = true;
      direction = 'NEUTRAL';
      confidence = 'Low';
      reasons.push({
        label: `Regime veto — ${regime.label} overrules ${combined.direction}`,
        side: 'neutral', points: 0, group: 'gate',
        detail: `Regime is “${regime.label}” (${regime.detail || 'trend filter'}). Score ${score} is below the 78 override — waiting is the position.`
      });
    }
  }
  return {
    direction,
    score,
    bull: tech.bull + ictS.bull,
    bear: tech.bear + ictS.bear,
    net: combined.net,
    confidence,
    reasons,
    tech,
    ictS,
    combined,
    gated,
    veto: gated ? combined.direction : null
  };
}
