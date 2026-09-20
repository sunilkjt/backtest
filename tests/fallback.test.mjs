// Hyperliquid stock-fallback mapping: bare ticker -> Yahoo symbol (null = not stock-like).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guessStockYahoo } from '../src/lib/providers.js';

describe('hyperliquid stock fallback mapping', () => {
  it('maps explicit equities through', () => {
    assert.equal(guessStockYahoo('AAPL'), 'AAPL');
    assert.equal(guessStockYahoo('pltr'), 'PLTR');
    assert.equal(guessStockYahoo('KO'), 'KO');
  });
  it('maps FX/commodities/indices to Yahoo symbols', () => {
    assert.equal(guessStockYahoo('GOLD'), 'GC=F');
    assert.equal(guessStockYahoo('EUR'), 'EURUSD=X');
    assert.equal(guessStockYahoo('SP500'), '^GSPC');
  });
  it('never misroutes crypto majors to Yahoo', () => {
    assert.equal(guessStockYahoo('BTC'), null);
    assert.equal(guessStockYahoo('ETH'), null);
    assert.equal(guessStockYahoo('HYPE'), null);
    assert.equal(guessStockYahoo('SOL'), null);
  });
  it('rejects non-ticker input', () => {
    assert.equal(guessStockYahoo(''), null);
    assert.equal(guessStockYahoo('TOOLONGNAME'), null);
    assert.equal(guessStockYahoo('ABC123'), null);
  });
});
