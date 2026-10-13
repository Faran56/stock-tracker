// ─── shared helpers ──────────────────────────────────────────────────────────
export const DEFAULT_CATEGORY = 'General';

export const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString());
export const money = (n) => `AED ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// ── dates (local time, so UAE evenings don't roll back to "yesterday") ───────
export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localToday() {
  return toISO(new Date());
}
export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDaysISO(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
// whole days from a to b (b - a)
export function daysBetween(a, b) {
  const A = parseISO(a), B = parseISO(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
export function prettyDate(s) {
  if (!s) return '—';
  const d = parseISO(s);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── stock balances (cancelled transactions never move stock) ─────────────────
export function computeStock(rows, products) {
  const balance = {}, totalIn = {}, totalOut = {};
  products.forEach(p => { balance[p] = 0; totalIn[p] = 0; totalOut[p] = 0; });
  rows.forEach(r => {
    if (r.status === 'Cancelled') return;
    products.forEach(p => {
      const v = Number(r.qty?.[p] || 0);
      if (!v) return;
      if (r.type === 'in') { totalIn[p] += v; balance[p] += v; }
      else { totalOut[p] += v; balance[p] -= v; }
    });
  });
  return { balance, totalIn, totalOut };
}

// ── per-item info used by the Items page and the Tracker alerts ──────────────
export function stockStatus(bal, min) {
  if (bal < 0) return 'over';
  if (bal === 0) return 'out';
  if (min > 0 && bal <= min) return 'low';
  return 'ok';
}

export function buildItemInfo(products, itemDefaults, stock) {
  return products.map(name => {
    const d = itemDefaults?.[name] || {};
    const cost = Number(d.cost) || 0;
    const price = Number(d.price) || 0;
    const min = Number(d.minStock) || 0;
    const bal = stock.balance[name] || 0;
    const tin = stock.totalIn[name] || 0;
    const tout = stock.totalOut[name] || 0;
    const status = stockStatus(bal, min);
    const moved = tin > 0 || tout > 0 || min > 0;
    return {
      name,
      category: d.category || DEFAULT_CATEGORY,
      hidden: !!d.hidden,
      cost, price, min, bal, tin, tout,
      raw: { cost: d.cost ?? '', price: d.price ?? '', min: d.minStock ?? '' },
      margin: price > 0 ? ((price - cost) / price) * 100 : null,
      value: Math.max(bal, 0) * cost,
      status,
      alert: status !== 'ok' && moved,
    };
  });
}
