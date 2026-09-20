import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Robot from './components/Robot.jsx';
import CandleChart, { OscillatorPanel, OverlayToggles, DEFAULT_OVERLAYS } from './components/CandleChart.jsx';
import EquityChart from './components/EquityChart.jsx';
import { MARKETS, TIMEFRAMES, ASSETS, assetsForMarket, hlCategory } from './lib/assets.js';
import { providerForMarket, UNAVAILABLE, StockProvider, guessStockYahoo } from './lib/providers.js';
import { computeAll } from './lib/indicators.js';
import { STRATEGIES, getStrategy, defaultsFor } from './lib/strategies.js';
import { runBacktest, compareSelected, walkForward, overfitWarnings, DEFAULT_RISK } from './lib/backtest.js';
import { analyzeICT } from './lib/ict.js';
import { buildSignal, DEFAULT_WEIGHTS } from './lib/signals.js';
import { detectRegime, tradeLevels, dayChange } from './lib/scores.js';
import { liquidationPrice, liqLabel, PERIODS_PER_YEAR } from './lib/riskModels.js';
import { generateDemoCandles } from './lib/demo.js';
import { tradesToCsv, signalsToCsv, strategyToJson, analysisReport, download, summaryText } from './lib/export.js';
import RiskCalc from './components/RiskCalc.jsx';
import MarketPicker from './components/MarketPicker.jsx';
import IctPanel from './components/IctPanel.jsx';
import TradesTable from './components/TradesTable.jsx';
import SignalsPage, { SignalHistory } from './components/SignalsPage.jsx';
import { logSignal, loadHistory, clearHistory, entryStatus } from './lib/history.js';

// Persisted user state (localStorage).
const LS_KEY = 'ai-trading-lab:v1';
function loadLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}

