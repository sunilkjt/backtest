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
  const [view, setView] = useState('lab'); // 'lab' | 'learn' — separate beginner tab
  const [hlCoins, setHlCoins] = useState([]);
  const [query, setQuery] = useState('');
  const [customs, setCustoms] = useState([]); // user-loaded tickers not in the built-in list
  const [binSyms, setBinSyms] = useState(null); // all Binance spot symbols, lazy-loaded
  const [binLoading, setBinLoading] = useState(false);

  const assetList = useMemo(() => assetsForMarket(market), [market]);
  const knownAssets = useMemo(() => [...ASSETS, ...customs], [customs]);
  const asset = useMemo(
    () => knownAssets.find((a) => a.market === market && a.symbol === symbol) || assetList[0],
    [market, symbol, assetList, knownAssets]
  );

  // Discover extras: every Hyperliquid coin (core + xyz) and every Binance
  // spot symbol beyond the built-in shortlist, so search covers everything.
  const extras = useMemo(() => {
    const out = [];
    const builtRefs = new Set(ASSETS.map((a) => a.market + '|' + a.ref));
    if (market === 'hyperliquid') {
      for (const c of hlCoins) {
        if (builtRefs.has('hyperliquid|' + c.symbol)) continue;
        const short = c.symbol.includes(':') ? c.symbol.split(':')[1] : c.symbol;
        out.push({ market: 'hyperliquid', symbol: short, name: `${short} (${c.dex === 'xyz' ? 'Hyperliquid xyz' : 'Hyperliquid'})`, ref: c.symbol, decimals: 3, extra: true });
      }
    }
    if (market === 'crypto' && Array.isArray(binSyms)) {
      for (const s of binSyms) {
        if (builtRefs.has('crypto|' + s)) continue;
        const base = s.endsWith('USDT') ? s.slice(0, -4) : s;
        out.push({ market: 'crypto', symbol: base, name: `${base} / USDT (Binance)`, ref: s, decimals: 4, extra: true });
      }
    }
    for (const c of customs) {
      if (c.market === market && !out.some((o) => o.symbol === c.symbol)) out.push(c);
    }
    return out;
  }, [market, hlCoins, binSyms, customs]);

  const allOptions = useMemo(() => {
    const seen = new Set();
    return [...assetList, ...extras].filter((a) => {
      const k = a.symbol + '|' + a.ref;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [assetList, extras]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return allOptions.slice(0, 80);
    const base = stripQuote(q);
    return allOptions.filter((a) => {
      const sym = norm(a.symbol), nm = norm(a.name), rf = norm(a.ref);
      if (sym.includes(q) || nm.includes(q) || rf.includes(q)) return true;
      // "op usdt" → base "op" should still find OP / OPUSDT
      return base.length >= 2 && (sym === base || sym.includes(base) || rf.includes(base));
    }).slice(0, 80);
  }, [allOptions, query]);

  // Hide the custom-ticker button when the query already resolves exactly
  // ("OP USDT" → OPUSDT exists, so no custom needed).
  const hasExact = useMemo(() => {
    const q = norm(query);
    if (!q) return true;
    return allOptions.some((a) => norm(a.symbol) === q || norm(a.ref) === q);
  }, [allOptions, query]);

  const resolveAsset = useCallback((m, sym, assetOverride) => {
    if (assetOverride) return assetOverride;
    return knownAssets.find((x) => x.market === m && x.symbol === sym)
      || extras.find((x) => x.symbol === sym)
      || ASSETS.find((x) => x.market === m && x.symbol === sym)
      || assetsForMarket(m)[0];
  }, [knownAssets, extras]);

  const fetchData = useCallback(async (opts = {}) => {
    const m = opts.market ?? market;
    const sym = opts.symbol ?? symbol;
    const tf = opts.timeframe ?? timeframe;
    const lim = opts.limit ?? limit;
    const useDemo = opts.demoMode ?? demoMode;
    const a = resolveAsset(m, sym, opts.asset);
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
        const data = await provider.getCandles({ symbol: a.symbol, ref: a.ref, yahoo: a.yahoo, timeframe: tf, limit: lim });
        setCandles(data);
        setSource('live');
        provider.getPrice({ symbol: a.symbol, ref: a.ref, yahoo: a.yahoo }).then(setPrice).catch(() => {});
      }
    } catch (e) {
      setCandles([]);
      setPrice(null);
      setError(e?.message || UNAVAILABLE);
    } finally {
      setLoading(false);
    }
  }, [market, symbol, timeframe, limit, demoMode, resolveAsset]);

  useEffect(() => { fetchData({}); }, []); // auto-run on load
  useEffect(() => {
    // discover Hyperliquid coins (core + xyz) for search + metadata card
    providerForMarket('hyperliquid').discover().then(setHlCoins).catch(() => {});
  }, []);
  useEffect(() => {
    // lazy-load the full Binance spot symbol list for crypto search
    if (market !== 'crypto' || binSyms || binLoading) return;
    setBinLoading(true);
    fetch('https://data-api.binance.vision/api/v3/exchangeInfo')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('exchangeInfo'))))
      .then((j) => {
        const syms = (j?.symbols || [])
          .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed)
          .map((s) => s.symbol);
        setBinSyms(syms);
      })
      .catch(() => setBinSyms([]))
      .finally(() => setBinLoading(false));
  }, [market, binSyms, binLoading]);

  const pickMarket = (m) => {
    const first = assetsForMarket(m)[0];
    setMarket(m);
    setSymbol(first.symbol);
    setQuery('');
    setCompared(null);
    setTimeout(() => fetchData({ market: m, symbol: first.symbol, asset: first }), 0);
  };
  const pickSymbol = (s) => {
    const a = resolveAsset(market, s);
    setSymbol(a.symbol);
    setCompared(null);
    setTimeout(() => fetchData({ symbol: a.symbol, asset: a }), 0);
  };
  const pickTf = (t) => {
    setTimeframe(t);
    setTimeout(() => fetchData({ timeframe: t }), 0);
  };

  // Build a loadable asset from a raw ticker typed into search.
  const buildCustom = (raw) => {
    const q = raw.trim();
    if (!q) return null;
    if (market === 'hyperliquid') {
      const ref = q.includes(':')
        ? q.split(':')[0].toLowerCase() + ':' + q.split(':').slice(1).join(':').toUpperCase()
        : q.toUpperCase();
      const sym = ref.includes(':') ? ref.split(':')[1] : ref;
      return { market, symbol: sym, name: `${sym} (Hyperliquid custom)`, ref, decimals: 3, extra: true, custom: true };
    }
    if (market === 'crypto') {
      const clean = q.toUpperCase().replace(/[\s/-]/g, '');
      const ref = /USDT|USDC|BTC$/.test(clean) ? clean : clean + 'USDT';
      const sym = ref.endsWith('USDT') ? ref.slice(0, -4) : ref;
      return { market, symbol: sym, name: `${sym} (Binance custom)`, ref, decimals: 4, extra: true, custom: true };
    }
    // forex / stocks / commodities → Yahoo ticker directly
    const yahoo = q.toUpperCase();
    return { market, symbol: yahoo, name: `${yahoo} (custom ticker)`, ref: q.toLowerCase(), yahoo, decimals: market === 'forex' ? 5 : 2, extra: true, custom: true };
  };

  const loadCustom = (raw) => {
    const a = buildCustom(raw);
    if (!a) return;
    setCustoms((prev) => (prev.some((x) => x.market === a.market && x.symbol === a.symbol) ? prev : [...prev, a]));
    setSymbol(a.symbol);
    setCompared(null);
    setTimeout(() => fetchData({ symbol: a.symbol, asset: a }), 0);
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
            <label className="lbl">🔍 Search every asset</label>
            <input
              type="text"
              placeholder={market === 'hyperliquid' ? 'Search 120+ coins — e.g. TSLA, xyz:PLTR, HYPE…' : market === 'crypto' ? 'Search Binance — e.g. PEPE, ONDO, ARB…' : 'Search or type any ticker — e.g. GOOGL, EURUSD=X…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  if (filtered.length > 0) pickSymbol(filtered[0].symbol);
                  else loadCustom(query);
                }
              }}
            />
            <p className="sub" style={{ margin: '6px 0' }}>
              {query.trim()
                ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} for “${query.trim()}”`
                : `${allOptions.length} assets available`
              }{market === 'crypto' ? (binSyms ? '' : binLoading ? ' · loading full Binance list…' : '') : market === 'hyperliquid' ? (hlCoins.length ? '' : ' · discovering Hyperliquid markets…') : ''}
              {allOptions.length > filtered.length && !query.trim() && ` · showing ${filtered.length} — search to narrow`}
            </p>
            <div className="asset-grid">
              {filtered.map((a) => (
                <button key={a.symbol + '|' + a.ref} className={symbol === a.symbol ? 'on chip' : 'chip'} style={symbol === a.symbol ? { background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', color: '#06101f', fontWeight: 800, border: 'none' } : {}} onClick={() => pickSymbol(a.symbol)} title={`${a.name} · feed ${a.yahoo || a.ref}`}>
                  {a.symbol}
                </button>
              ))}
              {filtered.length === 0 && <p className="sub">No match — check spelling or load it as a custom ticker below.</p>}
            </div>
            {query.trim() && !hasExact && (
              <button className="btn ghost" style={{ marginTop: 8, width: '100%' }} onClick={() => loadCustom(query)}>
                ➕ Load “{query.trim().toUpperCase()}” as custom {market === 'hyperliquid' ? 'Hyperliquid coin (tip: xyz:TSLA format for equities)' : market === 'crypto' ? 'Binance symbol' : 'Yahoo ticker'}
              </button>
            )}
            <p className="sub" style={{ marginTop: 10 }}>Tip: spaces and “/” are ignored — “op usdt”, “op/usdt” and “opusdt” all find OP.</p>
            <p className="sub" style={{ marginTop: 10 }}>{asset?.name} · feed <code>{asset?.yahoo || asset?.ref}</code></p>
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
            <div className="alert err">⚠️ <b>{error}</b><br />The provider could not supply this market/timeframe right now (network or rate-limit). Wait a few seconds and retry, try another timeframe, or run the clearly-labelled demo below.</div>
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

            <div className="seg" style={{ marginTop: 16 }}>
              <button className={view === 'lab' ? 'on' : ''} onClick={() => setView('lab')}>🔬 Lab view</button>
              <button className={view === 'learn' ? 'on' : ''} onClick={() => setView('learn')}>🎓 Teach me — beginner view</button>
            </div>

            {view === 'learn' ? (
              <LearnTab
                asset={asset} market={market} timeframe={timeframe} strategy={strategy}
                candles={candles} source={source} result={result} signal={signal}
                ict={ict} risk={risk} providerLabel={providerForMarket(market).label}
              />
            ) : (
            <>

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
          </>
        )}

        {/* HYPERLIQUID META */}
        <div className="card" style={{ marginTop: 16 }}>
          <h2>⚡ Hyperliquid adapter — Hyperliquid-only mode</h2>
          <p className="sub">Public market-data only (<code>POST https://api.hyperliquid.xyz/info</code> — <code>meta</code>, <code>allMids</code>, <code>candleSnapshot</code>). No wallet keys, no secrets, ever. Pick the <b>Hyperliquid</b> market tab above for a 100% Hyperliquid-only bench — now including <b>stocks (AAPL, NVDA, TSLA…), FX and gold/oil</b> via the HIP-3 <code>xyz</code> builder DEX (coins like <code>xyz:AAPL</code>). Note: xyz equity perps are 24/7 futures with shorter history than spot — use smaller candle counts on 1D/1W. {hlCoins.length > 0 ? `Discovered ${hlCoins.length} perp markets — showing first 14:` : 'Live discovery needs network access; the bench still works with the built-in list.'}</p>
          {hlCoins.length > 0 && (
            <div className="seg">{hlCoins.slice(0, 14).map((c) => (<span className="chip" key={c.dex + c.symbol}>{c.symbol} · {c.maxLeverage}×</span>))}</div>
          )}
        </div>

        <div className="card footer" style={{ marginTop: 16 }}>
          <b>🔬 How the lab works.</b> Indicators (SMA/EMA/RSI/MACD/Bollinger/ATR/Stochastic/Donchian/Supertrend/ADX) are computed locally from normalized OHLCV <code>{'{timestamp, open, high, low, close, volume}'}</code>.
          Strategies emit bar-close signals with no lookahead; the backtester sizes positions by <i>risk% ÷ ATR-stop distance</i>, deducts fees + slippage both sides, and enforces ATR stops, R-multiple targets and optional shorts.
          Confluence = bull-points ÷ (bull + bear) × 100 across trend, momentum, volatility, price-action and ICT checks — every point is listed above.
          <br /><br />
          Data: Crypto via <b>Binance Vision</b> spot klines · Hyperliquid via public <b>info</b> API · Forex/Stocks/Commodities via <b>Yahoo Finance</b> chart API (all timeframes; 4H resampled from 1H; fetched CORS-safe with proxy fallback, Stooq daily as last resort).
          Demo data is deterministic simulation and is always labelled <b>DEMO</b> — never presented as live.
          <br /><br />
          ⚠️ Educational software. Not financial advice. Hypothetical backtests do not guarantee future results. ·
          <a href="https://github.com/sunilkjt/backtest" target="_blank" rel="noreferrer">GitHub: sunilkjt/backtest</a> · Deploys to GitHub Pages at <code>/backtest/</code>.
        </div>
      </div>
    </div>
  );
}

function LearnTab({ asset, market, timeframe, strategy, candles, source, result, signal, ict, risk, providerLabel }) {
  const st = result.stats;
  const first = candles[0], last = candles[candles.length - 1];
  const periodMove = first && last ? ((last.close - first.close) / first.close) * 100 : 0;
  const topBull = signal.reasons.filter((r) => r.side === 'bull').slice(0, 3);
  const topBear = signal.reasons.filter((r) => r.side === 'bear').slice(0, 3);
  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>📖 What just happened? — your run, step by step</h2>
        <p className="sub">Read top to bottom. Each step feeds the next — that chain <i>is</i> the lab.</p>
        <div className="reason"><span className="dot neutral" /><div><b>1 · Downloaded {candles.length} {timeframe} candles of {asset.symbol}</b><p>From {providerLabel} ({source === 'live' ? 'real market data' : 'DEMO simulation — practice numbers, not the market'}). Each candle = open, high, low, close + volume. Over this window the price moved {periodMove >= 0 ? 'up' : 'down'} {Math.abs(periodMove).toFixed(2)}%.</p></div><span className="pts">data</span></div>
        <div className="reason"><span className="dot neutral" /><div><b>2 · Measured the market with 10 indicators</b><p>Trend (EMA/SMA/Supertrend/ADX), momentum (RSI/MACD/Stochastic) and volatility (Bollinger/ATR). Indicators don't predict — they describe what price already did, in numbers a rule can use.</p></div><span className="pts">measure</span></div>
        <div className="reason"><span className="dot neutral" /><div><b>3 · Ran “{strategy.name}” on every candle</b><p>{strategy.description} That produced <b>{st.trades} completed trades</b> on this window. A backtest is a replay: “if I had followed this rule bar by bar, what would have happened?”</p></div><span className="pts">replay</span></div>
        <div className="reason"><span className="dot neutral" /><div><b>4 · Subtracted real-world costs</b><p>{risk.feePct}% fee + {risk.slippagePct}% slippage per side, ATR ({risk.stopAtrMult}×) stop-loss and {risk.takeProfitRR}R take-profit on every trade. Costs are why the robot can be “right” and still lose money.</p></div><span className="pts">costs</span></div>
        <div className="reason"><span className={`dot ${signal.direction === 'BUY' ? 'bull' : signal.direction === 'SELL' ? 'bear' : 'neutral'}`} /><div><b>5 · Verdict: {signal.direction} ({signal.score}/100, {signal.confidence} confidence)</b><p>Bull points {signal.bull} vs bear points {signal.bear}. 60+ with a clear edge = BUY, 40− = SELL, otherwise HOLD. The score is just bull ÷ (bull + bear) — count the points in the Lab view.</p></div><span className="pts">{signal.score}</span></div>
      </div>

      {st.trades === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="alert">❓ <b>Why zero trades?</b> Nothing is broken — “{strategy.name}” simply never saw its setup in these {candles.length} candles (e.g. an SMA cross needs a slow 50/200 average cross, which can take months to occur). Try: another strategy (hit “Compare all”), a smaller timeframe, or more candles.</div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>❓ Why {st.trades} trades — is that a lot?</h2>
          <p className="sub">{st.trades > 80
            ? 'Yes, that is busy — this rule flips direction often on this timeframe. Every flip pays fees twice, so busy strategies need a high win rate to survive. Compare with a slower rule.'
            : st.trades > 20
              ? 'A healthy sample — enough trades to judge the rule, not so many that fees dominate. Check profit factor and max drawdown before trusting it.'
              : 'Only a few — each trade carries a lot of weight, so one lucky winner can flatter the result. Widen the candle count or try “Compare all” for context.'} Win rate {st.winRate.toFixed(1)}% · expectancy {money(st.expectancy)}/trade.</p>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
        <div className="card span6">
          <h2>⚖️ Why this signal, in plain words</h2>
          <p className="sub">The three strongest pushes on each side right now.</p>
          {topBull.map((r, i) => (<div className="reason" key={'b' + i}><span className="dot bull" /><div><b>{r.label}</b><p>{r.detail}</p></div><span className="pts">+{r.points}</span></div>))}
          {topBull.length === 0 && <p className="sub">No bullish evidence right now.</p>}
          {topBear.map((r, i) => (<div className="reason" key={'s' + i}><span className="dot bear" /><div><b>{r.label}</b><p>{r.detail}</p></div><span className="pts">+{r.points}</span></div>))}
          {topBear.length === 0 && <p className="sub">No bearish evidence right now.</p>}
          {ict && <p className="sub" style={{ marginTop: 8 }}>Smart-money read: <b>{ict.bias} ({ict.biasScore})</b> — {ict.zone}. Price sitting in premium/discount tells you whether buyers or sellers are paying up.</p>}
        </div>
        <div className="card span6">
          <h2>📊 Your numbers, translated</h2>
          <p className="sub">What each stat is really telling you.</p>
          <div className="kv"><span>Net {money(st.totalNet)} ({st.totalReturnPct.toFixed(2)}%)</span><span><b>{st.totalNet > 0 ? 'Rule made money here' : 'Rule lost money here'}</b></span></div>
          <div className="kv"><span>Win rate {st.winRate.toFixed(1)}%</span><span>Won {st.wins} of {st.trades} — below 50% can still profit if winners are bigger</span></div>
          <div className="kv"><span>Profit factor {fmtPF(st.profitFactor)}</span><span>{st.profitFactor > 1.5 ? 'Winners clearly outweigh losers' : st.profitFactor > 1 ? 'Barely ahead — fragile' : 'Losers outweigh winners'}</span></div>
          <div className="kv"><span>Max drawdown {st.maxDrawdownPct.toFixed(2)}%</span><span>Deepest dip from a peak — could you stomach that loss live?</span></div>
          <div className="kv"><span>Expectancy {money(st.expectancy)}</span><span>Average $ per trade — the “wage” of this rule</span></div>
          <div className="kv"><span>Sharpe {st.sharpe.toFixed(2)}</span><span>{st.sharpe > 1 ? 'Smooth ride for the return' : 'Bumpy ride — return came with volatility'}</span></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>🔎 When something looks wrong</h2>
        <p className="sub">The three confusions beginners hit most — including the search one.</p>
        <div className="reason"><span className="dot neutral" /><div><b>“I searched a coin and nothing backtested”</b><p>Almost always the search text, not the data: spaces and “/” are now ignored, so “op usdt”, “op/usdt” and “opusdt” all find OP. If a ticker truly isn't listed (e.g. a brand-new coin), use the ➕ custom button — Crypto adds USDT automatically, Hyperliquid equities need the <code>xyz:TSLA</code> format, Yahoo markets take any ticker like <code>GOOGL</code>.</p></div><span className="pts">search</span></div>
        <div className="reason"><span className="dot neutral" /><div><b>“Historical data unavailable”</b><p>The exchange didn't answer (rate-limit, network, or a market too young to have that timeframe). Wait 10 seconds and retry, switch timeframe, or use clearly-labelled DEMO data to keep learning.</p></div><span className="pts">data</span></div>
        <div className="reason"><span className="dot neutral" /><div><b>“Great backtest, but is it real?”</b><p>A backtest is a history exam, not a crystal ball: fees are estimates, big orders move real markets, and Hyperliquid xyz perps only exist since late 2025 (no 2020 history to test). Trust rules that win across strategies, timeframes and assets — then start tiny.</p></div><span className="pts">trust</span></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>📚 60-second glossary</h2>
        <p className="sub">The only words the Lab uses, in one line each.</p>
        <div className="tbl-wrap" style={{ maxHeight: 260 }}>
          <table><thead><tr><th>Word</th><th>Plain meaning</th></tr></thead><tbody>
            {[
              ['Candle', 'One period of trading: where price started, ended, and how far it roamed.'],
              ['Long / Short', 'Long profits when price rises; short profits when it falls.'],
              ['EMA / SMA', 'Average price over N candles — the market’s “recent consensus”. EMA reacts faster.'],
              ['RSI', '0–100 speedometer of momentum. Above 70 = stretched up, below 30 = washed out.'],
              ['MACD', 'Two averages pulling apart (trend pushing) or together (trend tiring).'],
              ['Bollinger Bands', 'A rubber band around price — tags outside it often snap back.'],
              ['ATR', 'Average candle size — the ruler we use to set stop-loss distance.'],
              ['Supertrend', 'A trailing line that flips green/red with the trend.'],
              ['BOS / CHOCH', 'Break of Structure / Change of Character — price broke its recent pattern.'],
              ['Order block', 'The last “calm” candle before a big push — big players may defend it.'],
              ['FVG (gap)', 'A price jump that left empty space — price often revisits it.'],
              ['Liquidity sweep', 'Price pokes past obvious highs/lows to trigger stops, then reverses.'],
              ['Drawdown', 'Biggest peak-to-trough fall — the pain you must survive.'],
              ['Profit factor', 'Gross wins ÷ gross losses. Above 1.5 = healthy, below 1 = losing.'],
              ['R-multiple', 'Win measured in “risks”: +2R means twice what you risked.'],
            ].map(([t, d]) => (<tr key={t}><td><b>{t}</b></td><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d}</td></tr>))}
          </tbody></table>
        </div>
      </div>
    </>
  );
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s/_.\-]/g, '');
}
function stripQuote(s) {
  return s.replace(/(usdt|usdc|fdusd|busd|tusd|dai|btc|eth|bnb)$/, '');
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
