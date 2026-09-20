export function tradesToCsv(trades) {
  const header = ['entryTime', 'exitTime', 'dir', 'entry', 'exit', 'qty', 'gross', 'costs', 'net', 'retPct', 'reason', 'barsHeld'];
  const rows = trades.map((t) => [
    new Date(t.entryTime).toISOString(), new Date(t.exitTime).toISOString(),
    t.dir === 1 ? 'LONG' : 'SHORT',
    t.entry, t.exit, t.qty, t.gross, t.costs, t.net, t.retPct, t.reason, t.barsHeld
  ]);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function download(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

export function summaryText({ asset, market, timeframe, strategy, stats, signal }) {
  return [
    'AI TRADING LAB — BACKTEST SUMMARY',
    `Asset: ${asset} (${market}) · Timeframe: ${timeframe} · Strategy: ${strategy}`,
    `Signal: ${signal.direction} · Confluence ${signal.score}/100 (${signal.confidence} confidence)`,
    `Trades: ${stats.trades} · Win rate: ${stats.winRate.toFixed(1)}% · Profit factor: ${fmtPF(stats.profitFactor)}`,
    `Net: ${stats.totalNet.toFixed(2)} · Return: ${stats.totalReturnPct.toFixed(2)}% · MaxDD: ${stats.maxDrawdownPct.toFixed(2)}% · Sharpe: ${stats.sharpe.toFixed(2)}`,
    'Not financial advice. Hypothetical backtest.'
  ].join('\n');
}

function fmtPF(pf) {
  if (!Number.isFinite(pf)) return pf > 0 ? '∞' : '0.00';
  return pf.toFixed(2);
}
