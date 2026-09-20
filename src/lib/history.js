// Signal history: append-only log of published analyses with derived status.
// Stored under its own localStorage key (never touches the workspace key).
// Status derivation is pure and testable: ACTIVE → INVALIDATED (price crossed
// the stored stop) or EXPIRED (older than 60 bars of its timeframe).

const KEY = 'ai-trading-lab:signals:v1';
const MAX = 120;

export const TF_MS = { '1m': 60e3, '5m': 5 * 60e3, '15m': 15 * 60e3, '1h': 36e5, '4h': 4 * 36e5, '1d': 864e5, '1w': 7 * 864e5 };

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function logSignal(entry) {
  const list = [entry, ...loadHistory()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return [];
}

// Derived status for display. e = stored entry, nowPrice = current price of
// the same asset/timeframe (null when viewing another market), now = Date.now().
export function entryStatus(e, nowPrice, now = Date.now()) {
  if (!e || e.signal === 'NEUTRAL' || e.status === 'NO TRADE') return e?.status || 'NO TRADE';
  const ageBars = (now - e.t) / (TF_MS[e.tf] || 36e5);
  if (ageBars > 60) return 'EXPIRED';
  if (nowPrice != null && Number.isFinite(e.stop)) {
    if (e.dir === 1 && nowPrice <= e.stop) return 'INVALIDATED';
    if (e.dir === -1 && nowPrice >= e.stop) return 'INVALIDATED';
  }
  return e.status || 'ACTIVE';
}

export function filterHistory(list, f) {
  return list.filter((e) => {
    if (f === 'ALL') return true;
    if (f === 'BUY') return e.signal === 'BUY' || e.signal === 'STRONG BUY';
    if (f === 'SELL') return e.signal === 'SELL' || e.signal === 'STRONG SELL';
    return (e.status || 'ACTIVE') === f;
  });
}
