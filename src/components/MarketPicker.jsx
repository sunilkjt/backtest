// Shared Market & Asset picker (card body). Rendered in the Lab tab and in
// the Signals tab so both can search every asset. All state lives in App;
// this component only renders controls.

export default function MarketPicker(props) {
  const {
    markets, market, symbol, asset, query, setQuery, filtered, allOptions,
    hasExact, binSyms, binLoading, hlCoins, hlLoading, favorites, source, sourceDetail, customLabel,
    hlFilter, setHlFilter,
    onPickMarket, onPickSymbol, onLoadCustom, onLoadFavorite, onRemoveFavorite, onRediscover
  } = props;
  return (
    <>
      <div className="seg market-seg">
        {markets.map((m) => (
          <button key={m.id} className={market === m.id ? 'on' : ''} onClick={() => onPickMarket(m.id)} title={m.label}><span className="mi">{m.icon}</span><span>{m.label}</span></button>
        ))}
      </div>
      {market === 'hyperliquid' && (
        <div className="seg" style={{ marginBottom: 8 }}>
          {[['all', '🌐 All'], ['stocks', '📈 Stocks'], ['crypto', '🪙 Crypto'], ['fx', '💱 FX · Commodities · Index']].map(([id, label]) => (
            <button key={id} className={hlFilter === id ? 'on chip' : 'chip'} onClick={() => setHlFilter(id)} title={id === 'stocks' ? 'Every xyz equity perp' : label}>{label}</button>
          ))}
        </div>
      )}
      <label className="lbl">🔍 Search every asset</label>
      <div className="asset-search">
        <span className="si">🔍</span>
        <input
          type="text"
          placeholder={market === 'hyperliquid' ? 'Search 120+ coins — e.g. TSLA, xyz:PLTR, HYPE…' : market === 'crypto' ? 'Search Binance — e.g. PEPE, ONDO, ARB…' : 'Search or type any ticker — e.g. GOOGL, EURUSD=X…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              if (filtered.length > 0) onPickSymbol(filtered[0].symbol);
              else onLoadCustom(query);
            }
          }}
        />
      </div>
      <p className="asset-count">
        <span className="pill">{query.trim() ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${allOptions.length} assets`}</span>
        <span>{query.trim()
          ? `for “${query.trim()}”`
          : 'available'
        }{market === 'crypto' ? (binSyms ? '' : binLoading ? ' · loading full Binance list…' : '') : market === 'hyperliquid' ? (hlCoins.length ? '' : ' · discovering Hyperliquid markets…') : ''}
        {allOptions.length > filtered.length && !query.trim() && ` · showing ${filtered.length} — search to narrow`}</span>
      </p>
      <div className="asset-grid">
        {filtered.map((a) => (
          <button key={a.symbol + '|' + a.ref} className={symbol === a.symbol ? 'on chip' : 'chip'} onClick={() => onPickSymbol(a.symbol)} title={`${a.name} · feed ${a.yahoo || a.ref}`}>
            {a.symbol}
          </button>
        ))}
        {filtered.length === 0 && <p className="sub asset-empty">No match — check spelling or load it as a custom ticker below.</p>}
      </div>
      {query.trim() && !hasExact && (
        <button className="btn ghost" style={{ marginTop: 8, width: '100%' }} onClick={() => onLoadCustom(query)}>
          {customLabel || (<>➕ Load “{query.trim().toUpperCase()}” as custom {market === 'hyperliquid' ? 'Hyperliquid coin (tip: xyz:TSLA format for equities)' : market === 'crypto' ? 'Binance symbol' : 'Yahoo ticker'}</>)}
        </button>
      )}
      {market === 'hyperliquid' && hlCoins.length === 0 && (
        <button className="btn ghost" style={{ marginTop: 8, width: '100%' }} onClick={onRediscover} disabled={hlLoading} title="Stocks live on the Hyperliquid xyz list — refetch it">
          {hlLoading ? '⚡ Discovering Hyperliquid markets…' : '↻ Hyperliquid list missing — retry (stocks live here)'}
        </button>
      )}
      <p className="sub" style={{ marginTop: 10 }}>Tip: spaces and “/” are ignored — “op usdt”, “op/usdt” and “opusdt” all find OP.</p>
      {favorites.length > 0 && (
        <div>
          <label className="lbl">★ Favorites (saved on this device)</label>
          <div className="seg">
            {favorites.map((k) => {
              const [fm, fs] = k.split('|');
              return (<span key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <button className="chip" title={`Load ${fs} on ${fm}`} onClick={() => onLoadFavorite(fm, fs)}>{fm === market && fs === symbol ? '● ' : ''}{fs}</button>
                <button className="chip" title={`Remove ${fs} from favorites`} onClick={() => onRemoveFavorite(k)} style={{ padding: '8px 9px' }}>✕</button>
              </span>);
            })}
          </div>
        </div>
      )}
      <p className="sub" style={{ marginTop: 10 }}>{asset?.name} · feed <code>{asset?.yahoo || asset?.ref}</code>{sourceDetail && source === 'live' && (<span> · via {sourceDetail}</span>)}</p>
    </>
  );
}
