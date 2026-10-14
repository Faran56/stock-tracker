import React, { useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Plus, Search, Trash2, Edit2, FileText, Truck, X, ClipboardList, AlertTriangle,
} from 'lucide-react';
import { Modal, SearchableSelect } from './ui';
import {
  fmt, money, localToday, daysBetween, prettyDate, orderTotals, nextOrderNo, DEFAULT_CATEGORY,
} from './utils';

const STATUS_CLS = {
  Draft: 'pill-grey', Confirmed: 'pill-blue', Delivered: 'pill-green', Cancelled: 'pill-red',
};
const isOpen = (o) => o.status === 'Draft' || o.status === 'Confirmed';

// ─── PDF ─────────────────────────────────────────────────────────────────────
export function exportOrderPDF(order, settings) {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();
  const { subtotal, vat, total } = orderTotals(order, settings.vat);

  doc.setFillColor(20, 33, 43);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255);
  doc.setFontSize(16);
  doc.text(settings.company || 'Sales Order', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(190, 205, 212);
  doc.text('Water Treatment Products · UAE', 14, 21);
  doc.setFontSize(18);
  doc.setTextColor(255);
  doc.text('SALES ORDER', W - 14, 15, { align: 'right' });
  doc.setFontSize(10);
  doc.text(order.no, W - 14, 22, { align: 'right' });

  doc.setTextColor(20, 33, 43);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('CUSTOMER', 14, 42);
  doc.text('ORDER DATE', 110, 42);
  doc.text('DELIVERY DATE', 150, 42);
  doc.setFontSize(11);
  doc.setTextColor(20, 33, 43);
  doc.text(order.customer || '—', 14, 48);
  doc.text(prettyDate(order.date), 110, 48);
  doc.text(order.dueDate ? prettyDate(order.dueDate) : '—', 150, 48);
  if (order.ref) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Customer ref: ${order.ref}`, 14, 55);
  }

  autoTable(doc, {
    startY: 62,
    head: [['#', 'Item', 'Qty', 'Unit price (AED)', 'Amount (AED)']],
    body: order.lines.map((l, idx) => [
      idx + 1, l.product, fmt(l.qty),
      Number(l.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      ((Number(l.qty) || 0) * (Number(l.price) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]),
    styles: { fontSize: 9.5, cellPadding: 3.2 },
    headStyles: { fillColor: [14, 124, 134] },
    alternateRowStyles: { fillColor: [244, 247, 246] },
    columnStyles: { 0: { cellWidth: 12 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  let y = doc.lastAutoTable.finalY + 8;
  const line = (label, value, bold) => {
    doc.setFontSize(bold ? 11 : 10);
    doc.setTextColor(bold ? 20 : 90, bold ? 33 : 100, bold ? 43 : 110);
    doc.text(label, W - 70, y);
    doc.text(value, W - 14, y, { align: 'right' });
    y += bold ? 8 : 6.5;
  };
  const f2 = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  line('Subtotal', `AED ${f2(subtotal)}`);
  if (order.vat) line(`VAT ${settings.vat}%`, `AED ${f2(vat)}`);
  line('Total', `AED ${f2(total)}`, true);

  if (order.notes) {
    y += 4;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text('NOTES', 14, y);
    doc.setFontSize(10);
    doc.setTextColor(20, 33, 43);
    doc.text(doc.splitTextToSize(order.notes, W - 28), 14, y + 6);
  }

  const sigY = doc.internal.pageSize.getHeight() - 30;
  doc.setDrawColor(180);
  doc.line(14, sigY, 80, sigY);
  doc.line(W - 80, sigY, W - 14, sigY);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('Prepared by', 14, sigY + 5);
  doc.text('Received by (name, signature, date)', W - 80, sigY + 5);

  doc.save(`${order.no}.pdf`);
}

// ─── page ────────────────────────────────────────────────────────────────────
export default function SalesOrders({
  orders, customers, products, itemDefaults, categories, stock, settings,
  onSave, onDelete, onDeliver, onAddCustomer,
}) {
  const today = localToday();
  const [statusFilter, setStatusFilter] = useState('Open');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(null); // order being created / edited
  const [error, setError] = useState('');

  const withTotals = useMemo(
    () => orders.map(o => ({ ...o, t: orderTotals(o, settings.vat) })),
    [orders, settings.vat]
  );

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withTotals
      .filter(o => {
        if (statusFilter === 'Open' && !isOpen(o)) return false;
        if (statusFilter !== 'Open' && statusFilter !== 'All' && o.status !== statusFilter) return false;
        if (q && !`${o.no} ${o.customer} ${o.ref || ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.no.localeCompare(a.no));
  }, [withTotals, statusFilter, search]);

  const open = withTotals.filter(isOpen);
  const openValue = open.reduce((s, o) => s + o.t.total, 0);
  const overdue = open.filter(o => o.dueDate && o.dueDate < today);
  const dueSoon = open.filter(o => o.dueDate && o.dueDate >= today && daysBetween(today, o.dueDate) <= 7);
  const month = today.slice(0, 7);
  const deliveredMonth = withTotals
    .filter(o => o.status === 'Delivered' && (o.deliveredOn || '').slice(0, 7) === month)
    .reduce((s, o) => s + o.t.total, 0);

  // stock already promised to other confirmed orders
  function committed(exceptId) {
    const c = {};
    orders.forEach(o => {
      if (o.status !== 'Confirmed' || o.id === exceptId) return;
      o.lines.forEach(l => { c[l.product] = (c[l.product] || 0) + (Number(l.qty) || 0); });
    });
    return c;
  }

  function newOrder() {
    setError('');
    setDraft({
      id: null, no: nextOrderNo(orders), date: today, dueDate: '', customer: '', ref: '',
      status: 'Confirmed', lines: [{ product: '', qty: '', price: '' }], vat: true, notes: '',
    });
  }
  function editOrder(o) {
    setError('');
    setDraft({ ...o, lines: o.lines.map(l => ({ ...l })) });
  }

  function setLine(idx, patch) {
    setDraft(d => ({ ...d, lines: d.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  }
  function pickProduct(idx, product) {
    const def = itemDefaults?.[product]?.price;
    setDraft(d => ({
      ...d,
      lines: d.lines.map((l, i) => (i === idx ? { ...l, product, price: l.price === '' || l.price == null ? (def || '') : l.price } : l)),
    }));
  }

  function save() {
    const customer = (draft.customer || '').trim();
    const lines = draft.lines
      .filter(l => l.product && Number(l.qty) > 0)
      .map(l => ({ product: l.product, qty: Number(l.qty), price: Number(l.price) || 0 }));
    if (!customer) { setError('Choose or type a customer.'); return; }
    if (lines.length === 0) { setError('Add at least one item with a quantity.'); return; }
    onSave({ ...draft, customer, lines });
    setDraft(null);
  }

  const dTotals = draft ? orderTotals(
    { ...draft, lines: draft.lines.map(l => ({ qty: l.qty, price: l.price })) }, settings.vat
  ) : null;
  const dCommitted = draft ? committed(draft.id) : {};

  // products grouped by category for the line selector
  const grouped = useMemo(() => {
    const g = {};
    products.forEach(p => {
      const c = itemDefaults?.[p]?.category || DEFAULT_CATEGORY;
      (g[c] = g[c] || []).push(p);
    });
    const order = [...categories.filter(c => g[c]), ...Object.keys(g).filter(c => !categories.includes(c))];
    return order.map(c => ({ category: c, items: g[c] }));
  }, [products, itemDefaults, categories]);

  return (
    <div className="page orders-page">
      <div className="page-head">
        <div>
          <h2>Sales Orders</h2>
          <p className="page-sub">
            Record what customers have ordered before it leaves the warehouse. When an order is delivered it becomes a
            stock-out sale automatically, so stock and reports stay accurate.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-accent" onClick={newOrder}><Plus size={15} /> New Order</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Open orders</span>
          <b className="stat-value">{open.length}</b>
          <span className="stat-sub">draft or confirmed</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open value</span>
          <b className="stat-value stat-value--sm">{money(openValue)}</b>
          <span className="stat-sub">{settings.vat > 0 ? 'incl. VAT where applied' : 'total'}</span>
        </div>
        <div className={`stat-card ${overdue.length ? 'stat-card--danger' : dueSoon.length ? 'stat-card--warn' : ''}`}>
          <span className="stat-label">{overdue.length ? 'Overdue' : 'Due in 7 days'}</span>
          <b className="stat-value">{overdue.length || dueSoon.length}</b>
          <span className="stat-sub">{overdue.length ? 'past delivery date' : 'to deliver soon'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Delivered this month</span>
          <b className="stat-value stat-value--sm">{money(deliveredMonth)}</b>
          <span className="stat-sub">order value</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrap grow">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Search order #, customer, reference…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="seg">
          {['Open', 'Delivered', 'Cancelled', 'All'].map(s => (
            <button key={s} className={statusFilter === s ? 'active' : ''} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="gt so-gt">
        <div className="gt-head">
          <div className="gt-h">Order</div>
          <div className="gt-h">Customer</div>
          <div className="gt-h">Dates</div>
          <div className="gt-h">Items</div>
          <div className="gt-h gt-num">Total</div>
          <div className="gt-h">Status</div>
          <div className="gt-h"></div>
        </div>

        {list.length === 0 && (
          <div className="empty-state">
            <ClipboardList size={30} />
            <p>{orders.length === 0 ? 'No sales orders yet. Create your first one.' : 'No orders match this view.'}</p>
          </div>
        )}

        {list.map(o => {
          const late = isOpen(o) && o.dueDate && o.dueDate < today;
          return (
            <div key={o.id} className="gt-row so-row">
              <div className="gt-cell gt-title"><span className="item-name mono-name">{o.no}</span></div>
              <div className="gt-cell" data-label="Customer">
                <div className="item-name">{o.customer}</div>
                {o.ref && <div className="text-muted small">Ref {o.ref}</div>}
              </div>
              <div className="gt-cell" data-label="Dates">
                <div className="small">{prettyDate(o.date)}</div>
                <div className={`small ${late ? 'neg-text' : 'text-muted'}`}>
                  {o.dueDate ? `Due ${prettyDate(o.dueDate)}${late ? ' · overdue' : ''}` : 'No delivery date'}
                </div>
              </div>
              <div className="gt-cell" data-label="Items">
                <div className="chip-row">
                  {o.lines.slice(0, 3).map(l => (
                    <span key={l.product} className="item-chip item-chip--out">{l.product} <b>×{l.qty}</b></span>
                  ))}
                  {o.lines.length > 3 && <span className="item-chip item-chip--more">+{o.lines.length - 3}</span>}
                </div>
              </div>
              <div className="gt-cell gt-num" data-label="Total"><span className="mono-cell strong">{money(o.t.total)}</span></div>
              <div className="gt-cell" data-label="Status">
                <span className={`pill pill-flat ${STATUS_CLS[o.status]}`}>{o.status}</span>
              </div>
              <div className="gt-cell gt-actions so-actions">
                {isOpen(o) && (
                  <button className="icon-btn ok" title="Mark delivered (creates a stock-out sale)" aria-label="Mark delivered" onClick={() => onDeliver(o)}>
                    <Truck size={16} />
                  </button>
                )}
                <button className="icon-btn" title="Download PDF" aria-label="Download PDF" onClick={() => exportOrderPDF(o, settings)}><FileText size={16} /></button>
                {isOpen(o) && (
                  <button className="icon-btn" title="Edit" aria-label="Edit order" onClick={() => editOrder(o)}><Edit2 size={16} /></button>
                )}
                <button className="icon-btn danger" title="Delete" aria-label="Delete order" onClick={() => onDelete(o)}><Trash2 size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <Modal title={draft.id ? `Edit ${draft.no}` : `New sales order · ${draft.no}`} onClose={() => setDraft(null)} wide>
          <div className="form-grid">
            <label className="span2">Customer
              <SearchableSelect
                value={draft.customer}
                onChange={v => setDraft(d => ({ ...d, customer: v }))}
                onCreate={onAddCustomer}
                options={customers}
                placeholder="Search or type a customer name…"
              />
            </label>
            <label>Order date
              <input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
            </label>
            <label>Delivery date
              <input type="date" value={draft.dueDate || ''} onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))} />
            </label>
            <label>Customer reference / LPO
              <input value={draft.ref || ''} onChange={e => setDraft(d => ({ ...d, ref: e.target.value }))} placeholder="Optional" />
            </label>
            <label>Status
              <select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
                {['Draft', 'Confirmed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="so-lines">
            <div className="so-lines-head"><span>Item</span><span>Qty</span><span>Price (AED)</span><span className="r">Amount</span><span /></div>
            {draft.lines.map((l, idx) => {
              const avail = l.product ? (stock.balance[l.product] || 0) - (dCommitted[l.product] || 0) : null;
              const short = avail != null && Number(l.qty) > avail;
              return (
                <div key={idx} className="so-line">
                  <select value={l.product} onChange={e => pickProduct(idx, e.target.value)}>
                    <option value="">Select item…</option>
                    {grouped.map(g => (
                      <optgroup key={g.category} label={g.category}>
                        {g.items.map(p => <option key={p} value={p}>{p}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <input type="number" min="0" inputMode="numeric" placeholder="0" value={l.qty} onChange={e => setLine(idx, { qty: e.target.value })} />
                  <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.price} onChange={e => setLine(idx, { price: e.target.value })} />
                  <span className="so-amount">{money((Number(l.qty) || 0) * (Number(l.price) || 0))}</span>
                  <button className="icon-btn danger" aria-label="Remove line" disabled={draft.lines.length === 1}
                    onClick={() => setDraft(d => ({ ...d, lines: d.lines.filter((_, i) => i !== idx) }))}><X size={15} /></button>
                  {l.product && (
                    <div className={`so-avail ${short ? 'warn' : ''}`}>
                      {short && <AlertTriangle size={11} />} Available to promise: {fmt(avail)}
                      {short ? ' — not enough stock yet' : ''}
                    </div>
                  )}
                </div>
              );
            })}
            <button className="btn btn-ghost btn-sm add-line" onClick={() => setDraft(d => ({ ...d, lines: [...d.lines, { product: '', qty: '', price: '' }] }))}>
              <Plus size={13} /> Add item
            </button>
          </div>

          <div className="so-summary">
            <label className="check">
              <input type="checkbox" checked={!!draft.vat} onChange={e => setDraft(d => ({ ...d, vat: e.target.checked }))} />
              Add VAT ({settings.vat}%)
            </label>
            <div className="so-totals">
              <div><span>Subtotal</span><b>{money(dTotals.subtotal)}</b></div>
              {draft.vat && <div><span>VAT {settings.vat}%</span><b>{money(dTotals.vat)}</b></div>}
              <div className="grand"><span>Total</span><b>{money(dTotals.total)}</b></div>
            </div>
          </div>

          <label className="stack-label">Notes
            <textarea rows={2} value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Delivery instructions, payment terms…" />
          </label>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-accent" onClick={save}>{draft.id ? 'Save changes' : 'Create order'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
