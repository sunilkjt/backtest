import { useEffect, useMemo, useRef, useState } from 'react';

const SPANS = [
  { id: '1M', ms: 30 * 864e5 },
  { id: '3M', ms: 90 * 864e5 },
  { id: '6M', ms: 180 * 864e5 },
  { id: '1Y', ms: 365 * 864e5 },
  { id: 'ALL', ms: 0 }
];

// Interactive equity curve: time-span ranges, drawdown shading, trade dots.
export default function EquityChart({ equity, initial, trades = [], height = 200 }) {
  const ref = useRef(null);
  const [span, setSpan] = useState('ALL');

  const view = useMemo(() => {
    if (!equity?.length) return { pts: [], trades: [] };
    const cfg = SPANS.find((s) => s.id === span) || SPANS[4];
    const end = equity[equity.length - 1].timestamp;
    const pts = cfg.ms ? equity.filter((p) => p.timestamp >= end - cfg.ms) : equity;
    const from = pts.length ? pts[0].timestamp : 0;
    const tIn = (trades || []).filter((t) => t.exitTime >= from && t.entryTime <= end);
    return { pts: pts.length > 1 ? pts : equity, trades: tIn };
  }, [equity, trades, span]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !view.pts.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 900;
    const H = height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const vals = view.pts.map((e) => e.equity);
    let lo = Math.min(...vals, initial), hi = Math.max(...vals, initial);
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad; hi += pad;
    const X = (i) => 8 + (i / Math.max(1, vals.length - 1)) * (W - 70);
    const Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 24);

    // drawdown shading (peak envelope vs equity)
    let peak = vals[0];
    ctx.beginPath();
    view.pts.forEach((p, i) => { if (p.equity > peak) peak = p.equity; });
    peak = vals[0];
    const peakLine = [];
    view.pts.forEach((p) => { if (p.equity > peak) peak = p.equity; peakLine.push(peak); });
    ctx.beginPath();
    view.pts.forEach((p, i) => { if (i === 0) ctx.moveTo(X(i), Y(p.equity)); else ctx.lineTo(X(i), Y(p.equity)); });
    for (let i = view.pts.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(peakLine[i]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(251,113,133,0.16)';
    ctx.fill();

    // break-even
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(8, Y(initial)); ctx.lineTo(W - 62, Y(initial)); ctx.stroke();
    ctx.setLineDash([]);

    // equity line + fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(34,211,238,0.35)');
    grad.addColorStop(1, 'rgba(34,211,238,0.02)');
    ctx.beginPath();
    vals.forEach((v, i) => { if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v)); });
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(X(vals.length - 1), H - 8); ctx.lineTo(X(0), H - 8); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // trade locations (entry → exit dots)
    const t0 = view.pts[0].timestamp, t1 = view.pts[view.pts.length - 1].timestamp;
    const TX = (ts) => 8 + ((ts - t0) / Math.max(1, t1 - t0)) * (W - 70);
    for (const t of view.trades.slice(-120)) {
      ctx.fillStyle = t.net > 0 ? 'rgba(52,211,153,0.85)' : 'rgba(251,113,133,0.85)';
      ctx.beginPath(); ctx.arc(TX(t.entryTime), H - 12, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.net > 0 ? 'rgba(52,211,153,0.4)' : 'rgba(251,113,133,0.4)';
      ctx.beginPath(); ctx.arc(TX(t.exitTime), 12, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = 'rgba(238,242,255,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(fmt(hi), W - 56, 14);
    ctx.fillText(fmt(lo), W - 56, H - 8);
  }, [view, initial, height]);

  return (
    <div>
      <div className="seg" style={{ marginBottom: 6 }}>
        {SPANS.map((s) => (
          <button key={s.id} className={span === s.id ? 'on chip' : 'chip'} onClick={() => setSpan(s.id)}>{s.id}</button>
        ))}
      </div>
      <canvas ref={ref} className="chart" />
      <div className="legend"><span>● entries (bottom) · ○ exits (top) · green = win, red = loss</span></div>
    </div>
  );
}

function fmt(v) {
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}