export default function App() {
  const ls = useMemo(loadLS, []);
  const [page, setPage] = useState(ls.page || 'lab');
  const [market, setMarket] = useState(ls.market || 'crypto');
  const [symbol, setSymbol] = useState(ls.symbol || 'BTC');
  const [timeframe, setTimeframe] = useState(ls.timeframe || '1h');
  const [strategyId, setStrategyId] = useState(ls.strategyId || 'ema-rsi');
  const [limit, setLimit] = useState(ls.limit || 300);
  const [risk, setRisk] = useState({ ...DEFAULT_RISK, ...(ls.risk || {}) });
  const [weights, setWeights] = useState(ls.weights || DEFAULT_WEIGHTS);
  const [overlays, setOverlays] = useState({ ...DEFAULT_OVERLAYS, ...(ls.overlays || {}) });
  const [showOsc, setShowOsc] = useState(ls.showOsc || { rsi: true, macd: false });
  const [favorites, setFavorites] = useState(ls.favorites || []);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [useFunding, setUseFunding] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [rawCandles, setRawCandles] = useState([]);
  const [funding, setFunding] = useState(null);
  const [source, setSource] = useState('live');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [price, setPrice] = useState(null);
  const [compared, setCompared] = useState(null);
  const [compareIds, setCompareIds] = useState(ls.compareIds || STRATEGIES.map((s) => s.id));
  const [sparamsById, setSparamsById] = useState(ls.sparamsById || {});
  const [gateRegime, setGateRegime] = useState(ls.gateRegime || false);
  const [sourceDetail, setSourceDetail] = useState('');
  const [wf, setWf] = useState(null);
  const [mtf, setMtf] = useState(null);
  const [mtfLoading, setMtfLoading] = useState(false);
  // Signals command-center state
  const [minConf, setMinConf] = useState(ls.minConf ?? 60);
  const [minRR, setMinRR] = useState(ls.minRR ?? 1.5);
  const [tz, setTz] = useState(ls.tz ?? 0);
  const [sizer, setSizer] = useState(ls.sizer || { balance: 10000, riskPct: 1, lev: 1 });
  const [history, setHistory] = useState(() => loadHistory());
  const [histFilter, setHistFilter] = useState('ALL');
  const [autoRefresh, setAutoRefresh] = useState('0');
  const [showTop, setShowTop] = useState(false);
  // Yahoo-fallback notice: set when a Hyperliquid stock request is served
  // from another source because the coin is not listed on HL (xyz or core).
  const [fallbackNote, setFallbackNote] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState('lab'); // 'lab' | 'learn' — separate beginner tab
  const [learnFromError, setLearnFromError] = useState(false);
  const [hlCoins, setHlCoins] = useState([]);
  const [hlLoading, setHlLoading] = useState(false);
  // (Re)discover Hyperliquid coins. Manual retry matters: if the first fetch
  // fails (offline at load, blocked API), xyz stocks silently vanish from
  // search until the user reloads — this lets them heal it in place.
  const rediscoverHL = useCallback(() => {
    setHlLoading(true);
    providerForMarket('hyperliquid').discover()
      .then((coins) => {
        if (coins?.length) {
          setHlCoins((prev) => {
            const seen = new Set(prev.map((c) => `${c.dex}|${c.symbol}`));
            return [...prev, ...coins.filter((c) => !seen.has(`${c.dex}|${c.symbol}`))];
          });
        }
      })
      .catch(() => {})
      .finally(() => setHlLoading(false));
  }, []);
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

  // Hyperliquid category filter: all | stocks | crypto | fx (FX + commodities + indices).
  const [hlFilter, setHlFilter] = useState('all');
  const filtered = useMemo(() => {
    // Hyperliquid lists 100+ xyz coins — never truncate them to the 80-chip
    // browsing cap used for Binance's hundreds.
    const cap = market === 'hyperliquid' ? 400 : 80;
    let list = allOptions;
    if (market === 'hyperliquid' && hlFilter !== 'all') {
      list = list.filter((a) => {
        const c = hlCategory(a);
        if (hlFilter === 'stocks') return c === 'stock';
        if (hlFilter === 'crypto') return c === 'crypto';
        return c === 'fx' || c === 'commodity' || c === 'index'; // 'fx'
      });
    }
    const q = norm(query);
    if (!q) return list.slice(0, cap);
    const base = stripQuote(q);
    return list.filter((a) => {
      const sym = norm(a.symbol), nm = norm(a.name), rf = norm(a.ref);
      if (sym.includes(q) || nm.includes(q) || rf.includes(q)) return true;
      // "op usdt" → base "op" should still find OP / OPUSDT
      return base.length >= 2 && (sym === base || sym.includes(base) || rf.includes(base));
    }).slice(0, cap);
  }, [allOptions, query, market, hlFilter]);

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

  // Persist workspace (favorites, strategies, prefs, risk config).
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        page, market, symbol, timeframe, strategyId, limit, risk, weights,
        overlays, showOsc, favorites, compareIds, sparamsById, gateRegime,
        minConf, minRR, tz, sizer
      }));
    } catch { /* storage full/blocked — lab still works */ }
  }, [page, market, symbol, timeframe, strategyId, limit, risk, weights, overlays, showOsc, favorites, compareIds, sparamsById, gateRegime, minConf, minRR, tz, sizer]);

  const tick = () => new Promise((r) => setTimeout(r, 30));

  const fetchData = useCallback(async (opts = {}) => {
    const m = opts.market ?? market;
    const sym = opts.symbol ?? symbol;
    const tf = opts.timeframe ?? timeframe;
    const lim = opts.limit ?? limit;
    const useDemo = opts.demoMode ?? demoMode;
    const riskNow = opts.risk ?? risk;
    const fundNow = opts.useFunding ?? useFunding;
    const a = resolveAsset(m, sym, opts.asset);
    if (!a) return;
    setLoading(true);
    setError('');
    setCompared(null);
    setWf(null);
    setMtf(null);
    setFocus(null);
    let data = null;
    try {
      if (useDemo) {
        setStage('Simulating demo candles…');
        await new Promise((r) => setTimeout(r, 350));
        data = generateDemoCandles(a.symbol, tf, lim);
        setRawCandles(data);
        setFunding(null);
        setFallbackNote('');
        setSourceDetail('Demo simulator (seeded random-walk)');
        setSource('demo');
        setPrice(null);
      } else {
        setStage(`Downloading ${a.symbol} ${tf} from ${providerForMarket(m).label}…`);
        await tick();
        const provider = providerForMarket(m);
        let fetched;
        let effectiveProvider = provider;
        let usedFallback = false;
        // Hyperliquid stock routing: bare-ticker "Yahoo fallback" assets try
        // Yahoo spot first with HL as backup; everything else tries
        // Hyperliquid first with Yahoo spot as backup. Either way the label
        // below always says which feed actually served the candles.
        const base = String(a.ref || '').includes(':') ? String(a.ref).split(':').slice(1).join(':') : a.symbol;
        const ySym = a.yahoo || (m === 'hyperliquid' ? guessStockYahoo(base) : null);
        // Order: bare-ticker Yahoo-fallback assets try Yahoo spot first (that
        // is what the user picked); everything else — including xyz: refs —
        // tries Hyperliquid first so a listed perp is never misrouted to spot.
        const hlFirst = !(m === 'hyperliquid' && ySym && a.fallback === 'yahoo' && !String(a.ref || '').includes(':'));
        let firstErr = null;
        const tryHl = async () => provider.getCandles({ symbol: a.symbol, ref: a.ref, yahoo: a.yahoo, timeframe: tf, limit: lim });
        const tryYahoo = async () => {
          const fb = new StockProvider();
          const rows = await fb.getCandles({ symbol: ySym, ref: ySym, yahoo: ySym, timeframe: tf, limit: lim });
          return { rows, fb };
        };
        if (m === 'hyperliquid' && ySym) {
          if (hlFirst) {
            try { fetched = await tryHl(); }
            catch (e) {
              firstErr = e;
              setStage(`${a.symbol} is not on Hyperliquid — trying Yahoo Finance…`);
              await tick();
              try {
                const r = await tryYahoo();
                fetched = r.rows; effectiveProvider = r.fb; usedFallback = true;
              } catch { throw firstErr; }
            }
          } else {
            try {
              const r = await tryYahoo();
              fetched = r.rows; effectiveProvider = r.fb; usedFallback = true;
            } catch (e) {
              firstErr = e;
              setStage(`Yahoo has no ${a.symbol} — trying Hyperliquid…`);
              await tick();
              try { fetched = await tryHl(); effectiveProvider = provider; usedFallback = false; }
              catch { throw firstErr; }
            }
          }
        } else {
          fetched = await tryHl();
        }
        data = fetched;
        if (usedFallback) {
          const via = effectiveProvider.lastSource ? ` (${effectiveProvider.lastSource})` : '';
          setSourceDetail(`Yahoo Finance fallback${via} — ${a.symbol} is not listed on Hyperliquid`);
          setFallbackNote(`${a.symbol} is not listed on Hyperliquid — showing Yahoo Finance spot data, not a perp.`);
        } else {
          setSourceDetail(provider.lastSource || provider.label);
          setFallbackNote('');
        }
        setStage('Calculating indicators…');
        await tick();
        setRawCandles(data);
        setStage('Detecting market structure…');
        await tick();
        // Perp funding (Hyperliquid only, opt-in): applied as a holding cost.
        if (fundNow && m === 'hyperliquid' && !usedFallback && provider.getFunding && data.length > 1) {
          try {
            const fr = await provider.getFunding({ ref: a.ref, startTime: data[0].timestamp, endTime: data[data.length - 1].timestamp });
            setFunding(fr);
          } catch { setFunding(null); }
        } else {
          setFunding(null);
        }
        setSource('live');
        effectiveProvider.getPrice({ symbol: a.symbol, ref: a.ref, yahoo: a.yahoo }).then(setPrice).catch(() => {});
      }
      setStage('Running backtest…');
      await tick();
      return data && data.length ? data : null;
    } catch (e) {
      setRawCandles([]);
      setFunding(null);
      setFallbackNote('');
      setSourceDetail('');
      setPrice(null);
      setError(e?.message || UNAVAILABLE);
      return null;
    } finally {
      setStage('');
      setLoading(false);
    }
  }, [market, symbol, timeframe, limit, demoMode, risk, useFunding, resolveAsset]);

  useEffect(() => { fetchData({}); }, []); // auto-run on load
  useEffect(() => {
    // Floating back-to-top arrow: appears after scrolling past one screen.
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    // discover Hyperliquid coins (core + xyz) for search + metadata card
    rediscoverHL();
  }, [rediscoverHL]);
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
    setHlFilter('all');
    setCompared(null);
    setTimeout(() => fetchData({ market: m, symbol: first.symbol, asset: first }), 0);
  };
  const pickSymbol = (s) => {
    const a = resolveAsset(market, s);
    setSymbol(a.symbol);
    setCompared(null);
    setTimeout(() => fetchData({ symbol: a.symbol, asset: a }), 0);
  };
  const loadFavorite = (fm, fs) => {
    const fa = knownAssets.find((x) => x.market === fm && x.symbol === fs) || assetsForMarket(fm).find((x) => x.symbol === fs);
    setMarket(fm); setSymbol(fs); setQuery(''); setCompared(null);
    setTimeout(() => fetchData({ market: fm, symbol: fs, asset: fa }), 0);
  };
  // Is this query listed on Hyperliquid (core coin or xyz HIP-3)? Checks the
  // live discovery plus the built-in bench — stocks only exist as xyz perps.
  const hyperliquidListed = (raw) => {
    const q = String(raw || '').trim().toUpperCase();
    if (!q) return false;
    const keys = new Set([q]);
    if (q.includes(':')) keys.add(q.split(':').slice(1).join(':'));
    else keys.add('XYZ:' + q);
    const coins = [...hlCoins, ...assetsForMarket('hyperliquid').map((a) => ({ symbol: a.symbol, ref: a.ref }))];
    return coins.some((c) => keys.has(String(c.symbol).toUpperCase()) || keys.has(String(c.ref).toUpperCase()));
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
      // Hyperliquid first: core coin or xyz HIP-3 listing → native perp asset.
      if (hyperliquidListed(ref) || hyperliquidListed(sym)) {
        return { market, symbol: sym, name: `${sym} (Hyperliquid)`, ref, decimals: 3, extra: true, custom: true };
      }
      // Not on Hyperliquid — stock-like tickers fall back to Yahoo spot.
      const ySym = guessStockYahoo(sym);
      if (ySym) {
        return { market, symbol: sym, name: `${sym} (Yahoo fallback — not on Hyperliquid)`, ref, yahoo: ySym, fallback: 'yahoo', decimals: 2, extra: true, custom: true };
      }
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

  // Shared props for the MarketPicker card (Lab tab + Signals tab).
  // customLabel overrides the custom-ticker button text when a Hyperliquid
  // stock query is not listed there and will fall back to Yahoo.
  const customLabel = (() => {
    const raw = query.trim();
    if (!raw || hasExact) return null;
    if (market === 'hyperliquid' && !hyperliquidListed(raw)) {
      const base = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
      if (guessStockYahoo(base)) return `➕ Load “${raw.toUpperCase()}” via Yahoo fallback (not on Hyperliquid)`;
    }
    return null;
  })();
  const marketProps = {
    markets: MARKETS, market, symbol, asset, query, setQuery, filtered, allOptions,
    hasExact, binSyms, binLoading, hlCoins, hlLoading, favorites, source, sourceDetail, customLabel,
    hlFilter, setHlFilter,
    onPickMarket: pickMarket, onPickSymbol: pickSymbol, onLoadCustom: loadCustom,
    onLoadFavorite: loadFavorite, onRemoveFavorite: (k) => setFavorites((prev) => prev.filter((x) => x !== k)),
    onRediscover: rediscoverHL
  };

  // Date-range window: all downstream math (indicators → backtest) uses this slice,
  // so chart indices, trades and equity always agree.
  const candles = useMemo(() => {
    const from = dateRange.from ? Date.parse(dateRange.from) : 0;
    const to = dateRange.to ? Date.parse(dateRange.to) + 864e5 - 1 : Infinity;
    if (!from && to === Infinity) return rawCandles;
    return rawCandles.filter((c) => c.timestamp >= from && c.timestamp <= to);
  }, [rawCandles, dateRange]);

  const riskEff = useMemo(() => ({
    ...risk, funding: useFunding ? funding : null,
    periodsPerYear: PERIODS_PER_YEAR[timeframe] || 252
  }), [risk, funding, useFunding, timeframe]);
  const ind = useMemo(() => (candles.length ? computeAll(candles) : null), [candles]);
  const ict = useMemo(() => (candles.length ? analyzeICT(candles) : null), [candles]);
  const regime = useMemo(() => (candles.length && ind ? detectRegime(candles, ind) : null), [candles, ind]);
  const signal = useMemo(
    () => (candles.length && ind ? buildSignal(candles, ind, ict, weights, { regime, gateRegime }) : null),
    [candles, ind, ict, weights, regime, gateRegime]
  );
  // Strategy params: user overrides merged over documented defaults.
  const strategy = getStrategy(strategyId);
  const sparams = useMemo(
    () => ({ ...defaultsFor(strategy), ...(sparamsById[strategyId] || {}) }),
    [strategy, strategyId, sparamsById]
  );
  const setParam = (key, val) => {
    setSparamsById((prev) => ({ ...prev, [strategyId]: { ...(prev[strategyId] || {}), [key]: val } }));
  };
  const resetParams = () => {
    setSparamsById((prev) => { const n = { ...prev }; delete n[strategyId]; return n; });
  };
  // Date-range presets: windows counted back from the last loaded candle.
  const applyRangePreset = (days) => {
    if (!rawCandles.length) return;
    if (!days) { setDateRange({ from: '', to: '' }); return; }
    const end = rawCandles[rawCandles.length - 1].timestamp;
    setDateRange({ from: isoDay(end - days * 864e5), to: isoDay(end) });
  };
  const activePreset = useMemo(() => {
    if (!rawCandles.length) return -1;
    if (!dateRange.from && !dateRange.to) return 0;
    const end = rawCandles[rawCandles.length - 1].timestamp;
    for (const d of [30, 90, 180, 365]) {
      if (dateRange.from === isoDay(end - d * 864e5) && dateRange.to === isoDay(end)) return d;
    }
    return -1;
  }, [rawCandles, dateRange]);
  const result = useMemo(
    () => (candles.length && ind ? runBacktest(candles, ind, strategyId, riskEff, sparams) : null),
    [candles, ind, strategyId, riskEff, sparams]
  );
  const lastClose = candles.length ? candles[candles.length - 1].close : null;
  const robotLine = useMemo(() => {
    if (error) return 'No candles came back — the classroom below explains why.';
    if (!signal) return 'Pick an asset and hit Fetch & Backtest.';
    if (signal.gated) return `Regime veto! ${regime?.label || 'The regime'} overrules — patience.`;
    const scored = signal.reasons.filter((r) => r.points > 0 && r.side !== 'neutral')
      .sort((a, b) => b.points - a.points)[0];
    if (signal.direction === 'BUY') return `Bullish here. ${scored ? scored.label + '.' : ''}`;
    if (signal.direction === 'SELL') return `Bearish here. ${scored ? scored.label + '.' : ''}`;
    return 'Mixed evidence — waiting is a position.';
  }, [signal, error, regime]);
  const levels = useMemo(
    () => (candles.length && ind && signal && signal.direction !== 'NEUTRAL'
      ? tradeLevels(candles, ind, ict, signal.direction, riskEff) : null),
    [candles, ind, ict, signal, riskEff]
  );
  const chg24 = useMemo(() => dayChange(candles), [candles]);
  const wfWarnings = useMemo(() => {
    if (!result) return [];
    const oos = wf?.oos?.stats || null;
    return overfitWarnings(result.stats, oos, riskEff);
  }, [result, wf, riskEff]);
  const ovTradesForChart = useMemo(() => (overlays.trades && result ? result.trades : []), [overlays.trades, result]);

  const runCompare = () => {
    if (!candles.length || !ind) return;
    const ids = compareIds.length ? compareIds : STRATEGIES.map((s) => s.id);
    const byId = {};
    for (const s of STRATEGIES) byId[s.id] = { ...defaultsFor(s), ...(sparamsById[s.id] || {}) };
    setCompared(compareSelected(candles, ind, ids, riskEff, byId));
  };

  const runWalkForward = () => {
    if (candles.length < 120 || !ind) return;
    setWf(walkForward(candles, strategyId, riskEff, 0.7, 200, sparams));
  };

  const runMtf = async () => {
    if (!asset) return;
    setMtfLoading(true);
    try {
      const tfs = ['5m', '15m', '1h', '4h', '1d'];
      const rows = [];
      for (const tf of tfs) {
        try {
          let data;
          if (source === 'demo') {
            data = generateDemoCandles(asset.symbol, tf, 220);
          } else {
            const provider = providerForMarket(market);
            data = await provider.getCandles({ symbol: asset.symbol, ref: asset.ref, yahoo: asset.yahoo, timeframe: tf, limit: 220 });
          }
          const ii = computeAll(data);
          const ic = analyzeICT(data);
          const sg = buildSignal(data, ii, ic, weights);
          rows.push({ tf, direction: sg.direction, score: sg.score, tech: sg.tech.score, ict: sg.ictS.score, ok: true });
        } catch {
          rows.push({ tf, ok: false });
        }
      }
      setMtf(rows);
    } finally {
      setMtfLoading(false);
    }
  };

  // Signals command center: explicit analysis run, logged to history.
  // Uses the SAME fetch + engines as the backtest view (no second engine).
  const analyzeMarket = useCallback(async () => {
    const data = await fetchData({});
    if (!data || !data.length) return;
    const ii = computeAll(data);
    const ic = analyzeICT(data);
    const rg = detectRegime(data, ii);
    const sg = buildSignal(data, ii, ic, weights, { regime: rg, gateRegime });
    const lv = sg.direction !== 'NEUTRAL' ? tradeLevels(data, ii, ic, sg.direction, { ...risk, funding: null }) : null;
    const entry = {
      t: Date.now(), asset: (resolveAsset(market, symbol) || {}).symbol || symbol,
      market, tf: timeframe, strategy: getStrategy(strategyId).name,
      signal: sg.direction, score: sg.score, price: data[data.length - 1].close,
      stop: lv ? lv.stop : null, dir: sg.direction === 'BUY' ? 1 : sg.direction === 'SELL' ? -1 : 0,
      status: sg.direction === 'NEUTRAL' ? 'NO TRADE' : 'ACTIVE'
    };
    setHistory(logSignal(entry));
    setLastUpdated(Date.now());
  }, [fetchData, market, symbol, timeframe, strategyId, weights, gateRegime, risk, resolveAsset]);

  const analyzeRef = useRef(analyzeMarket);
  analyzeRef.current = analyzeMarket;
  useEffect(() => {
    if (autoRefresh === '0' || page !== 'signals') return;
    const ms = Number(autoRefresh) * 60e3;
    if (!Number.isFinite(ms) || ms <= 0) return;
    const id = setInterval(() => { analyzeRef.current(); }, ms);
    return () => clearInterval(id);
  }, [autoRefresh, page]);

  const historyLive = useMemo(() => history.map((e) => ({
    ...e,
    liveStatus: entryStatus(e, e.asset === asset?.symbol && e.tf === timeframe ? lastClose : null)
  })), [history, asset, timeframe, lastClose]);

  const toggleFav = () => {    if (!asset) return;
    const key = market + '|' + asset.symbol;
    setFavorites((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const favKey = asset ? market + '|' + asset.symbol : '';
  const isFav = favorites.includes(favKey);

  const doExportCsv = () => {
    if (!result) return;
    download(`${asset.symbol}-${timeframe}-${strategyId}-trades.csv`, tradesToCsv(result.trades), 'text/csv');
  };
  const doExportSignals = () => {
    if (!signal) return;
    download(`${asset.symbol}-${timeframe}-signals.csv`, signalsToCsv(signal), 'text/csv');
  };
  const doExportStrategy = () => {
    download(`${strategyId}-strategy.json`, strategyToJson(
      { id: strategy.id, name: strategy.name, tagline: strategy.tagline, description: strategy.description, params: strategy.params, entry: strategy.entry, exit: strategy.exit },
      riskEff, weights
    ), 'application/json');
  };
  const doExportReport = () => {
    if (!result || !signal) return;
    download(`${asset.symbol}-${timeframe}-report.md`, analysisReport({
      asset: asset.symbol, market, timeframe, strategy: strategy.name,
      stats: result.stats, signal, tech: signal.tech, ictS: signal.ictS,
      regime: regime || { label: '—', detail: '' }, levels, source
    }), 'text/markdown');
  };
  const doExportJson = () => {
    if (!result) return;
    download(`${asset.symbol}-${timeframe}-${strategyId}-result.json`, JSON.stringify({
      asset: asset.symbol, market, timeframe, strategy: strategyId, source,
      risk: riskEff, weights, stats: result.stats, signal, trades: result.trades
    }, null, 2), 'application/json');
  };
  const doCopy = async () => {
    if (!result || !signal) return;
    const txt = summaryText({ asset: asset.symbol, market, timeframe, strategy: strategy.name, stats: result.stats, signal });
    try { await navigator.clipboard.writeText(txt); alert('Summary copied to clipboard ✓'); }
    catch { download('summary.txt', txt); }
  };

  // Top-level tabs: 'lab' (backtest workbench) or 'signals' (command center).
  // Anything else stored from older builds falls back to the lab.
  const activePage = page === 'signals' ? 'signals' : 'lab';

  return (
    <div className="stars">
      <div className="wrap">
        {/* HERO */}
        <header className="hero" id="home">
          <div className="robot-wrap" style={{ flexDirection: 'column', gap: 8 }}>
            <div className="speech" aria-live="polite">{robotLine}</div>
            <Robot mood={signal?.direction} />
          </div>
          <div>
            <h1>🤖 <span className="grad">AI Trading Lab</span></h1>
            <p className="tagline"><b>Test. Analyze. Understand. Trade Smarter.</b> — a browser laboratory that backtests real market data, explains every signal, and shows its work. No black boxes.</p>
            <div className="badges">
              <span className="badge">⚗️ {STRATEGIES.length} rule-based strategies</span>
              <span className="badge">📊 Real backtest engine</span>
              <span className="badge">🧠 ICT / SMC lab</span>
              <span className={source === 'live' ? 'badge live' : 'badge demo'}>{source === 'live' ? '● LIVE market data' : '● DEMO · simulated data'}</span>
              {fallbackNote && <span className="badge demo" title={fallbackNote}>💱 Yahoo fallback</span>}
              {asset && <span className="badge">🔗 {providerForMarket(market).label}</span>}
              {regime && candles.length > 0 && <span className="badge">{regime.emoji} {regime.label}</span>}
            </div>
            <div className="price-pill">
              <span className="pulse" />
              <b>{asset?.symbol} / {timeframe}</b>
              <span>{lastClose != null ? fmtPrice(lastClose, asset?.decimals) : '—'}</span>
              {chg24 != null && (
                <span style={{ color: chg24 >= 0 ? '#34d399' : '#fb7185', fontWeight: 800 }}>
                  {chg24 >= 0 ? '▲' : '▼'} {Math.abs(chg24).toFixed(2)}% / 24h
                </span>
              )}
              {price != null && source === 'live' && <span style={{ color: '#9aa6d0' }}>· live {fmtPrice(price, asset?.decimals)}</span>}
              {candles.length > 0 && <span style={{ color: '#9aa6d0' }}>· {candles.length} candles</span>}
              <button className="chip" onClick={toggleFav} title="Save to favorites (persisted)" style={{ marginLeft: 4 }}>{isFav ? '★ Fav' : '☆ Fav'}</button>
            </div>
          </div>
        </header>

        <TopNav page={activePage} setPage={setPage} />

        {activePage === 'signals' ? (
          <SignalsPage
            asset={asset} market={market} timeframe={timeframe}
            strategy={strategy} strategies={STRATEGIES} strategyId={strategyId} setStrategyId={setStrategyId}
            candles={candles} ind={ind} ict={ict} signal={signal} regime={regime} levels={levels}
            source={source} riskEff={riskEff} weights={weights}
            mtf={mtf} mtfLoading={mtfLoading} runMtf={runMtf}
            providerLabel={providerForMarket(market).label}
            onAnalyze={analyzeMarket} analyzing={loading} lastUpdated={lastUpdated}
            autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
            minConf={minConf} setMinConf={setMinConf} minRR={minRR} setMinRR={setMinRR}
            tz={tz} setTz={setTz} sizer={sizer} setSizer={setSizer}
            history={historyLive} histFilter={histFilter} setHistFilter={setHistFilter}
            onClearHistory={() => setHistory(clearHistory())}
            focus={focus} setFocus={setFocus} overlays={overlays}
            lastClose={lastClose} error={error} marketProps={marketProps}
            fallbackNote={fallbackNote} timeframes={TIMEFRAMES} onPickTimeframe={pickTf}
          />
        ) : (
        <>
        {/* CONTROL DECK */}
        <div className="grid deck" id="markets">
          <div className="card span4">
            <h2>1️⃣ Market & Asset</h2>
            <p className="sub">Pick a laboratory bench. Hyperliquid serves perps; others serve spot / cash.</p>
            <MarketPicker {...marketProps} />
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
            <div className="kv"><span>Entry</span><span style={{ textAlign: 'right', maxWidth: '65%' }}>{strategy.entry}</span></div>
            <div className="kv"><span>Exit</span><span style={{ textAlign: 'right', maxWidth: '65%' }}>{strategy.exit}</span></div>
            {(strategy.params || []).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <label className="lbl">Strategy parameters (live — backtest updates instantly)</label>
                {strategy.params.map((p) => (
                  <div className="kv" key={p.key}>
                    <span>{p.label}</span>
                    <span><input
                      type="number" min={p.min} max={p.max} step={p.step}
                      value={sparams[p.key] ?? p.def}
                      style={{ width: 90, padding: '6px 8px' }}
                      onChange={(e) => {
                        let v = Number(e.target.value);
                        if (!Number.isFinite(v)) v = p.def;
                        v = Math.min(p.max, Math.max(p.min, v));
                        setParam(p.key, v);
                      }}
                    /></span>
                  </div>
                ))}
                <div className="toolbar"><button className="btn ghost" onClick={resetParams}>Reset to defaults</button></div>
              </div>
            )}
            <label className="lbl">Candles (50–1000)</label>
            <input type="range" min={50} max={1000} step={10} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            <div className="kv"><span>History length</span><span><b>{limit}</b> candles</span></div>
            <label className="lbl">📅 Date range (optional backtest window)</label>
            <div className="date-bar">
              <div className="date-presets">
                {[['All', 0], ['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365]].map(([label, days]) => (
                  <button key={label} className={activePreset === days ? 'on' : ''} onClick={() => applyRangePreset(days)} disabled={!rawCandles.length} title={days ? `Last ${label} of loaded candles` : 'Use the full loaded history'}>{label}</button>
                ))}
              </div>
              <div className="date-fields">
                <div><span className="df-lbl">🗓 From</span><input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} /></div>
                <div><span className="df-lbl">🗓 To</span><input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} /></div>
              </div>
              <div className="date-meta">
                <span className="in-window">📌 <b>{candles.length}</b> candles in window</span>
                {(dateRange.from || dateRange.to) && (
                  <button className="date-clear" onClick={() => setDateRange({ from: '', to: '' })}>✕ Clear</button>
                )}
              </div>
            </div>
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
            <div className="row2">
              <div><label className="lbl">Leverage (×)</label><input type="number" step="1" min="1" max="50" value={risk.leverage || 1} onChange={(e) => setRisk({ ...risk, leverage: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} /></div>
              <div><label className="lbl">Score: technical %</label><input type="number" step="5" min="0" max="100" value={weights.technical} onChange={(e) => { const t = Math.min(100, Math.max(0, Number(e.target.value) || 60)); setWeights({ technical: t, ict: 100 - t }); }} /></div>
            </div>
            <div className="seg" style={{ marginTop: 8 }}>
              {[['Balanced', 60], ['Technical', 80], ['ICT-led', 25]].map(([name, t]) => (
                <button key={name} className={weights.technical === t ? 'on chip' : 'chip'} onClick={() => setWeights({ technical: t, ict: 100 - t })}>{name} {t}/{100 - t}</button>
              ))}
            </div>
            <label className="toggle"><input type="checkbox" checked={gateRegime} onChange={(e) => setGateRegime(e.target.checked)} /> Regime gate: veto signals that fight the {regime ? `${regime.emoji} ${regime.label}` : 'market'} regime</label>
            <label className="toggle"><input type="checkbox" checked={risk.allowShort} onChange={(e) => setRisk({ ...risk, allowShort: e.target.checked })} /> Allow short positions</label>
            <label className="toggle"><input type="checkbox" checked={useFunding} onChange={(e) => { setUseFunding(e.target.checked); setTimeout(() => fetchData({ useFunding: e.target.checked }), 0); }} /> Apply Hyperliquid perp funding as holding cost</label>
            <label className="toggle"><input type="checkbox" checked={demoMode} onChange={(e) => { setDemoMode(e.target.checked); setTimeout(() => fetchData({ demoMode: e.target.checked }), 0); }} /> Use clearly-labelled <b>&nbsp;demo data&nbsp;</b> (offline / testing)</label>
            <div className="toolbar">
              <button className="btn" disabled={loading} onClick={() => fetchData({})}>{loading ? '⚗️ Brewing data…' : '🧪 Fetch & Backtest'}</button>
              <button className="btn ghost" onClick={runCompare} disabled={!candles.length}>⚔️ Compare selected</button>
            </div>
          </div>
        </div>

        {/* STATUS */}
        {loading && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="loading-robot"><span className="spin" /> {stage || `The robot is pipetting ${asset?.symbol} ${timeframe} candles…`}</div>
          </div>
        )}
        {error && !loading && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert err">⚠️ <b>{error}</b><br />The provider could not supply this market/timeframe right now (network or rate-limit). Wait a few seconds and retry, try another timeframe, or run the clearly-labelled demo below.</div>
            <div className="toolbar">
              <button className="btn pink" onClick={() => { setDemoMode(true); fetchData({ demoMode: true }); }}>🎭 Load DEMO (simulated) data</button>
              <button className="btn ghost" onClick={() => { setTimeframe('1d'); fetchData({ timeframe: '1d', demoMode: false }); }}>Try 1D live data</button>
              <button className="btn ghost" onClick={() => { setView('learn'); setLearnFromError(true); }}>🎓 Explain what went wrong</button>
            </div>
          </div>
        )}
        {source === 'demo' && candles.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert">🎭 <b>DEMO · simulated data in use</b> — deterministic random-walk for testing the lab offline. NOT live market data. Toggle it off in the Risk Lab card to retry live providers.</div>
          </div>
        )}
        {fallbackNote && source === 'live' && candles.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert">💱 <b>Yahoo Finance fallback in use</b> — {fallbackNote}</div>
          </div>
        )}

        {/* RESULTS (or the classroom when data failed but the user asked why) */}
        {!loading && ((signal && result && !error) || (error && view === 'learn')) && (
          <>
            <div className="seg" style={{ marginTop: 16 }} id="results">
              <button className={view === 'lab' ? 'on' : ''} onClick={() => setView('lab')}>🔬 Lab view</button>
              <button className={view === 'learn' ? 'on' : ''} onClick={() => setView('learn')}>🎓 Teach me — beginner view</button>
            </div>

            {view === 'learn' ? (
              <LearnTab
                asset={asset} market={market} timeframe={timeframe} strategy={strategy}
                candles={candles} source={source} result={result} signal={signal}
                ict={ict} risk={risk} providerLabel={providerForMarket(market).label}
                error={error} learnFromError={learnFromError}
              />
            ) : (
            <>

            <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
              <div className="card span8" id="chart">
                <h2>📈 Price Lab — trades on chart</h2>
                <p className="sub">{candles.length} candles · toggle every overlay · ENTRY/SL/TP from SignalBot</p>
                <CandleChart candles={candles} ind={ind} trades={ovTradesForChart} ict={ict} overlays={overlays} levels={levels} />
                <OverlayToggles value={overlays} onChange={setOverlays} />
                {ind?.atr && (
                  <p className="sub" style={{ marginTop: 8 }}>
                    ATR {fmtPrice(ind.atr[candles.length - 1] ?? NaN, asset.decimals)} ({(((ind.atr[candles.length - 1] ?? 0) / (lastClose || 1)) * 100).toFixed(2)}% of price)
                    {ict?.session && (<span> · session: <b>{ict.session.name}{ict.session.killzone ? ' ⚡ killzone' : ''}</b></span>)}
                    {ict?.prevDay && (<span> · PDH {fmtPrice(ict.prevDay.high, asset.decimals)} / PDL {fmtPrice(ict.prevDay.low, asset.decimals)}</span>)}
                  </p>
                )}
                <div className="seg" style={{ marginTop: 8 }}>
                  <button className={showOsc.rsi ? 'on chip' : 'chip'} onClick={() => setShowOsc({ ...showOsc, rsi: !showOsc.rsi })}>{showOsc.rsi ? '☑' : '☐'} RSI panel</button>
                  <button className={showOsc.macd ? 'on chip' : 'chip'} onClick={() => setShowOsc({ ...showOsc, macd: !showOsc.macd })}>{showOsc.macd ? '☑' : '☐'} MACD panel</button>
                </div>
                {showOsc.rsi && <OscillatorPanel candles={candles} lines={[{ data: ind.rsi, color: '#a78bfa' }]} bands={[30, 50, 70]} title="RSI (14) — below 30 oversold, above 70 overbought" />}
                {showOsc.macd && <OscillatorPanel candles={candles} lines={[{ data: ind.macdLine, color: '#22d3ee' }, { data: ind.signalLine, color: '#f472b6' }]} hist={ind.hist} title="MACD (12, 26, 9) — line vs signal + histogram" />}
              </div>
              <div className="card span4" id="backtest">
                <h2>💰 Performance</h2>
                <p className="sub">Fees + slippage{useFunding && funding ? ' + funding' : ''} included · ATR ({risk.stopAtrMult}×) stops · {risk.takeProfitRR}R targets · {risk.leverage || 1}× leverage</p>
                <div className="stats">
                  <Stat k="Initial → Final" v={`${money(risk.initialCapital)} → ${money(result.stats.finalEquity)}`} c="flat" />
                  <Stat k="Net P&L" v={`${money(result.stats.totalNet)}`} c={result.stats.totalNet > 0 ? 'good' : result.stats.totalNet < 0 ? 'bad' : 'flat'} />
                  <Stat k="Return" v={`${result.stats.totalReturnPct.toFixed(2)}%`} c={result.stats.totalReturnPct > 0 ? 'good' : result.stats.totalReturnPct < 0 ? 'bad' : 'flat'} />
                  <Stat k="Win / Loss rate" v={`${result.stats.winRate.toFixed(1)}% / ${result.stats.lossRate.toFixed(1)}%`} c="flat" />
                  <Stat k="Profit factor" v={fmtPF(result.stats.profitFactor)} c={result.stats.profitFactor > 1.5 ? 'good' : result.stats.profitFactor < 1 ? 'bad' : 'flat'} />
                  <Stat k="Max drawdown" v={`${result.stats.maxDrawdownPct.toFixed(2)}%`} c={result.stats.maxDrawdownPct > 20 ? 'bad' : 'flat'} />
                  <Stat k="Sharpe-like" v={result.stats.sharpe.toFixed(2)} c={result.stats.sharpe > 1 ? 'good' : 'flat'} />
                  <Stat k="Trades" v={result.stats.trades} c="flat" />
                  <Stat k="Expectancy" v={money(result.stats.expectancy)} c={result.stats.expectancy > 0 ? 'good' : 'bad'} />
                  <Stat k="Avg win / loss" v={`${money(result.stats.avgWin)} / ${money(result.stats.avgLoss)}`} c="flat" />
                  <Stat k="Largest win / loss" v={`${money(result.stats.largestWin)} / ${money(result.stats.largestLoss)}`} c="flat" />
                  <Stat k="Avg hold" v={`${result.stats.avgBars.toFixed(1)} bars`} c="flat" />
                </div>
                <p className="sub" style={{ marginTop: 6 }}>Sharpe-like = mean/std of per-{timeframe} equity returns, annualized ×√(bars/year) — rough across regimes, best used for ranking strategies, not as gospel.</p>
                {wfWarnings.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {wfWarnings.map((w, i) => (
                      <div key={i} className="alert" style={w.level === 'high' ? { borderColor: 'rgba(251,113,133,.5)', background: 'rgba(251,113,133,.1)', marginBottom: 6 } : { marginBottom: 6 }}>
                        {w.level === 'high' ? '⚠️ Possible Overfitting' : '⚠️ Caution'} — {w.text}
                      </div>
                    ))}
                  </div>
                )}
                <h2 style={{ marginTop: 14 }}>Equity curve</h2>
                <EquityChart equity={result.equity} initial={risk.initialCapital} trades={result.trades} />
                <div className="toolbar">
                  <button className="btn ghost" onClick={doExportCsv}>⬇ Trades CSV</button>
                  <button className="btn ghost" onClick={doExportSignals}>⬇ Signals CSV</button>
                  <button className="btn ghost" onClick={doExportStrategy}>⬇ Strategy JSON</button>
                  <button className="btn ghost" onClick={doExportReport}>⬇ Report</button>
                  <button className="btn ghost" onClick={doCopy}>📋 Copy summary</button>
                </div>
                <h2 style={{ marginTop: 14 }}>🔁 Walk-forward (70/30)</h2>
                <p className="sub">Train on the first 70%, test on the last 30% (indicators recomputed per side — no peeking). Out-of-sample restarts from the same starting capital for a clean comparison.</p>
                {!wf && <button className="btn ghost" onClick={runWalkForward} disabled={candles.length < 120}>Run walk-forward</button>}
                {wf && (
                  <div>
                    <div className="kv"><span>{wf.is.label}</span><span className={wf.is.stats.totalNet > 0 ? 'pos' : 'neg'}><b>{money(wf.is.stats.totalNet)} ({wf.is.stats.totalReturnPct.toFixed(1)}%)</b></span></div>
                    <div className="kv"><span>{wf.oos.label}</span><span className={wf.oos.stats.totalNet > 0 ? 'pos' : 'neg'}><b>{money(wf.oos.stats.totalNet)} ({wf.oos.stats.totalReturnPct.toFixed(1)}%)</b></span></div>
                    <div className="kv"><span>OOS trades / win%</span><span><b>{wf.oos.stats.trades} / {wf.oos.stats.winRate.toFixed(1)}%</b></span></div>
                    <div className="kv"><span>OOS start → end equity</span><span><b>{money(wf.oos.startEquity)} → {money(wf.oos.endEquity)}</b></span></div>
                    <div className="kv"><span>OOS max drawdown / PF</span><span><b>{wf.oos.stats.maxDrawdownPct.toFixed(1)}% / {fmtPF(wf.oos.stats.profitFactor)}</b></span></div>
                  </div>
                )}
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
                <IctPanel ict={ict} candles={candles} asset={asset} />
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <TradesTable trades={result.trades} decimals={asset.decimals} />
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h2>⚔️ Strategy Colosseum — tick strategies, run on the same data</h2>
              <p className="sub">Measured results only — the table never crowns a “best”. Same candles, same risk.</p>
              <div className="seg" style={{ marginBottom: 10 }}>
                {STRATEGIES.map((s) => (
                  <button key={s.id} className={compareIds.includes(s.id) ? 'on chip' : 'chip'} onClick={() => setCompareIds((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))} title={s.tagline}>
                    {compareIds.includes(s.id) ? '☑' : '☐'} {s.name}
                  </button>
                ))}
              </div>
              {!compared && <button className="btn" onClick={runCompare}>⚔️ Run {compareIds.length || STRATEGIES.length} selected</button>}
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

            <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
              <div className="card span6">
                <h2>🕐 Multi-timeframe {asset.symbol}</h2>
                <p className="sub">Same engine, four timeframes. Never force a signal on conflict.</p>
                {!mtf && <button className="btn ghost" onClick={runMtf} disabled={mtfLoading}>{mtfLoading ? 'Scanning…' : 'Scan 15M / 1H / 4H / 1D'}</button>}
                {mtf && (
                  <div>
                    <div className="tbl-wrap" style={{ maxHeight: 220 }}>
                      <table>
                        <thead><tr><th>TF</th><th>Bias</th><th>Score</th><th>Tech</th><th>ICT</th></tr></thead>
                        <tbody>
                          {mtf.map((r) => (
                            <tr key={r.tf}>
                              <td><b>{r.tf}</b></td>
                              {r.ok ? (
                                <>
                                  <td>{r.direction === 'BUY' ? '🟢 Bullish' : r.direction === 'SELL' ? '🔴 Bearish' : '🟡 Neutral'}</td>
                                  <td>{r.score}</td><td>{r.tech}</td><td>{r.ict}</td>
                                </>
                              ) : (<td colSpan={4}>unavailable</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(() => {
                      const dirs = [...new Set(mtf.filter((r) => r.ok).map((r) => r.direction))];
                      return dirs.length > 1
                        ? (<div className="alert" style={{ marginTop: 8 }}>⚠️ <b>Multi-timeframe conflict detected</b> ({dirs.join(' / ')}) — stand down unless your rules define which timeframe leads.</div>)
                        : (<p className="sub" style={{ marginTop: 8 }}>✅ Timeframes agree: <b>{dirs[0] || '—'}</b></p>);
                    })()}
                  </div>
                )}
              </div>
              <div className="card span6">
                <RiskCalc asset={asset} levels={levels} lastClose={lastClose} balance={risk.initialCapital} model={risk.liquidationModel} onModel={(m) => setRisk({ ...risk, liquidationModel: m })} />
              </div>
            </div>
              </>
            )}
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
        <nav className="bottomnav" aria-label="Primary">
          <a href="#home">🏠<span>Home</span></a>
          <a href="#markets">💱<span>Markets</span></a>
          <a href="#backtest">🧪<span>Backtest</span></a>
          <button onClick={() => { setPage('signals'); window.scrollTo({ top: 0 }); }}>🎯<span>Signals</span></button>
          <button onClick={() => { setView('learn'); setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 60); }}>🎓<span>Learn</span></button>
        </nav>
        <button
          className={`to-top${showTop ? ' show' : ''}`}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
          title="Back to top"
        >↑</button>
      </div>
    </div>
  );
}

function LearnTab({ asset, market, timeframe, strategy, candles, source, result, signal, ict, risk, providerLabel, error, learnFromError }) {
  // Classroom mode when the fetch itself failed: explain THIS error, then static lessons.
  if (!result || !signal || !candles.length) {
    return (
      <>
        {error && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="alert err">🔌 <b>Why “{error}” happened on {asset?.symbol} {timeframe}</b><br />
              Your browser asked {providerLabel} for candles and got no usable answer. Usual culprits: a rate-limit (too many clicks too fast), the network/proxy hiccuping (Yahoo has no CORS headers, so we hop through a public proxy that sometimes returns 520), or a market too young for this timeframe (Hyperliquid xyz perps start late-2025). Fixes in order: wait 10 seconds → Retry · switch timeframe · load clearly-labelled DEMO data. Nothing was backtested — the lab refuses to invent candles.</div>
          </div>
        )}
        <StaticHelp />
      </>
    );
  }
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

      <StaticHelp />
    </>
  );
}

function StaticHelp() {
  return (
    <>
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
              ['Leverage', 'Borrowed size: 5× turns 1% into 5% — and moves liquidation 5× closer.'],
              ['Liquidation', 'Forced closure when losses eat your margin. Wider stops need lower leverage.'],
              ['Slippage', 'The gap between the price you saw and the fill you got. Fast markets slip more.'],
              ['Funding rate', 'Hourly fee longs pay shorts (or reverse) on perps to pin price to spot.'],
              ['Market regime', 'What kind of market it is (trend vs chop) — tactics must match the regime.'],
              ['Confluence', 'Independent reasons agreeing. More agreement, more confidence — never a win %.'],
              ['In / out-of-sample', 'Test on one slice, verify on another untouched slice. Edges must travel.'],
              ['Overfitting', 'A rule tuned so tightly to the past it memorized noise instead of signal.'],
              ['Look-ahead bias', 'Cheating by using future candles. This lab only ever uses data up to bar i.'],
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
function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
function stripQuote(s) {
  return s.replace(/(usdt|usdc|fdusd|busd|tusd|dai|btc|eth|bnb)$/, '');
}

function Stat({ k, v, c }) {
  return (<div className="stat"><div className="k">{k}</div><div className={`v ${c || 'flat'}`}>{v}</div></div>);
}

const NAV = [
  ['lab', '🧪', 'Lab'],
  ['signals', '🎯', 'Signals']
];

function TopNav({ page, setPage }) {
  return (
    <nav className="topnav" aria-label="Sections">
      {NAV.map(([id, icon, label]) => (
        <button key={id} className={page === id ? 'on' : ''} onClick={() => { setPage(id); window.scrollTo({ top: 0 }); }}>
          <span className="ni">{icon}</span><span className="nl">{label}</span>
        </button>
      ))}
    </nav>
  );
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
