import { useEffect, useRef } from 'react';

// Cartoon-styled canvas candlestick chart with indicators + trade markers + OB overlays.
export default function CandleChart({ candles, ind, trades = [], ict = null, height = 380 }) {
  const ref = useRef(null);
  const tipRef = useRef(null);

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
    const volH = 52;
    const priceH = H - padT - padB - volH;
    const n = candles.length;
    const cw = (W - padL - padR) / n;

    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > vmax) vmax = c.volume;
    }
    // include indicator extremes
    const lines = [ind?.ema20, ind?.ema50, ind?.bbUpper, ind?.bbLower, ict?.range ? [ict.range.high, ict.range.low] : null].flat().filter((v) => v != null && Number.isFinite(v));
    // ind arrays: handle
    for (const key of ['ema20', 'ema50', 'bbUpper', 'bbLower']) {
      const arr = ind?.[key];
      if (Array.isArray(arr)) for (const v of arr) { if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    }
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

    // order blocks (last few) — drawn first, behind candles
    if (ict?.orderBlocks) {
      for (const ob of ict.orderBlocks.slice(-5)) {
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
    const vy0 = padT + priceH + 8;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const h = vmax ? (c.volume / vmax) * (volH - 6) : 0;
      ctx.fillStyle = c.close >= c.open ? 'rgba(52,211,153,0.4)' : 'rgba(251,113,133,0.4)';
      ctx.fillRect(x(i) - cw * 0.3, vy0 + (volH - 6) - h, cw * 0.6, h);
    }

    // indicator lines
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
    drawLine(ind?.ema20, '#22d3ee', 1.7);
    drawLine(ind?.ema50, '#a78bfa', 1.7);
    drawLine(ind?.bbUpper, 'rgba(251,191,36,0.55)', 1.1, [5, 4]);
    drawLine(ind?.bbLower, 'rgba(251,191,36,0.55)', 1.1, [5, 4]);

    // swing markers
    if (ict?.swings) {
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

    // trades
    for (const t of trades) {
      const ex = x(t.entryIdx);
      ctx.font = 'bold 13px system-ui';
      if (t.dir === 1) {
        ctx.fillStyle = '#022c22';
        ctx.beginPath(); ctx.arc(ex, H - 26, 9, 0, Math.PI * 2); ctx.fillStyle = '#34d399'; ctx.fill();
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

    // last price line
    const last = candles[n - 1].close;
    ctx.strokeStyle = last >= candles[n - 2]?.close ? 'rgba(52,211,153,0.7)' : 'rgba(251,113,133,0.7)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y(last)); ctx.lineTo(W - padR, y(last)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#0b1230';
    roundRect(ctx, W - padR + 2, y(last) - 10, padR - 6, 20, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.stroke();
    ctx.fillStyle = '#eef2ff';
    ctx.fillText(fmtTick(last), W - padR + 8, y(last) + 4);

    // hover tooltip
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
  });

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={ref} className="chart" />
      <div ref={tipRef} style={{ display: 'none', position: 'absolute', background: 'rgba(5,8,24,.92)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, padding: '8px 10px', fontSize: 12, pointerEvents: 'none', zIndex: 2 }} />
      <div className="legend">
        <span><i style={{ background: '#34d399' }} />Bull candle</span>
        <span><i style={{ background: '#fb7185' }} />Bear candle</span>
        <span><i style={{ background: '#22d3ee' }} />EMA 20</span>
        <span><i style={{ background: '#a78bfa' }} />EMA 50</span>
        <span><i style={{ background: '#fbbf24' }} />Bollinger 20 ±2</span>
        <span>▲/▼ entries · dots exits</span>
      </div>
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
