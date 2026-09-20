import { useCallback, useEffect, useMemo, useState } from 'react';
import Robot from './components/Robot.jsx';
import CandleChart from './components/CandleChart.jsx';
import EquityChart from './components/EquityChart.jsx';
import { MARKETS, TIMEFRAMES, ASSETS, assetsForMarket } from './lib/assets.js';
import { providerForMarket, UNAVAILABLE } from './lib/providers.js';
import { computeAll } from './lib/indicators.js';
import { STRATEGIES, getStrategy } from './lib/strategies.js';
import { runBacktest, compareAll, DEFAULT_RISK } from './lib/backtest.js';
import { analyzeICT } from './lib/ict.js';
import { buildSignal } from './lib/signals.js';
import { generateDemoCandles } from './lib/demo.js';
import { tradesToCsv, download, summaryText } from './lib/export.js';

export default function App() {
  const [market, setMarket] = useState('crypto');
  const [symbol, setSymbol] = useState('BTC');
  const [timeframe, setTimeframe] = useState('1h');
  const [strategyId, setStrategyId] = useState('ema-rsi');
  const [limit, setLimit] = useState(300);
  const [risk, setRisk] = useState(DEFAULT_RISK);
  const [demoMode, setDemoMode] = useState(false);
  const [candles, setCandles] = useState([]);
  const [source, setSource] = useState('live');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [price, setPrice] = useState(null);
  const [compared, setCompared] = useState(null);
  const [hlCoins, setHlCoins] = useState([]);

  const assetList = useMemo(() => assetsForMarket(market), [market]);
  const asset = useMemo(
    () => ASSETS.find((a) => a.market === market && a.symbol === symbol) || assetList[0],
    [market, symbol, assetList]
  );

  const fetchData = useCallback(async (opts = {}) => {
    const m = opts.market ?? market;
    const sym = opts.symbol ?? symbol;
    const tf = opts.timeframe ?? timeframe;
    const lim = opts.limit ?? limit;
    const useDemo = opts.demoMode ?? demoMode;
    const a = ASSETS.find((x) => x.market === m && x.symbol === sym) || assetsForMarket(m)[0];
    if (!a) return;
    setLoading(true);
    setError('');
    setCompared(null);
    try {
      if (useDemo) {
        await new Promise((r) => setTimeout(r, 350));
        setCandles(generateDemoCandles(a.symbol, tf, lim));
        setSource('demo');
        setPrice(null);
      } else {
        const provider = providerForMarket(m);
        const data = await provider.getCandles({ symbol: a.symbol, ref: a.ref, timeframe: tf, limit: lim });
        setCandles(data);
        setSource('live');
        provider.getPrice({ symbol: a.symbol, ref: a.ref }).then(setPrice).catch(() => {});
      }
    } catch (e) {
      setCandles([]);
      setPrice(null);
      setError(e?.message || UNAVAILABLE);
    } finally {
      setLoading(false);
    }
  }, [market, symbol, timeframe, limit, demoMode]);

  useEffect(() => { fetchData({}); }, []); // auto-run on load
  useEffect(() => {
    // discover Hyperliquid coins for the metadata card (non-blocking)
    providerForMarket('hyperliquid').discover().then(setHlCoins).catch(() => {});
  }, []);

  const pickMarket = (m) => {
    const first = assetsForMarket(m)[0];
    setMarket(m);
    setSymbol(first.symbol);
    setCompared(null);
    setTimeout(() => fetchData({ market: m, symbol: first.symbol }), 0);
  };
  const pickSymbol = (s) => {
    setSymbol(s);
    setTimeout(() => fetchData({ symbol: s }), 0);
  };
  const pickTf = (t) => {
    setTimeframe(t);
    setTimeout(() => fetchData({ timeframe: t }), 0);
  };

  const ind = useMemo(() => (candles.length ? computeAll(candles) : null), [candles]);
  const ict = useMemo(() => (candles.length ? analyzeICT(candles) : null), [candles]);
  const signal = useMemo(
    () => (candles.length && ind ? buildSignal(candles, ind, ict) : null),
    [candles, ind, ict]
  );
  const result = useMemo(
    () => (candles.length && ind ? runBacktest(candles, ind, strategyId, risk) : null),
    [candles, ind, strategyId, risk]
  );
  const strategy = getStrategy(strategyId);
  const lastClose = candles.length ? candles[candles.length - 1].close : null;

  const runCompare = () => {
    if (!candles.length || !ind) return;
    setCompared(compareAll(candles, ind, risk));
  };

  const doExportCsv = () => {
    if (!result) return;
    download(`${asset.symbol}-${timeframe}-${strategyId}-trades.csv`, tradesToCsv(result.trades), 'text/csv');
  };
  const doExportJson = () => {
    if (!result) return;
    download(`${asset.symbol}-${timeframe}-${strategyId}-result.json`, JSON.stringify({
      asset: asset.symbol, market, timeframe, strategy: strategyId, source,
      risk, stats: result.stats, signal, trades: result.trades
    }, null, 2), 'application/json');
  };
  const doCopy = async () => {
    if (!result || !signal) return;
    const txt = summaryText({ asset: asset.symbol, market, timeframe, strategy: strategy.name, stats: result.stats, signal });
    try { await navigator.clipboard.writeText(txt); alert('Summary copied to clipboard ✓'); }
    catch { download('summary.txt', txt); }
  };

  return (
    <div className="stars">
      <div className="wrap">
        {/* HERO */}
        <header className="hero">
          <div className="robot-wrap"><Robot mood={signal?.direction} /></div>
          <div>
            <h1>🤖 <span className="grad">AI Trading Lab</span></h1>
            <p className="tagline"><b>Test. Analyze. Understand. Trade Smarter.</b> — a browser laboratory that backtests real market data, explains every signal, and shows its work. No black boxes.</p>
            <div className="badges">
              <span className="badge">⚗️ 8 rule-based strategies</span>
              <span className="badge">📊 Real backtest engine</span>
              <span className="badge">🧠 ICT / SMC lab</span>
              <span className={source === 'live' ? 'badge live' : 'badge demo'}>{source === 'live' ? '● LIVE market data' : '● DEMO · simulated data'}</span>
              {asset && <span className="badge">🔗 {providerForMarket(market).label}</span>}
            </div>
            <div className="price-pill">
              <span className="pulse" />
              <b>{asset?.symbol} / {timeframe}</b>
              <span>{lastClose != null ? fmtPrice(lastClose, asset?.decimals) : '—'}</span>
              {price != null && source === 'live' && <span style={{ color: '#9aa6d0' }}>· live {fmtPrice(price, asset?.decimals)}</span>}
              {candles.length > 0 && <span style={{ color: '#9aa6d0' }}>· {candles.length} candles</span>}
            </div>
          </div>
        </header>

        {/* CONTROL DECK */}
        <div className="grid deck">
          <div className="card span4">
            <h2>1️⃣ Market & Asset</h2>
            <p className="sub">Pick a laboratory bench. Hyperliquid serves perps; others serve spot / cash.</p>
            <div className="seg" style={{ marginBottom: 10 }}>
              {MARKETS.map((m) => (
                <button key={m.id} className={market === m.id ? 'on' : ''} onClick={() => pickMarket(m.id)}>{m.icon} {m.label}</button>
              ))}
            </div>
            <div className="asset-grid">
              {assetList.map((a) => (
                <button key={a.symbol} className={symbol === a.symbol ? 'on chip' : 'chip'} style={symbol === a.symbol ? { background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', color: '#06101f', fontWeight: 800, border: 'none' } : {}} onClick={() => pickSymbol(a.symbol)} title={a.name}>
                  {a.symbol}
                </button>
              ))}
            </div>
            <p className="sub" style={{ marginTop: 10 }}>{asset?.name} · provider ref <code>{asset?.ref}</code></p>
          </div>

          <div className="card span4">
            <h2>2️⃣ Timeframe & Strategy</h2>
            <p className="sub">Same logic drives the backtest and the live signal — no lookahead.</p>
            <label className="lbl">Timeframe</label>
            <div className="seg">
              {TIMEFRAMES.map((t) => (
                <button key={t.id} className={timeframe === t.id ? 'on' : ''} onClick={() => pickTf(t.id)}>{t.label}</button>
              ))}
            </div>
            <label className="lbl">Strategy</label>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              {STRATEGIES.map((s) => (<option key={s.id} value={s.id}>{s.name} — {s.tagline}</option>))}
            </select>
            <p className="sub" style={{ marginTop: 8 }}>{strategy.description}</p>
            <label className="lbl">Candles (50–1000)</label>
            <input type="range" min={50} max={1000} step={10} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            <div className="kv"><span>History length</span><span><b>{limit}</b> candles</span></div>
          </div>

          <div className="card span4">
            <h2>3️⃣ Risk Lab & Data</h2>
            <p className="sub">Position sizing, costs and exits. Sizing risks a fraction of equity per ATR stop.</p>
            <div className="row2">
              <div><label className="lbl">Capital ($)</label><input type="number" value={risk.initialCapital} onChange={(e) => setRisk({ ...risk, initialCapital: Math.max(100, Number(e.target.value) || 10000) })} /></div>
              <div><label className="lbl">Risk / trade (%)</label><input type="number" step="0.5" value={risk.riskPct} onChange={(e) => setRisk({ ...risk, riskPct: Math.min(20, Math.max(0.1, Number(e.target.value) || 2)) })} /></div>
            </div>
            <div className="row2">
              <div><label className="lbl">Fee / side (%)</label><input type="number" step="0.01" value={risk.feePct} onChange={(e) => setRisk({ ...risk, feePct: Number(e.target.value) || 0 })} /></div>
              <div><label className="lbl">Slippage / side (%)</label><input type="number" step="0.01" value={risk.slippagePct} onChange={(e) => setRisk({ ...risk, slippagePct: Number(e.target.value) || 0 })} /></div>
            </div>
            <div className="row2">
              <div><label className="lbl">Stop = ATR ×</label><input type="number" step="0.5" value={risk.stopAtrMult} onChange={(e) => setRisk({ ...risk, stopAtrMult: Number(e.target.value) || 2 })} /></div>
              <div><label className="lbl">Take-profit RR</label><input type="number" step="0.5" value={risk.takeProfitRR} onChange={(e) => setRisk({ ...risk, takeProfitRR: Number(e.target.value) || 2 })} /></div>
            </div>
            <label className="toggle"><input type="checkbox" checked={risk.allowShort} onChange={(e) => setRisk({ ...risk, allowShort: e.target.checked })} /> Allow short positions</label>
            <label className="toggle"><input type="checkbox" checked={demoMode} onChange={(e) => { setDemoMode(e.target.checked); setTimeout(() => fetchData({ demoMode: e.target.checked }), 0); }} /> Use clearly-labelled <b>&nbsp;demo data&nbsp;</b> (offline / testing)</label>
            <div className="toolbar">
              <button className="btn" disabled={loading} onClick={() => fetchData({})}>{loading ? '⚗️ Brewing data…' : '🧪 Fetch & Backtest'}</button>
              <button className="btn ghost" onClick={runCompare} disabled={!candles.length}>⚔️ Compare all</button>
            </div>
          </div>
        </div>

        {/* STATUS */}
        {loading && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="loading-robot"><span className="spin" /> The robot is pipetting <b>&nbsp;{asset?.symbol} {timeframe}&nbsp;</b> candles from <b>&nbsp;{providerForMarket(market).label}&nbsp;</b>…</div>
          </div>
        )}
        {error && !loading && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert err">⚠️ <b>{error}</b><br />The provider could not supply this market/timeframe. Intraday Forex/Stocks/Commodities history is limited on the free Stooq feed — try <b>1D</b> or <b>1W</b>, or run the clearly-labelled demo below.</div>
            <div className="toolbar">
              <button className="btn pink" onClick={() => { setDemoMode(true); fetchData({ demoMode: true }); }}>🎭 Load DEMO (simulated) data</button>
              <button className="btn ghost" onClick={() => { setTimeframe('1d'); fetchData({ timeframe: '1d', demoMode: false }); }}>Try 1D live data</button>
            </div>
          </div>
        )}
        {source === 'demo' && candles.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert">🎭 <b>DEMO · simulated data in use</b> — deterministic random-walk for testing the lab offline. NOT live market data. Toggle it off in the Risk Lab card to retry live providers.</div>
          </div>
        )}

        {/* RESULTS */}
        {signal && result && !loading && !error && (
          <>
            <div className="card span12" style={{ marginTop: 16 }}>
              <div className="signal-banner">
                <div className={`signal-badge ${signal.direction}`}>{signal.direction === 'BUY' ? '▲ BUY' : signal.direction === 'SELL' ? '▼ SELL' : '● HOLD'}<small>{signal.score}/100 · {signal.confidence}</small></div>
                <div>
                  <h2 style={{ margin: '0 0 6px' }}>🔬 Signal Lab — {asset.symbol} · {timeframe} · {strategy.name}</h2>
                  <p className="sub">Confluence of {signal.reasons.length} transparent checks · 🟢 {signal.bull} bull pts vs 🔴 {signal.bear} bear pts (net {signal.net >= 0 ? '+' : ''}{signal.net}) · {source === 'live' ? 'LIVE data' : 'DEMO data'}</p>
                  <div className="gauge"><div style={{ width: `${signal.score}%` }} /></div>
                  <div className="gauge-marks"><span>0 · strong sell</span><span>40 · sell edge</span><span>50 · neutral</span><span>60 · buy edge</span><span>100 · strong buy</span></div>
                </div>
              </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
              <div className="card span8">
                <h2>📈 Price Lab — trades on chart</h2>
                <p className="sub">{candles.length} candles · EMA 20/50 + Bollinger + order-blocks + swings · ▲/▼ entries, dots exits</p>
                <CandleChart candles={candles} ind={ind} trades={result.trades} ict={ict} />
              </div>
              <div className="card span4">
                <h2>💰 Performance</h2>
                <p className="sub">Fees + slippage included · ATR ({risk.stopAtrMult}×) stops · {risk.takeProfitRR}R targets</p>
                <div className="stats">
                  <Stat k="Net P&L" v={`${money(result.stats.totalNet)}`} c={result.stats.totalNet > 0 ? 'good' : result.stats.totalNet < 0 ? 'bad' : 'flat'} />
                  <Stat k="Return" v={`${result.stats.totalReturnPct.toFixed(2)}%`} c={result.stats.totalReturnPct > 0 ? 'good' : result.stats.totalReturnPct < 0 ? 'bad' : 'flat'} />
                  <Stat k="Win rate" v={`${result.stats.winRate.toFixed(1)}%`} c="flat" />
                  <Stat k="Profit factor" v={fmtPF(result.stats.profitFactor)} c={result.stats.profitFactor > 1.5 ? 'good' : result.stats.profitFactor < 1 ? 'bad' : 'flat'} />
                  <Stat k="Max drawdown" v={`${result.stats.maxDrawdownPct.toFixed(2)}%`} c={result.stats.maxDrawdownPct > 20 ? 'bad' : 'flat'} />
                  <Stat k="Sharpe" v={result.stats.sharpe.toFixed(2)} c={result.stats.sharpe > 1 ? 'good' : 'flat'} />
                  <Stat k="Trades" v={result.stats.trades} c="flat" />
                  <Stat k="Expectancy" v={money(result.stats.expectancy)} c={result.stats.expectancy > 0 ? 'good' : 'bad'} />
                  <Stat k="Final equity" v={money(result.stats.finalEquity)} c="flat" />
                </div>
                <h2 style={{ marginTop: 14 }}>Equity curve</h2>
                <EquityChart equity={result.equity} initial={risk.initialCapital} />
                <div className="toolbar">
                  <button className="btn ghost" onClick={doExportCsv}>⬇ CSV trades</button>
                  <button className="btn ghost" onClick={doExportJson}>⬇ JSON</button>
                  <button className="btn ghost" onClick={doCopy}>📋 Copy summary</button>
                </div>
              </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
              <div className="card span6">
                <h2>🧾 Why this signal? — full reasoning</h2>
                <p className="sub">Every check listed. Nothing hidden. Weights are fixed and shown.</p>
                {signal.reasons.map((r, i) => (
                  <div className="reason" key={i}>
                    <span className={`dot ${r.side}`} />
                    <div><b>{r.label}</b><p>{r.detail}</p></div>
                    <span className="pts" style={{ color: r.side === 'bull' ? '#34d399' : r.side === 'bear' ? '#fb7185' : '#9aa6d0' }}>{r.points > 0 ? `+${r.points}` : '±0'}</span>
                  </div>
                ))}
              </div>
              <div className="card span6">
                <h2>🧠 ICT / SMC — smart-money map</h2>
                <p className="sub">Bias <b>{ict.bias} ({ict.biasScore})</b> · {ict.zone} · range {fmtPrice(ict.range.low, asset.decimals)} – {fmtPrice(ict.range.high, asset.decimals)}</p>
                <div className="kv"><span>Position in dealing range</span><span><b>{(ict.positionInRange * 100).toFixed(0)}%</b> (0% = range low)</span></div>
                <div className="kv"><span>Liquidity pools found</span><span><b>{ict.pools?.length || 0}</b></span></div>
                <div className="kv"><span>Order blocks (recent)</span><span><b>{ict.orderBlocks.length}</b></span></div>
                <div className="kv"><span>Fair value gaps (recent)</span><span><b>{ict.fvgs.length}</b></span></div>
                <h2 style={{ marginTop: 12, fontSize: 14 }}>⚡ Latest structure events</h2>
                {(ict.events.slice(-8).reverse().length === 0) && <p className="sub">No BOS / sweep in the recent window — chop or slow grind.</p>}
                {ict.events.slice(-8).reverse().map((e, i) => (
                  <div className="reason" key={i}>
                    <span className={`dot ${e.direction === 1 ? 'bull' : 'bear'}`} />
                    <div><b>{e.label}</b><p>bar #{e.index} · {new Date(candles[e.index]?.timestamp).toLocaleString()}</p></div>
                    <span className="pts">{e.direction === 1 ? '+4' : '−4'}</span>
                  </div>
                ))}
                {ict.orderBlocks.slice(-4).reverse().map((o, i) => (
                  <div className="kv" key={'ob' + i}><span>{o.direction === 1 ? '🟩' : '🟥'} {o.label}</span><span>bar #{o.index}</span></div>
                ))}
                {ict.fvgs.slice(-4).reverse().map((g, i) => (
                  <div className="kv" key={'fvg' + i}><span>{g.direction === 1 ? '📈' : '📉'} {g.label}</span><span>bar #{g.index}</span></div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h2>📜 Trades ({result.trades.length})</h2>
              <p className="sub">Newest first · costs already deducted · R-multiples implied by ATR stop/target</p>
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Entry → Exit</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Net</th><th>Ret%</th><th>Reason</th><th>Held</th></tr></thead>
                  <tbody>
                    {[...result.trades].reverse().slice(0, 80).map((t, i) => (
                      <tr key={i}>
                        <td>{new Date(t.entryTime).toLocaleDateString()} → {new Date(t.exitTime).toLocaleDateString()}</td>
                        <td><span className={t.dir === 1 ? 'long-tag' : 'short-tag'}>{t.dir === 1 ? 'LONG' : 'SHORT'}</span></td>
                        <td>{fmtPrice(t.entry, asset.decimals)}</td>
                        <td>{fmtPrice(t.exit, asset.decimals)}</td>
                        <td className={t.net > 0 ? 'pos' : 'neg'}>{money(t.net)}</td>
                        <td className={t.net > 0 ? 'pos' : 'neg'}>{t.retPct.toFixed(2)}%</td>
                        <td>{t.reason}</td>
                        <td>{t.barsHeld} bars</td>
                      </tr>
                    ))}
                    {result.trades.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center' }}>No trades — the strategy never triggered on this window. Try another strategy or timeframe.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h2>⚔️ Strategy Colosseum</h2>
              <p className="sub">Same candles, same risk settings — may the best robot win. Click “Compare all”.</p>
              {!compared && <button className="btn" onClick={runCompare}>⚔️ Run all 8 strategies</button>}
              {compared && (
                <div className="tbl-wrap" style={{ maxHeight: 340 }}>
                  <table>
                    <thead><tr><th>Strategy</th><th>Net</th><th>Return</th><th>Win%</th><th>PF</th><th>MaxDD</th><th>Trades</th><th></th></tr></thead>
                    <tbody>
                      {compared
                        .map((r) => ({ ...r, name: STRATEGIES.find((s) => s.id === r.strategyId)?.name }))
                        .sort((a, b) => b.stats.totalNet - a.stats.totalNet)
                        .map((r) => (
                          <tr key={r.strategyId} style={r.strategyId === strategyId ? { background: 'rgba(34,211,238,.08)' } : {}}>
                            <td><b>{r.name}</b></td>
                            <td className={r.stats.totalNet > 0 ? 'pos' : 'neg'}>{money(r.stats.totalNet)}</td>
                            <td className={r.stats.totalReturnPct > 0 ? 'pos' : 'neg'}>{r.stats.totalReturnPct.toFixed(2)}%</td>
                            <td>{r.stats.winRate.toFixed(1)}%</td>
                            <td>{fmtPF(r.stats.profitFactor)}</td>
                            <td>{r.stats.maxDrawdownPct.toFixed(1)}%</td>
                            <td>{r.stats.trades}</td>
                            <td><button className="chip" onClick={() => setStrategyId(r.strategyId)}>Load</button></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* HYPERLIQUID META */}
        <div className="card" style={{ marginTop: 16 }}>
          <h2>⚡ Hyperliquid adapter</h2>
          <p className="sub">Public market-data only (<code>POST https://api.hyperliquid.xyz/info</code> — <code>meta</code>, <code>allMids</code>, <code>candle</code>). No wallet keys, no secrets, ever. {hlCoins.length > 0 ? `Discovered ${hlCoins.length} perp markets — showing first 12:` : 'Live discovery needs network access; the bench still works with the built-in list.'}</p>
          {hlCoins.length > 0 && (
            <div className="seg">{hlCoins.slice(0, 12).map((c) => (<span className="chip" key={c.symbol}>{c.symbol} · {c.maxLeverage}×</span>))}</div>
          )}
        </div>

        <div className="card footer" style={{ marginTop: 16 }}>
          <b>🔬 How the lab works.</b> Indicators (SMA/EMA/RSI/MACD/Bollinger/ATR/Stochastic/Donchian/Supertrend/ADX) are computed locally from normalized OHLCV <code>{'{timestamp, open, high, low, close, volume}'}</code>.
          Strategies emit bar-close signals with no lookahead; the backtester sizes positions by <i>risk% ÷ ATR-stop distance</i>, deducts fees + slippage both sides, and enforces ATR stops, R-multiple targets and optional shorts.
          Confluence = bull-points ÷ (bull + bear) × 100 across trend, momentum, volatility, price-action and ICT checks — every point is listed above.
          <br /><br />
          Data: Crypto via <b>Binance Vision</b> spot klines · Hyperliquid via public <b>info</b> API · Forex/Stocks/Commodities via <b>Stooq</b> free CSV (daily/weekly; intraday shows “Historical data unavailable from this provider” when unsupported).
          Demo data is deterministic simulation and is always labelled <b>DEMO</b> — never presented as live.
          <br /><br />
          ⚠️ Educational software. Not financial advice. Hypothetical backtests do not guarantee future results. ·
          <a href="https://github.com/sunilkjt/backtest" target="_blank" rel="noreferrer">GitHub: sunilkjt/backtest</a> · Deploys to GitHub Pages at <code>/backtest/</code>.
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, c }) {
  return (<div className="stat"><div className="k">{k}</div><div className={`v ${c || 'flat'}`}>{v}</div></div>);
}
function money(v) {
  const s = v < 0 ? '−$' : '$';
  return s + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPF(pf) {
  if (!Number.isFinite(pf)) return pf > 0 ? '∞' : '0.00';
  return pf.toFixed(2);
}
function fmtPrice(p, d = 2) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
