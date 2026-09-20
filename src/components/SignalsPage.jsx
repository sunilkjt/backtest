import { useMemo } from 'react';
import CandleChart from './CandleChart.jsx';
import IctPanel from './IctPanel.jsx';
import MarketPicker from './MarketPicker.jsx';
import {
  categoryBreakdown, setupStrength, computePools, liquidityMap,
  sessionInfo, sizeFor, buildTradePlan, whyWait, assessSetup
} from '../lib/setup.js';
import { causalFor, stateAt } from '../lib/ictEngine.js';

function fmtP(p, d = 2) {
  if (p == null || !Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function money(v) {
  const s = v < 0 ? '−$' : '$';
  return s + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function SignalsPage(props) {
  const {
    asset, market, timeframe, strategy, strategyId, setStrategyId, candles, ind, ict,
    signal, regime, levels, source, riskEff, weights, mtf, mtfLoading, runMtf,
    providerLabel, onAnalyze, analyzing, lastUpdated, autoRefresh, setAutoRefresh,
    minConf, setMinConf, minRR, setMinRR, tz, setTz, sizer, setSizer,
    history, histFilter, setHistFilter, onClearHistory, focus, setFocus,
    overlays, statusForHistory, marketProps
  } = props;
  const dec = asset?.decimals ?? 2;
  const n = candles.length;
  const pickerCard = (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>💱 Market & Asset</h2>
      <p className="sub">Pick what to analyze, then hit ANALYZE MARKET below.</p>
      <MarketPicker {...marketProps} />
    </div>
  );

  const setup = useMemo(() => {
    if (!n || !ind || !signal) return null;
    const eng = causalFor(candles);
    const st = stateAt(eng, n - 1);
    const pools = computePools(st.swingsH, st.swingsL);
    const dir = signal.direction === 'BUY' ? 1 : signal.direction === 'SELL' ? -1 : 0;
    const plan = dir ? buildTradePlan({ candles, ind, eng, levels, dir, pools, prevDay: ict?.prevDay, prevWeek: ict?.prevWeek }) : null;
    const assessment = assessSetup({ candles, eng, signal, plan, mtf, minConf, minRR, gated: signal.gated });
    const strength = setupStrength(signal.direction, signal.score, assessment.status);
    const risks = dir ? whyWait({ candles, ind, eng, signal, regime, mtf, plan, minRR, dir }) : [];
    const liq = liquidityMap({ pools, sweeps: st.sweeps, prevDay: ict?.prevDay, prevWeek: ict?.prevWeek, lastClose: candles[n - 1].close });
    const sess = sessionInfo(candles, tz);
    const techRows = categoryBreakdown(signal.tech.components);
    const ictRows = categoryBreakdown(signal.ictS.components);
    return { eng, st, pools, dir, plan, assessment, strength, risks, liq, sess, techRows, ictRows };
  }, [n, candles, ind, signal, ict, levels, mtf, minConf, minRR, tz, regime]);

  const sizing = useMemo(() => {
    if (!setup?.plan) return null;
    return sizeFor({
      balance: sizer.balance, riskPct: sizer.riskPct,
      entry: setup.plan.zone[0] === setup.plan.zone[1] ? setup.plan.entry : (setup.plan.zone[0] + setup.plan.zone[1]) / 2,
      stop: setup.plan.stop, takeProfit: setup.plan.t1.price, lev: sizer.lev
    });
  }, [setup, sizer]);

  if (!n || !signal || !setup) {
    return (
      <>
        {pickerCard}
        <div className="card" style={{ marginTop: 16 }}>
          <h2>🎯 Signals — current market analysis</h2>
          <p className="sub">No analysis yet{props.error ? ` — ${props.error}` : '. Select a market and run the analysis.'}</p>
          <div className="toolbar">
            <button className="btn" disabled={analyzing} onClick={onAnalyze}>{analyzing ? '🤖 Analyzing…' : '🔍 ANALYZE MARKET'}</button>
          </div>
        </div>
      </>
    );
  }

  const { plan, assessment, strength, risks, liq, sess, techRows, ictRows } = setup;
  const dir = setup.dir;
  const meterLabel = signal.score >= 70 ? 'STRONG CONFLUENCE' : signal.score >= 55 ? 'MODERATE CONFLUENCE' : 'WEAK CONFLUENCE';
  const statusEmoji = { 'CONFIRMED': '🟢', 'DEVELOPING': '🟡', 'WAIT FOR CONFIRMATION': '🟠', 'INVALIDATED': '🔴', 'NO TRADE': '⚪' }[assessment.status];

  return (
    <>
      {pickerCard}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>🎯 SIGNALS — {asset.symbol} / {timeframe}</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>{strategy.name} · {providerLabel} · {source === 'live' ? 'LIVE' : 'DEMO'} · {n} candles{props.fallbackNote ? ` · 💱 ${props.fallbackNote}` : ''}</p>
          </div>
          <div className="toolbar" style={{ marginTop: 0 }}>
            <button className="btn" disabled={analyzing} onClick={onAnalyze}>{analyzing ? '🤖 Analyzing…' : '🔍 ANALYZE MARKET'}</button>
          </div>
        </div>
        {analyzing && (
          <div className="loading-robot" style={{ marginTop: 10 }}><span className="spin" />
            <span>🤖 Analyzing market… ✓ Market data ✓ Indicators ✓ Structure ✓ Liquidity ✓ ICT/SMC ✓ Risk — generating analysis…</span>
          </div>
        )}
        <div className="row2" style={{ marginTop: 10 }}>
          <div>
            <label className="lbl">Strategy</label>
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
              {props.strategies.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <div>
            <label className="lbl">Auto refresh (default: manual — safest)</label>
            <select value={autoRefresh} onChange={(e) => setAutoRefresh(e.target.value)}>
              <option value="0">Manual</option>
              <option value="1">Every 1 minute</option>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every 1 hour</option>
            </select>
          </div>
        </div>
        <div className="kv"><span>Last updated</span><span><b>{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</b></span></div>
        <div className="row2">
          <div><label className="lbl">Minimum confluence: {minConf}</label>
            <div className="seg">{[50, 60, 70, 80, 90].map((v) => (<button key={v} className={minConf === v ? 'on chip' : 'chip'} onClick={() => setMinConf(v)}>{v}</button>))}</div>
          </div>
          <div><label className="lbl">Minimum R:R: {minRR}</label>
            <div className="seg">{[1, 1.5, 2, 2.5, 3].map((v) => (<button key={v} className={minRR === v ? 'on chip' : 'chip'} onClick={() => setMinRR(v)}>{v}</button>))}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="signal-banner">
          <div className={`signal-badge ${signal.direction}`} style={{ minWidth: 190 }}>
            {strength.emoji} {strength.label}
            <small>{signal.score}/100 · {signal.confidence}</small>
          </div>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>{signal.score} / 100 — {meterLabel}</h2>
            <p className="sub">This score measures agreement between the selected technical and ICT/SMC rules. It is <b>NOT</b> a probability of profit — never trade it as one.</p>
            <div className="gauge"><div style={{ width: `${signal.score}%` }} /></div>
            <div className="gauge-marks"><span>0</span><span>40 sell edge</span><span>50 neutral</span><span>60 buy edge</span><span>100</span></div>
            <div className="stats" style={{ marginTop: 10 }}>
              <Stat k="Setup status" v={`${statusEmoji} ${assessment.status}`} c={assessment.status === 'CONFIRMED' ? 'good' : assessment.status === 'NO TRADE' || assessment.status === 'INVALIDATED' ? 'bad' : 'flat'} />
              <Stat k="Regime" v={`${regime?.emoji || ''} ${regime?.label || '—'}`} c="flat" />
              <Stat k="Entry zone" v={plan ? `${fmtP(plan.zone[0], dec)} – ${fmtP(plan.zone[1], dec)}` : '—'} c="flat" />
              <Stat k="Stop / invalidation" v={plan ? fmtP(plan.stop, dec) : '—'} c="bad" />
              <Stat k="Target 1" v={plan ? `${fmtP(plan.t1.price, dec)} (${plan.t1.reason})` : '—'} c="good" />
              <Stat k="Risk / reward" v={plan ? `1 : ${plan.rr.toFixed(2)}` : '—'} c="flat" />
            </div>
            {assessment.statusReasons.map((r, i) => (
              <p className="sub" key={i} style={{ margin: '6px 0 0' }}>{statusEmoji} {r}</p>
            ))}
            {(() => {
              const thesis = tradeThesis(signal, dir, strength);
              return thesis ? (<div className="alert" style={{ marginTop: 10 }}>📝 <b>Why this trade:</b> {thesis}</div>) : null;
            })()}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
        <div className="card span6">
          <h2>✅ WHY THIS SETUP QUALIFIES</h2>
          <p className="sub">Generated from live calculations — grouped by evidence family.</p>
          {groupedReasons(signal, dir).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <p className="sub" style={{ margin: '8px 0 4px' }}><b>{cat}</b></p>
              {items.map((r, i) => (
                <div className="reason" key={i}>
                  <span className={`dot ${r.side}`} />
                  <div><b>{r.label}</b><p>{r.detail}</p></div>
                  <span className="pts">+{r.points}</span>
                </div>
              ))}
            </div>
          ))}
          {(!signal.reasons.some((r) => r.points > 0 && (dir === 1 ? r.side === 'bull' : r.side === 'bear'))) && (
            <p className="sub">No supporting evidence on this side — that is exactly why the status reads {assessment.status}.</p>
          )}
        </div>
        <div className="card span6">
          <h2>⚠️ WHY TO WAIT / RISKS</h2>
          <p className="sub">The balanced half — reasons against taking it right now.</p>
          {risks.length === 0 && <p className="sub">No specific risks detected beyond normal market risk. That is rare — double-check the plan.</p>}
          {risks.map((r, i) => (
            <div className="reason" key={i}>
              <span className="dot neutral" />
              <div><b>{r.text}</b></div>
              <span className="pts">{r.icon}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>📊 Confidence breakdown — every point accounted for</h2>
        <p className="sub">Earned / possible per family · weights technical {signal.combined.wt}% / ICT {signal.combined.wi}% · final {signal.score}/100.</p>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <p className="sub"><b>TECHNICAL — {signal.tech.score}/100</b></p>
            {techRows.map((g) => (
              <div className="kv" key={g.cat}><span>{g.cat}</span><span><b>{g.earned}/{g.possible}</b> {g.side === 'bull' ? '🟢' : g.side === 'bear' ? '🔴' : '⚪'}</span></div>
            ))}
          </div>
          <div>
            <p className="sub"><b>ICT / SMC — {signal.ictS.score}/100</b></p>
            {ictRows.map((g) => (
              <div className="kv" key={g.cat}><span>{g.cat}</span><span><b>{g.earned}/{g.possible}</b> {g.side === 'bull' ? '🟢' : g.side === 'bear' ? '🔴' : '⚪'}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
        <div className="card span6">
          <IctPanel ict={ict} candles={candles} asset={asset} onFocus={setFocus} />
        </div>
        <div className="card span6">
          <h2>💧 Liquidity map</h2>
          <p className="sub">Untouched levels are <i>potential</i> targets — never guaranteed fills.</p>
          <p className="sub"><b>BUY-SIDE (above price)</b></p>
          {liq.buySide.map((x, i) => (
            <div className="kv" key={'b' + i}><span>{x.state === 'swept' ? '🧹' : x.state === 'untouched-tested' ? '🎯' : '💧'} {x.label}</span><span><b>{fmtP(x.price, dec)}</b> · {x.state === 'swept' ? 'swept' : x.state === 'untouched-tested' ? 'tested — potential target' : 'untouched — potential target'}</span></div>
          ))}
          {liq.buySide.length === 0 && <p className="sub">No buy-side levels above.</p>}
          <p className="sub"><b>SELL-SIDE (below price)</b></p>
          {liq.sellSide.map((x, i) => (
            <div className="kv" key={'s' + i}><span>{x.state === 'swept' ? '🧹' : x.state === 'untouched-tested' ? '🎯' : '💧'} {x.label}</span><span><b>{fmtP(x.price, dec)}</b> · {x.state === 'swept' ? 'swept' : x.state === 'untouched-tested' ? 'tested — potential target' : 'untouched — potential target'}</span></div>
          ))}
          {liq.sellSide.length === 0 && <p className="sub">No sell-side levels below.</p>}
          <h2 style={{ marginTop: 12 }}>🕰️ Sessions (UTC{tz >= 0 ? '+' : ''}{tz})</h2>
          <div className="seg" style={{ marginBottom: 6 }}>
            {[0, 1, 3, 8, -5].map((z) => (<button key={z} className={tz === z ? 'on chip' : 'chip'} onClick={() => setTz(z)}>UTC{z >= 0 ? '+' : ''}{z}</button>))}
          </div>
          {sess && (<>
            <div className="kv"><span>Current session</span><span><b>{sess.name}{sess.killzone ? ' ⚡ killzone' : ''}</b></span></div>
            <div className="kv"><span>Session high / low</span><span><b>{fmtP(sess.dayHigh, dec)} / {fmtP(sess.dayLow, dec)}</b></span></div>
            <div className="kv"><span>Session range</span><span><b>{fmtP(sess.dayRange, dec)} ({sess.bars} bars)</b></span></div>
          </>)}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(12,1fr)', marginTop: 16 }}>
        <div className="card span6">
          <h2>📐 Trade plan</h2>
          {plan ? (<>
            <div className="kv"><span>Direction</span><span><b>{dir === 1 ? '🟢 LONG' : '🔴 SHORT'}</b></span></div>
            <div className="kv"><span>Entry zone ({plan.zoneLabel})</span><span><b>{fmtP(plan.zone[0], dec)} – {fmtP(plan.zone[1], dec)}</b></span></div>
            <div className="kv"><span>Invalidation / stop</span><span><b>{fmtP(plan.stop, dec)}</b></span></div>
            {plan.targets.map((t) => (
              <div className="kv" key={t.key}><span>{t.key} — {t.reason}</span><span><b>{fmtP(t.price, dec)}</b></span></div>
            ))}
            <div className="kv"><span>Risk / reward (vs T1)</span><span><b>1 : {plan.rr.toFixed(2)}</b></span></div>
            <p className="sub" style={{ marginTop: 8 }}><b>Invalidation:</b> {plan.invalidation}</p>
            <p className="sub"><b>Entry reason:</b> {entryReason(setup, dir)}</p>
          </>) : (<p className="sub">No plan — {assessment.statusReasons.join(' ')}</p>)}
        </div>
        <div className="card span6">
          <h2>📏 Position sizer (approx)</h2>
          <div className="row2">
            <div><label className="lbl">Account ($)</label><input type="number" value={sizer.balance} onChange={(e) => setSizer({ ...sizer, balance: Number(e.target.value) || 0 })} /></div>
            <div><label className="lbl">Risk (%)</label><input type="number" step="0.25" value={sizer.riskPct} onChange={(e) => setSizer({ ...sizer, riskPct: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className="row2">
            <div><label className="lbl">Leverage (×)</label><input type="number" min="1" max="50" value={sizer.lev} onChange={(e) => setSizer({ ...sizer, lev: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} /></div>
            <div />
          </div>
          {sizing && plan ? (<>
            <div className="kv"><span>Risk $</span><span><b>{money(sizing.maxLoss)}</b></span></div>
            <div className="kv"><span>Size</span><span><b>{sizing.qty.toFixed(4)} {asset.symbol}</b></span></div>
            <div className="kv"><span>Notional / margin</span><span><b>${sizing.notional.toFixed(0)} / ${sizing.margin.toFixed(0)}</b></span></div>
            <div className="kv"><span>Reward at T1</span><span className="pos"><b>{money(sizing.profit)}</b></span></div>
          </>) : (<p className="sub">Sizer activates once a plan exists.</p>)}
          <h2 style={{ marginTop: 12 }}>🕐 Alignment</h2>
          {!mtf && <button className="btn ghost" onClick={props.runMtf} disabled={mtfLoading}>{mtfLoading ? 'Scanning…' : 'Scan 5M / 15M / 1H / 4H / 1D'}</button>}
          {mtf && (
            <div className="tbl-wrap" style={{ maxHeight: 200 }}>
              <table><thead><tr><th>TF</th><th>Bias</th><th>Score</th></tr></thead>
                <tbody>{mtf.map((r) => (<tr key={r.tf}><td><b>{r.tf}</b></td>{r.ok ? (<><td>{r.direction === 'BUY' ? '🟢' : r.direction === 'SELL' ? '🔴' : '🟡'} {r.direction}</td><td>{r.score}</td></>) : (<td colSpan={2}>—</td>)}</tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>📈 Evidence chart — verify the setup visually</h2>
        <p className="sub">Entry/SL/T1–T3 plotted. Click ICT rows above to spotlight a bar.</p>
        <CandleChart candles={candles} ind={ind} trades={[]} ict={ict} overlays={overlays} levels={plan ? { entry: plan.entry, stop: plan.stop, targets: plan.targets } : (props.levels ? { ...props.levels, targets: [{ key: 'TP', price: props.levels.takeProfit }] } : null)} focus={focus} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <SignalHistory history={history} filter={histFilter} setFilter={setHistFilter} onClear={onClearHistory} asset={asset} timeframe={timeframe} lastClose={props.lastClose} dec={dec} />
      </div>

      <div className="card footer" style={{ marginTop: 16 }}>
        Signals are algorithmic market-analysis outputs based on the selected rules and available market data. They are not guarantees of future performance or financial advice. Confluence scores are not probabilities of profit.
      </div>
    </>
  );
}

function groupedReasons(signal, dir) {
  const want = dir === 1 ? 'bull' : 'bear';
  const items = (signal?.reasons || []).filter((r) => r.side === want && r.points > 0);
  const order = [];
  const map = new Map();
  for (const r of items) {
    const cat = r.cat || r.group || 'Other';
    if (!map.has(cat)) { map.set(cat, []); order.push(cat); }
    map.get(cat).push(r);
  }
  return order.map((cat) => [cat, map.get(cat).sort((a, b) => b.points - a.points)]);
}

// One-paragraph trade thesis: verdict + confidence + the top evidence for and
// the strongest counterpoint against. Scores are agreement meters, never odds.
function tradeThesis(signal, dir, strength) {
  if (!signal || !dir) return null;
  const want = dir === 1 ? 'bull' : 'bear';
  const against = dir === 1 ? 'bear' : 'bull';
  const pros = (signal.reasons || [])
    .filter((r) => r.side === want && r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);
  const con = (signal.reasons || [])
    .filter((r) => r.side === against && r.points > 0)
    .sort((a, b) => b.points - a.points)[0];
  const verdict = `${strength.label} with ${signal.confidence} confidence (${signal.score}/100)`;
  if (!pros.length) {
    return `${verdict}, but no single check dominates — size small or wait for confirmation.${con ? ` Counterpoint: ${con.label}.` : ''}`;
  }
  return `${verdict} because ${pros.map((r) => r.label).join(' and ')}.${con ? ` Counterpoint: ${con.label} — it invalidates the idea if it develops.` : ''}`;
}

function entryReason(setup, dir) {
  const bits = [];
  const st = setup?.st;
  if (st) {
    if (st.sweeps.some((e) => e.direction === dir)) bits.push(`liquidity was swept ${dir === 1 ? 'below' : 'above'} and reclaimed`);
    const fvg = st.fvgs.filter((g) => g.direction === dir && g.state !== 'filled').length;
    if (fvg) bits.push(`an unfilled ${dir === 1 ? 'bullish' : 'bearish'} FVG marks the zone`);
    if (st.bos.some((e) => e.direction === dir)) bits.push('structure broke in the trade direction');
  }
  if (setup?.plan?.zoneLabel) bits.push(`entry sits at ${setup.plan.zoneLabel}`);
  if (!bits.length) bits.push('trend/momentum confluence favors this side');
  return `Price action shows ${bits.join('; ')}. The selected strategy therefore identifies a potential ${dir === 1 ? 'long' : 'short'} setup — confirmation still required, and invalidation ends it.`;
}

function Stat({ k, v, c }) {
  return (<div className="stat"><div className="k">{k}</div><div className={`v ${c || 'flat'}`}>{v}</div></div>);
}

export function SignalHistory({ history, filter, setFilter, onClear, asset, timeframe, lastClose, dec }) {
  const rows = history.filter((e) => {
    if (filter === 'ALL') return true;
    if (filter === 'BUY') return e.signal === 'BUY' || e.signal === 'STRONG BUY';
    if (filter === 'SELL') return e.signal === 'SELL' || e.signal === 'STRONG SELL';
    return (e.liveStatus || e.status) === filter;
  });
  return (
    <>
      <h2>📜 Signal history ({history.length})</h2>
      <p className="sub">Every published analysis, with live status (invalidated when price crosses the stored stop, expired after 60 bars).</p>
      <div className="seg" style={{ marginBottom: 8 }}>
        {['ALL', 'BUY', 'SELL', 'NEUTRAL', 'ACTIVE', 'INVALIDATED'].map((f) => (
          <button key={f} className={filter === f ? 'on chip' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <button className="chip" onClick={onClear}>Clear</button>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 260 }}>
        <table>
          <thead><tr><th>Time</th><th>Asset</th><th>TF</th><th>Strategy</th><th>Signal</th><th>Score</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>
            {rows.slice(0, 60).map((e, i) => (
              <tr key={e.t + '-' + i}>
                <td>{new Date(e.t).toLocaleString()}</td>
                <td><b>{e.asset}</b></td>
                <td>{e.tf}</td>
                <td>{e.strategy}</td>
                <td>{e.signal}</td>
                <td>{e.score}</td>
                <td>{fmtP(e.price, dec)}</td>
                <td>{e.liveStatus}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center' }}>No signals logged yet — hit ANALYZE MARKET.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
