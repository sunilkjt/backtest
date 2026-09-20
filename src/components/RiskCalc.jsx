import { useState } from 'react';
import { liquidationPrice, liqLabel } from '../lib/riskModels.js';

function money(v) {
  const s = v < 0 ? '−$' : '$';
  return s + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPrice(p, d = 2) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Position-size calculator. Identical rendering everywhere it is used.
export default function RiskCalc({ asset, levels, lastClose, balance, model, onModel }) {
  const [bal, setBal] = useState(balance || 10000);
  const [riskPct, setRiskPct] = useState(1);
  const [entry, setEntry] = useState(null);
  const [sl, setSl] = useState(null);
  const [tp, setTp] = useState(null);
  const [lev, setLev] = useState(1);
  const e = entry ?? lastClose ?? levels?.entry ?? 0;
  const s = sl ?? levels?.stop ?? 0;
  const t = tp ?? levels?.takeProfit ?? 0;
  const dir = e > s ? 1 : -1;
  const stopDist = Math.abs(e - s);
  const tpDist = Math.abs(t - e);
  const maxLoss = bal * (riskPct / 100);
  const qty = stopDist > 0 ? maxLoss / stopDist : 0;
  const notional = qty * e;
  const margin = lev > 0 ? notional / lev : notional;
  const profit = tpDist * qty;
  const rr = stopDist > 0 ? tpDist / stopDist : 0;
  const liq = lev > 1 && e ? liquidationPrice(model || 'isolated-simple', e, dir, lev) : null;
  const liqClose = liq != null && stopDist > 0 && Math.abs(e - liq) < stopDist * 1.5;
  return (
    <div>
      <h2>🧮 Risk Calculator</h2>
      <p className="sub">Size from risk, not from hope. Prefilled from SignalBot levels.</p>
      <div className="row2">
        <div><label className="lbl">Account ($)</label><input type="number" value={bal} onChange={(ev) => setBal(Number(ev.target.value) || 0)} /></div>
        <div><label className="lbl">Risk (%)</label><input type="number" step="0.25" value={riskPct} onChange={(ev) => setRiskPct(Number(ev.target.value) || 0)} /></div>
      </div>
      <div className="row2">
        <div><label className="lbl">Entry</label><input type="number" value={e || ''} onChange={(ev) => setEntry(Number(ev.target.value) || 0)} /></div>
        <div><label className="lbl">Stop loss</label><input type="number" value={s || ''} onChange={(ev) => setSl(Number(ev.target.value) || 0)} /></div>
      </div>
      <div className="row2">
        <div><label className="lbl">Take profit</label><input type="number" value={t || ''} onChange={(ev) => setTp(Number(ev.target.value) || 0)} /></div>
        <div><label className="lbl">Leverage (×)</label><input type="number" min="1" max="50" value={lev} onChange={(ev) => setLev(Math.min(50, Math.max(1, Number(ev.target.value) || 1)))} /></div>
      </div>
      <div className="kv"><span>Maximum risk</span><span><b>{money(maxLoss)}</b></span></div>
      <div className="kv"><span>Position size</span><span><b>{qty.toFixed(4)} {asset?.symbol}</b> (${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })} notional)</span></div>
      <div className="kv"><span>Margin used</span><span><b>${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b></span></div>
      <div className="kv"><span>Potential profit</span><span className="pos"><b>{money(profit)}</b></span></div>
      <div className="kv"><span>Risk / reward</span><span><b>1 : {rr.toFixed(2)}</b></span></div>
      {liq != null && (
        <div className="alert" style={liqClose ? { borderColor: 'rgba(251,113,133,.5)', background: 'rgba(251,113,133,.1)', marginTop: 8 } : { marginTop: 8 }}>
          {liqClose ? '🚨 Liquidation warning' : 'ℹ️ Liquidation'} — {liqLabel(model || 'isolated-simple')}: ~{fmtPrice(liq, asset?.decimals)}{liqClose ? ', uncomfortably close to your stop. Lower leverage.' : ', safely beyond your stop.'}
        </div>
      )}
      <div className="row2" style={{ marginTop: 8 }}>
        <div><label className="lbl">Liquidation model</label>
          <select value={model || 'isolated-simple'} onChange={(e) => onModel && onModel(e.target.value)}>
            <option value="isolated-simple">Isolated (simplified)</option>
            <option value="hyperliquid">Hyperliquid-style (≈)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
