import React, { useMemo, useState } from 'react';
import {
  Search, Upload, Plus, Trash2, CalendarClock, AlertTriangle, Users, TrendingUp, ChevronRight,
} from 'lucide-react';
import { Modal } from './ui';
import {
  fmt, money, localToday, addDaysISO, daysBetween, prettyDate,
} from './utils';

// ─── prediction engine ───────────────────────────────────────────────────────
// Rule-based and fully explainable: for every customer we look at the gaps
// between their order dates, take the typical (median) gap of the last few
// orders, and project it forward from the last order. Expected items are the
// products they buy in most of their recent orders, at their usual quantity.

const HORIZON_DAYS = 30;

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

function predict(orders, today) {
  if (orders.length === 0) return { state: 'none' };
  if (orders.length < 2) return { state: 'new' };

  const dates = orders.map(o => o.date);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const g = daysBetween(dates[i - 1], dates[i]);
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return { state: 'new' };

  const recent = gaps.slice(-5);
  const interval = Math.max(1, Math.round(median(recent)));
  const mean = avg(recent);
  const sd = Math.sqrt(avg(recent.map(g => (g - mean) ** 2)));
  const cv = mean ? sd / mean : 0;
  const conf = orders.length >= 4 && cv <= 0.5 ? 'High'
    : orders.length >= 3 && cv <= 0.9 ? 'Medium' : 'Low';

  const last = dates[dates.length - 1];
  const next = addDaysISO(last, interval);
  const daysUntil = daysBetween(today, next);

  let state;
  if (daysUntil < -Math.max(14, interval * 2)) state = 'lapsed';
  else if (daysUntil < 0) state = 'overdue';
  else if (daysUntil <= 7) state = 'soon';
  else state = 'ontrack';

  const lastN = orders.slice(-5);
  const agg = {};
  lastN.forEach(o => {
    Object.entries(o.items).forEach(([p, q]) => {
      if (!agg[p]) agg[p] = { n: 0, q: 0 };
      agg[p].n += 1;
      agg[p].q += q;
    });
  });
  const items = Object.entries(agg)
    .filter(([, v]) => v.n / lastN.length >= 0.4)
    .map(([product, v]) => ({ product, qty: Math.max(1, Math.round(v.q / v.n)), freq: v.n / lastN.length }))
    .sort((a, b) => b.freq * b.qty - a.freq * a.qty);

  return {
    state, interval, next, daysUntil, conf, items,
    window: Math.max(2, Math.round(sd)),
  };
}

function buildStats(rows, products, itemDefaults, customers, today) {
  const byName = {};
  customers.forEach(n => { byName[n] = byName[n] || { name: n, days: {} }; });

  rows.forEach(r => {
    if (r.type !== 'out' || r.purpose === 'production' || r.status === 'Cancelled') return;
    const name = (r.customer || '').trim();
    if (!name || !r.date) return;
    const c = byName[name] || (byName[name] = { name, days: {} });
    const day = c.days[r.date] || (c.days[r.date] = {
      date: r.date, items: {}, revenue: 0, units: 0, statuses: [], invoices: [],
    });
    products.forEach(p => {
      const q = Number(r.qty?.[p] || 0);
      if (!q) return;
      const price = Number(r.price?.[p] || 0) || Number(itemDefaults?.[p]?.price) || 0;
      day.items[p] = (day.items[p] || 0) + q;
      day.units += q;
      day.revenue += q * price;
    });
    day.statuses.push(r.status);
    if (r.invoiceNo) day.invoices.push(r.invoiceNo);
  });

  return Object.values(byName).map(c => {
    const orders = Object.values(c.days).sort((a, b) => a.date.localeCompare(b.date));
    const revenue = orders.reduce((s, o) => s + o.revenue, 0);
    const units = orders.reduce((s, o) => s + o.units, 0);
    const last = orders.length ? orders[orders.length - 1].date : null;
    return {
      name: c.name,
      orders,
      count: orders.length,
      revenue,
      units,
      first: orders.length ? orders[0].date : null,
      last,
      daysSince: last ? daysBetween(last, today) : null,
      avgOrder: orders.length ? revenue / orders.length : 0,
      pending: orders.filter(o => o.statuses.some(s => s === 'Pending' || s === 'Processing')).length,
      pred: predict(orders, today),
    };
  });
}

const STATE_META = {
  overdue: { label: 'Overdue', cls: 'pill-red' },
  lapsed: { label: 'At risk', cls: 'pill-red' },
  soon: { label: 'Due soon', cls: 'pill-amber' },
  ontrack: { label: 'On track', cls: 'pill-green' },
  new: { label: 'Not enough history', cls: 'pill-grey' },
  none: { label: 'No orders yet', cls: 'pill-grey' },
};

