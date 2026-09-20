// Exchange-aware liquidation models.
//
// Liquidation math differs per venue (maintenance margin, funding, fee
// haircuts). This interface keeps the backtester honest: every price it
// produces is labeled APPROX unless a venue-specific model says otherwise.
// Future Hyperliquid integration point: replace the 'hyperliquid' parameters
// with live margin-table values instead of the documented approximation.

export const RISK_MODELS = {
  'isolated-simple': {
    id: 'isolated-simple',
    label: 'Isolated margin (simplified, 0 maintenance margin)',
    approx: true,
    // Long liquidated when loss equals margin: entry * (1 - 1/lev).
    liqPrice(entry, dir, lev) {
      if (!(entry > 0) || !(lev > 1)) return null;
      return dir === 1 ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev);
    }
  },
  hyperliquid: {
    id: 'hyperliquid',
    label: 'Hyperliquid-style isolated (maintenance margin approx)',
    approx: true,
    // Approximation only: real tables vary per asset and change over time.
    // Verify any liquidation-sensitive conclusion on the exchange itself.
    mmr: 0.01,
    liqPrice(entry, dir, lev, mmr = 0.01) {
      if (!(entry > 0) || !(lev > 1)) return null;
      const m = Math.max(0, mmr);
      return dir === 1 ? entry * (1 - 1 / lev + m) : entry * (1 + 1 / lev - m);
    }
  }
};

export function liquidationPrice(modelId, entry, dir, lev, mmr) {
  const m = RISK_MODELS[modelId] || RISK_MODELS['isolated-simple'];
  return m.liqPrice(entry, dir, lev, mmr);
}

export function liqLabel(modelId) {
  const m = RISK_MODELS[modelId] || RISK_MODELS['isolated-simple'];
  return `Approx. liquidation (${m.label})`;
}

// Bars per year per timeframe for annualizing volatility.
export const PERIODS_PER_YEAR = {
  '1m': 525600, '5m': 105120, '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365, '1w': 52
};
