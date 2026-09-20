// Combined signal: merges the Technical and ICT/SMC scorers so the Lab,
// the SignalBot card and the backtest explainer all share one engine.
// Output shape is kept stable: { direction, score, bull, bear, net,
// confidence, reasons } plus { tech, ictS, combined } detail.

import { technicalScore, ictScore, combineScores, DEFAULT_WEIGHTS } from './scores.js';

export { DEFAULT_WEIGHTS };

export function buildSignal(candles, ind, ict, weights = DEFAULT_WEIGHTS) {
  const tech = technicalScore(candles, ind);
  const ictS = ictScore(candles, ind, ict);
  const combined = combineScores(tech, ictS, weights);
  const reasons = [
    ...tech.components.map((c) => ({ ...c, group: 'technical' })),
    ...ictS.components.map((c) => ({ ...c, group: 'ict' }))
  ];
  return {
    direction: combined.direction,
    score: combined.score,
    bull: tech.bull + ictS.bull,
    bear: tech.bear + ictS.bear,
    net: combined.net,
    confidence: combined.confidence,
    reasons,
    tech,
    ictS,
    combined
  };
}