function relative(n) {
  if (n === 0) return 'today';
  if (n > 0) return `in ${n} day${n === 1 ? '' : 's'}`;
  return `${-n} day${n === -1 ? '' : 's'} overdue`;
}

// ─── component ───────────────────────────────────────────────────────────────
export default function Customers({
  rows, products, itemDefaults, customers, stock, onUpload, onAddCustomer, onRemoveCustomer,
}) {
  const today = localToday();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');
  const [showAllExpected, setShowAllExpected] = useState(false);
  const [newName, setNewName] = useState('');
  const [openName, setOpenName] = useState(null);

  const stats = useMemo(
    () => buildStats(rows, products, itemDefaults, customers, today),
    [rows, products, itemDefaults, customers, today]
  );

  const expected = useMemo(
    () => stats
      .filter(c => ['overdue', 'soon', 'ontrack'].includes(c.pred.state) && c.pred.daysUntil <= HORIZON_DAYS)
      .sort((a, b) => a.pred.daysUntil - b.pred.daysUntil),
    [stats]
  );
  const atRisk = stats.filter(c => c.pred.state === 'lapsed');
  const overdue = stats.filter(c => c.pred.state === 'overdue');
  const buying = stats.filter(c => c.count > 0);

  // projected demand for the next 30 days vs. what's on the shelf
  const demand = useMemo(() => {
    const need = {};
    expected.forEach(c => c.pred.items.forEach(it => { need[it.product] = (need[it.product] || 0) + it.qty; }));
    return Object.entries(need)
      .map(([product, qty]) => {
        const have = stock.balance[product] || 0;
        return { product, qty, have, short: Math.max(0, qty - have) };
      })
      .sort((a, b) => b.short - a.short || b.qty - a.qty);
  }, [expected, stock]);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = stats.filter(c => !q || c.name.toLowerCase().includes(q));
    const val = (c) => {
      if (sortBy === 'name') return c.name.toLowerCase();
      if (sortBy === 'orders') return c.count;
      if (sortBy === 'last') return c.last || '';
      if (sortBy === 'next') return c.pred.next || '9999-12-31';
      return c.revenue;
    };
    return list.sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? c : -c;
    });
  }, [stats, search, sortBy, sortDir]);

  function setSort(key) {
    if (sortBy === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir(key === 'name' || key === 'next' ? 'asc' : 'desc'); }
  }
  const arrow = (k) => (sortBy === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  function addNew() {
    const n = newName.trim();
    if (!n) return;
    onAddCustomer(n);
    setNewName('');
  }

  const shownExpected = showAllExpected ? expected : expected.slice(0, 6);
  const detail = openName ? stats.find(c => c.name === openName) : null;

  return (
    <div className="page customers-page">
      <div className="page-head">
        <div>
          <h2>Customers</h2>
          <p className="page-sub">
            Every customer's buying history, plus a forecast of who is likely to order next and what they usually buy.
            Forecasts need at least two orders from a customer and get sharper with more history.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={onUpload}><Upload size={15} /> Upload list</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Customers</span>
          <b className="stat-value">{stats.length}</b>
          <span className="stat-sub">{buying.length} have ordered</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Expected · {HORIZON_DAYS} days</span>
          <b className="stat-value">{expected.length}</b>
          <span className="stat-sub">predicted orders</span>
        </div>
        <div className={`stat-card ${overdue.length ? 'stat-card--warn' : ''}`}>
          <span className="stat-label">Overdue</span>
          <b className="stat-value">{overdue.length}</b>
          <span className="stat-sub">past their usual cycle</span>
        </div>
        <div className={`stat-card ${atRisk.length ? 'stat-card--danger' : ''}`}>
          <span className="stat-label">At risk</span>
          <b className="stat-value">{atRisk.length}</b>
          <span className="stat-sub">silent for 2× their cycle</span>
        </div>
      </div>

      {/* ── expected orders ── */}
      <section className="panel">
        <div className="panel-head">
          <h3><CalendarClock size={15} /> Expected orders</h3>
          {expected.length > 6 && (
            <button className="link-btn" onClick={() => setShowAllExpected(v => !v)}>
              {showAllExpected ? 'Show fewer' : `Show all ${expected.length}`}
            </button>
          )}
        </div>
        {expected.length === 0 ? (
          <p className="panel-empty">
            No predictions yet. Once customers have placed two or more orders on different dates,
            their next order will appear here.
          </p>
        ) : (
          <div className="expect-list">
            {shownExpected.map(c => (
              <button key={c.name} className="expect-card" onClick={() => setOpenName(c.name)}>
                <div className="expect-top">
                  <span className="expect-name">{c.name}</span>
                  <span className={`pill ${STATE_META[c.pred.state].cls}`}>{STATE_META[c.pred.state].label}</span>
                </div>
                <div className="expect-when">
                  <b>{relative(c.pred.daysUntil)}</b>
                  <span> · around {prettyDate(c.pred.next)} (±{c.pred.window}d)</span>
                </div>
                <div className="chip-row">
                  {c.pred.items.length === 0 && <span className="text-muted small">No regular items yet</span>}
                  {c.pred.items.slice(0, 4).map(it => (
                    <span key={it.product} className="item-chip item-chip--out">{it.product} <b>×{it.qty}</b></span>
                  ))}
                  {c.pred.items.length > 4 && <span className="item-chip item-chip--more">+{c.pred.items.length - 4}</span>}
                </div>
                <div className="expect-foot">
                  Orders about every {c.pred.interval} days · {c.pred.conf} confidence
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── demand vs stock ── */}
      {demand.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3><TrendingUp size={15} /> Stock needed · next {HORIZON_DAYS} days</h3>
          </div>
          <div className="gt demand-gt">
            <div className="gt-head">
              <div className="gt-h">Item</div>
              <div className="gt-h gt-num">Expected demand</div>
              <div className="gt-h gt-num">In stock</div>
              <div className="gt-h gt-num">Shortfall</div>
            </div>
            {demand.map(d => (
              <div key={d.product} className="gt-row">
                <div className="gt-cell gt-title"><span className="item-name">{d.product}</span></div>
                <div className="gt-cell gt-num" data-label="Expected demand"><span className="mono-cell">{fmt(d.qty)}</span></div>
                <div className="gt-cell gt-num" data-label="In stock"><span className="mono-cell">{fmt(d.have)}</span></div>
                <div className="gt-cell gt-num" data-label="Shortfall">
                  {d.short > 0
                    ? <span className="neg-text">−{fmt(d.short)} · reorder</span>
                    : <span className="profit-text">Covered</span>}
                </div>
              </div>
            ))}
          </div>
          <p className="panel-note">Based on the usual quantities of customers expected to order. A guide, not a guarantee.</p>
        </section>
      )}

      {/* ── all customers ── */}
      <section className="panel">
        <div className="panel-head">
          <h3><Users size={15} /> All customers</h3>
        </div>
        <div className="toolbar toolbar--tight">
          <div className="search-wrap grow">
            <Search size={14} className="search-icon" />
            <input className="search-input" placeholder="Search customers…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="sort-group sort-group--mobile">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort by">
              <option value="revenue">Sort: Revenue</option>
              <option value="name">Sort: Name</option>
              <option value="orders">Sort: Orders</option>
              <option value="last">Sort: Last order</option>
              <option value="next">Sort: Next expected</option>
            </select>
            <button className="btn btn-ghost btn-icon" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} aria-label="Toggle sort direction">
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <div className="add-inline">
            <input
              placeholder="Add customer…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNew()}
            />
            <button className="btn btn-accent btn-icon" onClick={addNew} aria-label="Add customer"><Plus size={15} /></button>
          </div>
        </div>

        <div className="gt cust-gt">
          <div className="gt-head">
            <div className="gt-h sortable" onClick={() => setSort('name')}>Customer{arrow('name')}</div>
            <div className="gt-h gt-num sortable" onClick={() => setSort('orders')}>Orders{arrow('orders')}</div>
            <div className="gt-h gt-num sortable" onClick={() => setSort('revenue')}>Revenue{arrow('revenue')}</div>
            <div className="gt-h sortable" onClick={() => setSort('last')}>Last order{arrow('last')}</div>
            <div className="gt-h sortable" onClick={() => setSort('next')}>Next expected{arrow('next')}</div>
            <div className="gt-h"></div>
          </div>
          {sorted.length === 0 && <div className="empty-state"><p>No customers found.</p></div>}
          {sorted.map(c => (
            <div key={c.name} className="gt-row cust-row" onClick={() => setOpenName(c.name)}>
              <div className="gt-cell gt-title">
                <span className="item-name">{c.name}</span>
                {c.pending > 0 && <span className="hidden-tag pending-tag">{c.pending} pending</span>}
              </div>
              <div className="gt-cell gt-num" data-label="Orders"><span className="mono-cell">{c.count}</span></div>
              <div className="gt-cell gt-num" data-label="Revenue"><span className="mono-cell">{c.revenue > 0 ? money(c.revenue) : '—'}</span></div>
              <div className="gt-cell" data-label="Last order">
                {c.last ? <span>{prettyDate(c.last)}<span className="text-muted small"> · {c.daysSince}d ago</span></span> : <span className="text-muted">—</span>}
              </div>
              <div className="gt-cell" data-label="Next expected">
                {c.pred.next
                  ? <span>{prettyDate(c.pred.next)}</span>
                  : <span className={`pill ${STATE_META[c.pred.state].cls}`}>{STATE_META[c.pred.state].label}</span>}
                {c.pred.next && <span className={`pill ${STATE_META[c.pred.state].cls}`}>{STATE_META[c.pred.state].label}</span>}
              </div>
              <div className="gt-cell gt-actions" onClick={e => e.stopPropagation()}>
                {c.count === 0
                  ? <button className="icon-btn danger" onClick={() => onRemoveCustomer(c.name)} aria-label="Remove customer"><Trash2 size={15} /></button>
                  : <ChevronRight size={16} className="text-muted" />}
              </div>
            </div>
          ))}
        </div>
      </section>

      {detail && (
        <CustomerDetail c={detail} onClose={() => setOpenName(null)} />
      )}
    </div>
  );
}

// ─── customer detail ─────────────────────────────────────────────────────────
function CustomerDetail({ c, onClose }) {
  const p = c.pred;

  const mix = useMemo(() => {
    const m = {};
    c.orders.forEach(o => Object.entries(o.items).forEach(([prod, q]) => {
      if (!m[prod]) m[prod] = { product: prod, qty: 0, orders: 0 };
      m[prod].qty += q;
      m[prod].orders += 1;
    }));
    const list = Object.values(m).sort((a, b) => b.qty - a.qty);
    const max = list.length ? list[0].qty : 1;
    return list.map(x => ({ ...x, pct: (x.qty / max) * 100 }));
  }, [c]);

  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div className="detail-stats">
        <div><span>Orders</span><b>{c.count}</b></div>
        <div><span>Revenue</span><b>{money(c.revenue)}</b></div>
        <div><span>Avg order</span><b>{money(c.avgOrder)}</b></div>
        <div><span>Units</span><b>{fmt(c.units)}</b></div>
        <div><span>Customer since</span><b>{c.first ? prettyDate(c.first) : '—'}</b></div>
        <div><span>Last order</span><b>{c.last ? `${c.daysSince}d ago` : '—'}</b></div>
      </div>

      <div className={`predict-box predict-box--${p.state}`}>
        <div className="predict-title">
          <CalendarClock size={15} /> Next order forecast
          <span className={`pill ${STATE_META[p.state].cls}`}>{STATE_META[p.state].label}</span>
        </div>
        {p.next ? (
          <>
            <p>
              Expected <b>{relative(p.daysUntil)}</b>, around <b>{prettyDate(p.next)}</b> (±{p.window} days).
              Typically orders every <b>{p.interval} days</b> · {p.conf} confidence.
            </p>
            {p.state === 'lapsed' && (
              <p className="predict-warn"><AlertTriangle size={13} /> It's been much longer than their usual cycle — worth a call.</p>
            )}
            <div className="chip-row">
              {p.items.length === 0 && <span className="text-muted small">No item is bought regularly enough to predict.</span>}
              {p.items.map(it => (
                <span key={it.product} className="item-chip item-chip--out">{it.product} <b>×{it.qty}</b></span>
              ))}
            </div>
          </>
        ) : (
          <p>{c.count === 0
            ? 'No sales recorded for this customer yet.'
            : 'Only one order so far. A forecast needs at least two orders on different dates.'}</p>
        )}
      </div>

      {mix.length > 0 && (
        <div className="detail-block">
          <h4>What they buy</h4>
          {mix.map(m => (
            <div key={m.product} className="mix-row">
              <span className="mix-name">{m.product}</span>
              <div className="mix-bar"><i style={{ width: `${m.pct}%` }} /></div>
              <span className="mix-val">{fmt(m.qty)} <small>in {m.orders} {m.orders === 1 ? 'order' : 'orders'}</small></span>
            </div>
          ))}
        </div>
      )}

      {c.orders.length > 0 && (
        <div className="detail-block">
          <h4>Order history</h4>
          <div className="history">
            {[...c.orders].reverse().map(o => (
              <div key={o.date} className="history-row">
                <div className="history-top">
                  <span className="mono-cell">{prettyDate(o.date)}</span>
                  <span className="mono-cell">{o.revenue > 0 ? money(o.revenue) : '—'}</span>
                </div>
                <div className="chip-row">
                  {Object.entries(o.items).map(([prod, q]) => (
                    <span key={prod} className="item-chip item-chip--out">{prod} <b>×{q}</b></span>
                  ))}
                </div>
                <div className="history-foot">
                  {[...new Set(o.statuses)].join(' · ')}
                  {o.invoices.length > 0 && ` · ${o.invoices.join(', ')}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
