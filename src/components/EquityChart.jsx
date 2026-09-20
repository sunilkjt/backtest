import { useEffect, useRef } from 'react';

export default function EquityChart({ equity, initial, height = 180 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !equity?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 900;
    const H = height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const vals = equity.map((e) => e.equity);
    let lo = Math.min(...vals, initial), hi = Math.max(...vals, initial);
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad; hi += pad;
    const X = (i) => 8 + (i / Math.max(1, vals.length - 1)) * (W - 70);
    const Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 24);
    // break-even
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(8, Y(initial)); ctx.lineTo(W - 62, Y(initial)); ctx.stroke();
    ctx.setLineDash([]);
    // fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(34,211,238,0.35)');
    grad.addColorStop(1, 'rgba(34,211,238,0.02)');
    ctx.beginPath();
    vals.forEach((v, i) => { if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v)); });
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(X(vals.length - 1), H - 8); ctx.lineTo(X(0), H - 8); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // labels
    ctx.fillStyle = 'rgba(238,242,255,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText(fmt(hi), W - 56, 14);
    ctx.fillText(fmt(lo), W - 56, H - 8);
  });
  return <canvas ref={ref} className="chart" />;
}

function fmt(v) {
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}
