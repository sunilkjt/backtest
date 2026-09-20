import { useState } from 'react';

function fmtPrice(p, d = 2) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Smart-money map panel. Identical rendering everywhere it is used.
// Optional onFocus(barIndex): makes rows clickable to inspect/highlight;
// selected event shows its price, time, level and confirmation state.
export default function IctPanel({ ict, candles, asset, onFocus }) {
  const [sel, setSel] = useState(null);
  if (!ict || !ict.range) return null;
  const dec = asset?.decimals ?? 2;
  const clickable = typeof onFocus === 'function';
  const pick = (e) => {
    setSel(e);
    if (clickable && e && Number.isFinite(e.index)) onFocus(e.index);
  };
  const rowProps = (e) => (clickable
    ? { onClick: () => pick(e), style: { cursor: 'pointer' }, title: 'Inspect this event' }
    : {});
  return (
    <>
      <h2>🧠 ICT / SMC — smart-money map</h2>
      <p className="sub">Bias <b>{ict.bias} ({ict.biasScore})</b> · {ict.zone} · range {fmtPrice(ict.range.low, dec)} – {fmtPrice(ict.range.high, dec)}</p>
      <div className="kv"><span>Structure (last swings)</span><span><b>{[...ict.classified.highs.slice(-2).map((s) => s.kind), ...ict.classified.lows.slice(-2).map((s) => s.kind)].join(' · ') || '—'}</b></span></div>
      <div className="kv"><span>Session</span><span><b>{ict.session ? `${ict.session.name}${ict.session.killzone ? ' ⚡ killzone' : ''}` : '—'}</b></span></div>
      <div className="kv"><span>Prev day H / L</span><span><b>{ict.prevDay ? `${fmtPrice(ict.prevDay.high, dec)} / ${fmtPrice(ict.prevDay.low, dec)}` : '—'}</b></span></div>
      <div className="kv"><span>Prev week H / L</span><span><b>{ict.prevWeek ? `${fmtPrice(ict.prevWeek.high, dec)} / ${fmtPrice(ict.prevWeek.low, dec)}` : '—'}</b></span></div>
      <div className="kv"><span>Position in dealing range</span><span><b>{(ict.positionInRange * 100).toFixed(0)}%</b> (0% = range low)</span></div>
      <div className="kv"><span>Liquidity pools (equal H/L)</span><span><b>{ict.pools?.length || 0}</b></span></div>
      <div className="kv"><span>Order blocks (active / mitigated / violated)</span><span><b>{ict.orderBlocks.filter((o) => o.state === 'active').length} / {ict.orderBlocks.filter((o) => o.state === 'mitigated').length} / {ict.orderBlocks.filter((o) => o.state === 'violated').length}</b></span></div>
      <div className="kv"><span>Breaker blocks</span><span><b>{ict.breakers.length}</b></span></div>
      <div className="kv"><span>FVG (open / partial / filled)</span><span><b>{ict.fvgs.filter((g) => g.state === 'unfilled').length} / {ict.fvgs.filter((g) => g.state === 'partial').length} / {ict.fvgs.filter((g) => g.state === 'filled').length}</b></span></div>
      <h2 style={{ marginTop: 12, fontSize: 14 }}>⚡ Latest structure events{clickable ? ' (click to inspect)' : ''}</h2>
      {(ict.events.slice(-8).reverse().length === 0) && <p className="sub">No BOS / sweep in the recent window — chop or slow grind.</p>}
      {ict.events.slice(-8).reverse().map((e, i) => (
        <div className="reason" key={i} {...rowProps(e)}>
          <span className={`dot ${e.direction === 1 ? 'bull' : 'bear'}`} />
          <div><b>{e.label}</b><p>bar #{e.index} · {new Date(candles[e.index]?.timestamp).toLocaleString()}</p></div>
          <span className="pts">{e.direction === 1 ? '+4' : '−4'}</span>
        </div>
      ))}
      {sel && (
        <div className="alert" style={{ marginTop: 8 }}>
          <b>🔎 {sel.type}</b> — {sel.label}<br />
          Price level: <b>{sel.price != null ? fmtPrice(sel.price, dec) : 'see chart marker'}</b> ·
          Time: <b>{new Date(candles[sel.index]?.timestamp).toLocaleString()}</b> · bar #{sel.index}<br />
          Confirmation: detected in completed bars only — no future data involved.
        </div>
      )}
      {ict.breakers.slice(-4).reverse().map((b, i) => (
        <div className="kv" key={'br' + i} {...(clickable ? { onClick: () => pick({ ...b, type: 'breaker' }), style: { cursor: 'pointer' } } : {})}><span>🧱 {b.label}</span><span>bar #{b.index}</span></div>
      ))}
      {ict.orderBlocks.slice(-4).reverse().map((o, i) => (
        <div className="kv" key={'ob' + i} {...(clickable ? { onClick: () => pick({ ...o, type: 'order-block' }), style: { cursor: 'pointer' } } : {})}><span>{o.direction === 1 ? '🟩' : '🟥'} {o.label}</span><span>bar #{o.index}</span></div>
      ))}
      {ict.fvgs.slice(-4).reverse().map((g, i) => (
        <div className="kv" key={'fvg' + i} {...(clickable ? { onClick: () => pick({ ...g, type: 'fvg' }), style: { cursor: 'pointer' } } : {})}><span>{g.direction === 1 ? '📈' : '📉'} {g.label}</span><span>bar #{g.index}</span></div>
      ))}
    </>
  );
}
