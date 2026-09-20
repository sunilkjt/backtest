function fmtPrice(p, d = 2) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function money(v) {
  const s = v < 0 ? '−$' : '$';
  return s + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Backtest trade ledger. Identical rendering everywhere it is used.
export default function TradesTable({ trades, decimals = 2 }) {
  return (
    <>
      <h2>📜 Trades ({trades.length})</h2>
      <p className="sub">Newest first · costs already deducted · R-multiples implied by ATR stop/target</p>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Entry → Exit</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Net</th><th>Ret%</th><th>Reason</th><th>Held</th></tr></thead>
          <tbody>
            {[...trades].reverse().slice(0, 80).map((t, i) => (
              <tr key={i}>
                <td>{new Date(t.entryTime).toLocaleDateString()} → {new Date(t.exitTime).toLocaleDateString()}</td>
                <td><span className={t.dir === 1 ? 'long-tag' : 'short-tag'}>{t.dir === 1 ? 'LONG' : 'SHORT'}</span></td>
                <td>{fmtPrice(t.entry, decimals)}</td>
                <td>{fmtPrice(t.exit, decimals)}</td>
                <td className={t.net > 0 ? 'pos' : 'neg'}>{money(t.net)}</td>
                <td className={t.net > 0 ? 'pos' : 'neg'}>{t.retPct.toFixed(2)}%</td>
                <td>{t.reason}</td>
                <td>{t.barsHeld} bars</td>
              </tr>
            ))}
            {trades.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center' }}>No trades — the strategy never triggered on this window. Try another strategy or timeframe.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
