export function tradesToCsv(trades) {
  const header = ['entryTime', 'exitTime', 'dir', 'entry', 'exit', 'qty', 'gross', 'costs', 'funding', 'net', 'retPct', 'reason', 'barsHeld'];
  const rows = trades.map((t) => [
    new Date(t.entryTime).toISOString(), new Date(t.exitTime).toISOString(),
    t.dir === 1 ? 'LONG' : 'SHORT',
    t.entry, t.exit, t.qty, t.gross, t.costs, t.fundingPaid ?? 0, t.net, t.retPct, t.reason, t.barsHeld
  ]);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function signalsToCsv(signal) {
  const header = ['group', 'side', 'points', 'label', 'detail'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = (signal?.reasons || []).map((r) => [r.group || '', r.side, r.points, r.label, r.detail]);
  return [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function strategyToJson(strategy, risk, weights) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), strategy, risk, weights }, null, 2);
}

export function analysisReport({ asset, market, timeframe, strategy, stats, signal, tech, ictS, regime, levels, source }) {
  const L = [];
  L.push(`# AI Trading Lab — Analysis Report`);
  L.push(`Date: ${new Date().toISOString()}`);
  L.push(`Asset: ${asset} (${market}) · Timeframe: ${timeframe} · Strategy: ${strategy}`);
  L.push(`Data: ${source === 'live' ? 'LIVE market data' : 'DEMO simulated data'}`);
  L.push(``);
  L.push(`## Signal: ${signal.direction} — confluence ${signal.score}/100 (${signal.confidence})`);
  L.push(`- Technical ${tech.score}/100 (bull ${tech.bull} vs bear ${tech.bear})`);
  L.push(`- ICT/SMC ${ictS.score}/100 (bull ${ictS.bull} vs bear ${ictS.bear})`);
  L.push(`- Regime: ${regime.label} — ${regime.detail}`);
  if (levels) L.push(`- Plan: entry ${levels.entry}, stop ${levels.stop}, target ${levels.takeProfit} (RR ${levels.rr})`);
  L.push(``);
  L.push(`## Backtest`);
  for (const [k, v] of Object.entries(stats)) L.push(`- ${k}: ${Number.isFinite(v) ? Math.round(v * 100) / 100 : v}`);
  L.push(``);
  L.push(`## Why (all reasons)`);
  for (const r of signal.reasons) L.push(`- [${r.group}/${r.side} +${r.points}] ${r.label} — ${r.detail}`);
  L.push(``);
  L.push(`_Educational backtest. Not financial advice. Confluence is not a win probability._`);
  return L.join('\n');
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
