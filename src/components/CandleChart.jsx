import { useEffect, useRef, useState } from 'react';

export const DEFAULT_OVERLAYS = {
  ema20: true, ema50: true, ema200: false, bb: true, volume: true,
  trades: true, ob: true, fvg: false, swings: true, pdhl: true, levels: true
};

// Cartoon-styled canvas candlestick chart with toggleable indicator,
// trade-marker, ICT and plan-level overlays.
export default function CandleChart({ candles, ind, trades = [], ict = null, height = 380, overlays = DEFAULT_OVERLAYS, levels = null }) {
  const ref = useRef(null);
  const tipRef = useRef(null);
  const ov = { ...DEFAULT_OVERLAYS, ...(overlays || {}) };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !candles?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.parentElement.clientWidth || 900;
    const H = height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padR = 64, padT = 14, padB = 54, padL = 8;
    const volH = ov.volume ? 52 : 8;
    const priceH = H - padT - padB - volH;
    const n = candles.length;
    const cw = (W - padL - padR) / n;

    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > vmax) vmax = c.volume;
    }
    const consider = (arr) => {
      if (Array.isArray(arr)) for (const v of arr) { if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    };
    if (ov.ema20) consider(ind?.ema20);
    if (ov.ema50) consider(ind?.ema50);
    if (ov.ema200) consider(ind?.ema200);
    if (ov.bb) { consider(ind?.bbUpper); consider(ind?.bbLower); }
    if (levels && ov.levels) { for (const v of [levels.entry, levels.stop, levels.takeProfit]) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } }
    if (ict?.range) { lo = Math.min(lo, ict.range.low); hi = Math.max(hi, ict.range.high); }
    const spanPad = (hi - lo) * 0.08 || hi * 0.01 || 1;
    lo -= spanPad; hi += spanPad;

    const x = (i) => padL + i * cw + cw / 2;
    const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * priceH;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.fillStyle = 'rgba(154,166,208,0.9)';
    ctx.font = '11px system-ui';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 5; g++) {
      const p = lo + ((hi - lo) * g) / 5;
      const yy = y(p);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(fmtTick(p), W - padR + 6, yy + 4);
    }

    // order blocks
    if (ov.ob && ict?.orderBlocks) {
      for (const ob of ict.orderBlocks.filter((o) => o.state !== 'violated').slice(-5)) {
        const x0 = x(Math.max(0, ob.index));
        const y0 = y(ob.top), y1 = y(ob.bottom);
        ctx.fillStyle = ob.direction === 1 ? 'rgba(52,211,153,0.10)' : 'rgba(251,113,133,0.10)';
        ctx.fillRect(x0, Math.min(y0, y1), W - padR - x0, Math.abs(y1 - y0) || 3);
        ctx.strokeStyle = ob.direction === 1 ? 'rgba(52,211,153,0.5)' : 'rgba(251,113,133,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x0, Math.min(y0, y1), W - padR - x0, Math.abs(y1 - y0) || 3);
        ctx.setLineDash([]);
      }
    }

    // FVG zones (right-extending translucent bands)
    if (ov.fvg && ict?.fvgs) {
      for (const g of ict.fvgs.filter((f) => f.state === 'unfilled').slice(-4)) {
        const x0 = x(Math.max(0, g.index));
        ctx.fillStyle = g.direction === 1 ? 'rgba(34,211,238,0.10)' : 'rgba(244,114,182,0.10)';
        ctx.fillRect(x0, y(g.top), W - padR - x0, Math.max(2, y(g.bottom) - y(g.top)));
      }
    }

    // candles
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const cx = x(i);
      const bw = Math.max(2, cw * 0.62);
      const up = c.close >= c.open;
      const col = up ? '#34d399' : '#fb7185';
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cw * 0.14);
      ctx.beginPath(); ctx.moveTo(cx, y(c.high)); ctx.lineTo(cx, y(c.low)); ctx.stroke();
      ctx.fillStyle = col;
      const yO = y(c.open), yC = y(c.close);
      const top = Math.min(yO, yC);
      const h = Math.max(2, Math.abs(yC - yO));
      roundRect(ctx, cx - bw / 2, top, bw, h, Math.min(3, bw / 3));
      ctx.fill();
    }

    // volume
    if (ov.volume) {
      const vy0 = padT + priceH + 8;
      for (let i = 0; i < n; i++) {
        const c = candles[i];
        const h = vmax ? (c.volume / vmax) * (volH - 6) : 0;
        ctx.fillStyle = c.close >= c.open ? 'rgba(52,211,153,0.4)' : 'rgba(251,113,133,0.4)';
        ctx.fillRect(x(i) - cw * 0.3, vy0 + (volH - 6) - h, cw * 0.6, h);
      }
    }

    const drawLine = (arr, color, width = 1.6, dash = []) => {
      if (!Array.isArray(arr)) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = arr[i];
        if (v == null || !Number.isFinite(v)) continue;
        const xx = x(i), yy = y(v);
        if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (ov.ema20) drawLine(ind?.ema20, '#22d3ee', 1.7);
    if (ov.ema50) drawLine(ind?.ema50, '#a78bfa', 1.7);
    if (ov.ema200) drawLine(ind?.ema200, '#fbbf24', 1.7);
    if (ov.bb) {
      drawLine(ind?.bbUpper, 'rgba(251,191,36,0.55)', 1.1, [5, 4]);
      drawLine(ind?.bbLower, 'rgba(251,191,36,0.55)', 1.1, [5, 4]);
    }

    // previous day/week high-low
    if (ov.pdhl && ict) {
      const hline = (price, color, tag) => {
        if (!Number.isFinite(price)) return;
        ctx.strokeStyle = color; ctx.setLineDash([7, 5]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(padL, y(price)); ctx.lineTo(W - padR, y(price)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = 'bold 10px system-ui';
        ctx.fillText(tag, padL + 4, y(price) - 4);
      };
      if (ict.prevDay) { hline(ict.prevDay.high, 'rgba(163,230,53,0.8)', 'PDH'); hline(ict.prevDay.low, 'rgba(163,230,53,0.8)', 'PDL'); }
      if (ict.prevWeek) { hline(ict.prevWeek.high, 'rgba(244,114,182,0.8)', 'PWH'); hline(ict.prevWeek.low, 'rgba(244,114,182,0.8)', 'PWL'); }
    }

    // swing markers
    if (ov.swings && ict?.swings) {
      ctx.font = 'bold 10px system-ui';
      for (const s of ict.swings.highs.slice(-10)) {
        ctx.fillStyle = 'rgba(251,113,133,0.9)';
        ctx.fillText('▾', x(s.index) - 4, y(s.price) - 6);
      }
      for (const s of ict.swings.lows.slice(-10)) {
        ctx.fillStyle = 'rgba(52,211,153,0.9)';
        ctx.fillText('▴', x(s.index) - 4, y(s.price) + 13);
      }
    }

    // trade plan levels (entry/SL/TP from SignalBot)
    if (ov.levels && levels) {
      const plan = [
        { v: levels.entry, c: '#22d3ee', t: 'ENTRY' },
        { v: levels.stop, c: '#fb7185', t: 'SL' },
        { v: levels.takeProfit, c: '#34d399', t: 'TP' }
      ];
      ctx.font = 'bold 10px system-ui';
      for (const p of plan) {
        if (!Number.isFinite(p.v)) continue;
        ctx.strokeStyle = p.c; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(padL, y(p.v)); ctx.lineTo(W, y(p.v)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = p.c;
        ctx.fillText(`${p.t} ${fmtTick(p.v)}`, W - padR + 4, y(p.v) - 4);
      }
    }

    // trades
    if (ov.trades) {
      for (const t of trades) {
        const ex = x(t.entryIdx);
        ctx.font = 'bold 13px system-ui';
        if (t.dir === 1) {
          ctx.fillStyle = '#34d399';
          ctx.beginPath(); ctx.arc(ex, H - 26, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#022c22'; ctx.fillText('▲', ex - 6, H - 21);
        } else {
          ctx.fillStyle = '#fb7185';
          ctx.beginPath(); ctx.arc(ex, 22, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2b060d'; ctx.fillText('▼', ex - 6, 27);
        }
        if (t.exitIndex != null) {
          const xx = x(t.exitIndex);
          ctx.fillStyle = t.net > 0 ? 'rgba(52,211,153,0.9)' : 'rgba(251,113,133,0.9)';
          ctx.beginPath(); ctx.arc(xx, t.dir === 1 ? H - 26 : 22, 3.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // last price line
    const last = candles[n - 1].close;
    ctx.strokeStyle = n > 1 && last >= candles[n - 2]?.close ? 'rgba(52,211,153,0.7)' : 'rgba(251,113,133,0.7)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y(last)); ctx.lineTo(W - padR, y(last)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#0b1230';
    roundRect(ctx, W - padR + 2, y(last) - 10, padR - 6, 20, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.stroke();
    ctx.fillStyle = '#eef2ff';
    ctx.fillText(fmtTick(last), W - padR + 8, y(last) + 4);

    const onMove = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const idx = Math.round((mx - padL - cw / 2) / cw);
      const tip = tipRef.current;
      if (!tip || idx < 0 || idx >= n) { if (tip) tip.style.display = 'none'; return; }
      const c = candles[idx];
      tip.style.display = 'block';
      tip.style.left = Math.min(Math.max(mx + 12, 8), W - 190) + 'px';
      tip.style.top = '12px';
      tip.innerHTML = `<b>${new Date(c.timestamp).toLocaleString()}</b><br>O ${fmtTick(c.open)} · H ${fmtTick(c.high)}<br>L ${fmtTick(c.low)} · C ${fmtTick(c.close)}<br>Vol ${Math.round(c.volume).toLocaleString()}`;
    };
    const onLeave = () => { if (tipRef.current) tipRef.current.style.display = 'none'; };
    canvas.onmousemove = onMove;
    canvas.onmouseleave = onLeave;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={ref} className="chart" />
      <div ref={tipRef} style={{ display: 'none', position: 'absolute', background: 'rgba(5,8,24,.92)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, padding: '8px 10px', fontSize: 12, pointerEvents: 'none', zIndex: 2 }} />
      <div className="legend">
        <span><i style={{ background: '#34d399' }} />Bull</span>
        <span><i style={{ background: '#fb7185' }} />Bear</span>
        {ov.ema20 && <span><i style={{ background: '#22d3ee' }} />EMA 20</span>}
        {ov.ema50 && <span><i style={{ background: '#a78bfa' }} />EMA 50</span>}
        {ov.ema200 && <span><i style={{ background: '#fbbf24' }} />EMA 200</span>}
        {ov.bb && <span><i style={{ background: '#fbbf24' }} />Bollinger</span>}
        <span>▲/▼ entries · dots exits</span>
      </div>
    </div>
  );
}

// Generic oscillator sub-panel (RSI with bands, or MACD lines + histogram).
export function OscillatorPanel({ candles, lines = [], hist = null, bands = [], height = 120, title = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !candles?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 900;
    const H = height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const padR = 44, padL = 8, padT = 8, padB = 8;
    const n = candles.length;
    let lo = Infinity, hi = -Infinity;
    for (const l of lines) for (const v of (l.data || [])) { if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (hist) for (const v of hist) { if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    const X = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    ctx.font = '10px system-ui';
    for (const b of bands) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, Y(b)); ctx.lineTo(W - padR, Y(b)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(154,166,208,0.9)'; ctx.fillText(String(b), W - padR + 4, Y(b) + 3);
    }
    if (hist) {
      for (let i = 0; i < n; i++) {
        const v = hist[i];
        if (v == null || !Number.isFinite(v)) continue;
        ctx.fillStyle = v >= 0 ? 'rgba(52,211,153,0.5)' : 'rgba(251,113,133,0.5)';
        const zero = Y(0);
        ctx.fillRect(X(i) - 1, Math.min(zero, Y(v)), 2, Math.abs(Y(v) - zero) || 1);
      }
    }
    for (const l of lines) {
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.6;
      ctx.beginPath();
      let s = false;
      for (let i = 0; i < n; i++) {
        const v = l.data?.[i];
        if (v == null || !Number.isFinite(v)) continue;
        if (!s) { ctx.moveTo(X(i), Y(v)); s = true; } else ctx.lineTo(X(i), Y(v));
      }
      ctx.stroke();
    }
  });
  return (
    <div style={{ marginTop: 8 }}>
      {title && <div style={{ fontSize: 12, color: '#9aa6d0', marginBottom: 4 }}>{title}</div>}
      <canvas ref={ref} className="chart" />
    </div>
  );
}

export function OverlayToggles({ value, onChange }) {
  const items = [
    ['ema20', 'EMA 20'], ['ema50', 'EMA 50'], ['ema200', 'EMA 200'], ['bb', 'Bollinger'],
    ['volume', 'Volume'], ['trades', 'Trades'], ['ob', 'Order blocks'],
    ['fvg', 'FVG'], ['swings', 'Swings'], ['pdhl', 'PDH/PDL/PWH/PWL'], ['levels', 'Entry/SL/TP']
  ];
  return (
    <div className="seg" style={{ marginTop: 8 }}>
      {items.map(([k, label]) => (
        <button key={k} className={value[k] ? 'on chip' : 'chip'} style={!value[k] ? {} : {}} onClick={() => onChange({ ...value, [k]: !value[k] })}>
          {value[k] ? '☑' : '☐'} {label}
        </button>
      ))}
    </div>
  );
}

function roundRect(ctx, px, py, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.arcTo(px + w, py, px + w, py + h, r);
  ctx.arcTo(px + w, py + h, px, py + h, r);
  ctx.arcTo(px, py + h, px, py, r);
  ctx.arcTo(px, py, px + w, py, r);
  ctx.closePath();
}

function fmtTick(p) {
  if (!Number.isFinite(p)) return '—';
  if (Math.abs(p) >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(p) >= 100) return p.toFixed(1);
  if (Math.abs(p) >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
