// hlCategory: Hyperliquid core = crypto, xyz = stock unless FX/commodity/index.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hlCategory } from '../src/lib/assets.js';

describe('hyperliquid categories', () => {
  it('classifies core dex as crypto', () => {
    assert.equal(hlCategory({ ref: 'BTC' }), 'crypto');
    assert.equal(hlCategory({ ref: 'HYPE' }), 'crypto');
  });
  it('classifies xyz equities as stock', () => {
    assert.equal(hlCategory({ ref: 'xyz:AAPL' }), 'stock');
    assert.equal(hlCategory({ ref: 'xyz:PLTR' }), 'stock');
    assert.equal(hlCategory({ ref: 'xyz:HOOD' }), 'stock');
    assert.equal(hlCategory({ ref: 'xyz:GME' }), 'stock');
  });
  it('splits FX, commodities and indices out', () => {
    assert.equal(hlCategory({ ref: 'xyz:EUR' }), 'fx');
    assert.equal(hlCategory({ ref: 'xyz:GOLD' }), 'commodity');
    assert.equal(hlCategory({ ref: 'xyz:CL' }), 'commodity');
    assert.equal(hlCategory({ ref: 'xyz:SP500' }), 'index');
    assert.equal(hlCategory({ ref: 'xyz:VIX' }), 'index');
  });
  it('covers the full live xyz universe without gaps', async () => {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'meta', dex: 'xyz' })
    });
    const j = await res.json();
    const u = j.universe || (j[0] && j[0].universe) || [];
    assert.ok(u.length > 100, `xyz universe has ${u.length} coins`);
    const cats = {};
    for (const c of u) {
      const k = hlCategory({ ref: c.name });
      cats[k] = (cats[k] || 0) + 1;
      assert.ok(['stock', 'fx', 'commodity', 'index'].includes(k), `${c.name} unclassified`);
    }
    assert.ok(cats.stock > 60, `only ${cats.stock} stocks`);
  });
});
