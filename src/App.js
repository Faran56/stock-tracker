import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  Plus, Upload, Trash2, Package, Users, TrendingDown,
  X, CheckCircle, Clock, Truck, AlertCircle,
  Download, RefreshCw, Edit2
} from 'lucide-react';
import './App.css';

// ─── helpers ────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString());
const uid = () => Math.random().toString(36).slice(2, 9);

const STATUS_META = {
  Delivered:  { color: 'var(--green)',  bg: 'var(--green-dim)', Icon: CheckCircle },
  Pending:    { color: 'var(--amber)',  bg: 'var(--amber-dim)', Icon: Clock },
  Processing: { color: 'var(--accent)', bg: 'var(--accent-dim)', Icon: RefreshCw },
  Cancelled:  { color: 'var(--red)',    bg: 'var(--red-dim)',  Icon: X },
};

const IN_STATUS_META = {
  Received:   { color: 'var(--green)',  bg: 'var(--green-dim)', Icon: CheckCircle },
  Pending:    { color: 'var(--amber)',  bg: 'var(--amber-dim)', Icon: Clock },
  Ordered:    { color: 'var(--accent)', bg: 'var(--accent-dim)', Icon: Truck },
  Cancelled:  { color: 'var(--red)',    bg: 'var(--red-dim)',  Icon: X },
};

function statusMetaFor(type) {
  return type === 'in' ? IN_STATUS_META : STATUS_META;
}

const INITIAL_PRODUCTS = ['211G', 'Bwm 303', 'Bwm 777'];

const SEED_ROWS = [
  { id: uid(), date: '2026-06-11', description: 'Opening Stock', type: 'in',  customer: '', qty: { '211G': 2, 'Bwm 303': 0, 'Bwm 777': 0 }, status: 'Received', memo: '' },
  { id: uid(), date: '2026-06-11', description: 'Received from Somicon', type: 'in',  customer: '', qty: { '211G': 31, 'Bwm 303': 24, 'Bwm 777': 5 }, status: 'Received', memo: '' },
  { id: uid(), date: '2026-06-11', description: 'Sale', type: 'out', customer: 'Matar Al Kutbi', qty: { '211G': 0, 'Bwm 303': 4, 'Bwm 777': 0 }, status: 'Delivered', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Omar Al Rahba', qty: { '211G': 10, 'Bwm 303': 0, 'Bwm 777': 0 }, status: 'Pending', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Sultan Al Habtoor', qty: { '211G': 5, 'Bwm 303': 0, 'Bwm 777': 0 }, status: 'Pending', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Omar Al Khazna', qty: { '211G': 0, 'Bwm 303': 3, 'Bwm 777': 0 }, status: 'Pending', memo: 'Pending cash for Filters' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Al Hadeel', qty: { '211G': 0, 'Bwm 303': 6, 'Bwm 777': 0 }, status: 'Pending', memo: 'Pending Water hardner' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Adill', qty: { '211G': 0, 'Bwm 303': 0, 'Bwm 777': 20 }, status: 'Pending', memo: '' },
];

// ─── load / save ─────────────────────────────────────────────────────────────
function loadState() {
  try {
    const s = localStorage.getItem('stock_v2');
    if (s) return JSON.parse(s);
  } catch {}
  return { products: INITIAL_PRODUCTS, rows: SEED_ROWS, customers: [] };
}
function saveState(state) {
  localStorage.setItem('stock_v2', JSON.stringify(state));
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(loadState);
  const { products, rows, customers } = state;

  const [showAddRow, setShowAddRow]   = useState(false);
  const [showAddProd, setShowAddProd] = useState(false);
  const [showUpload, setShowUpload]   = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterProduct, setFilterProduct] = useState('All');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  // form state
  const [form, setForm] = useState(() => buildEmptyForm(INITIAL_PRODUCTS));
  const [newProd, setNewProd] = useState('');

  useEffect(() => { saveState(state); }, [state]);

  function buildEmptyForm(prods) {
    const qty = {};
    prods.forEach(p => (qty[p] = ''));
    return { date: today(), description: 'Sale', type: 'out', customer: '', qty, status: 'Pending', memo: '' };
  }

  function buildFormFromRow(row, prods) {
    const qty = {};
    prods.forEach(p => (qty[p] = row.qty?.[p] || ''));
    return { ...row, qty };
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── computed balances ──────────────────────────────────────────────────────
  const balance = useCallback(() => {
    const b = {};
    products.forEach(p => (b[p] = 0));
    rows.forEach(r => {
      products.forEach(p => {
        const v = Number(r.qty?.[p] || 0);
        b[p] += r.type === 'in' ? v : -v;
      });
    });
    return b;
  }, [rows, products]);

  const totals = balance();

  // ── filters ────────────────────────────────────────────────────────────────
  const visible = rows.filter(r => {
    if (filterStatus !== 'All' && r.status !== filterStatus) return false;
    if (filterProduct !== 'All' && !Number(r.qty?.[filterProduct])) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.customer?.toLowerCase().includes(q) && !r.description?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── add / edit row ─────────────────────────────────────────────────────────
  function submitRow() {
    const cleanQty = {};
    products.forEach(p => (cleanQty[p] = Number(form.qty[p]) || 0));

    if (editingId) {
      setState(s => ({
        ...s,
        rows: s.rows.map(r => r.id === editingId ? { ...form, qty: cleanQty, id: editingId } : r),
      }));
      showToast('Transaction updated');
    } else {
      const row = { ...form, qty: cleanQty, id: uid() };
      setState(s => ({ ...s, rows: [...s.rows, row] }));
      showToast('Transaction added');
    }

    setForm(buildEmptyForm(products));
    setEditingId(null);
    setShowAddRow(false);
  }

  function openAddRow() {
    setForm(buildEmptyForm(products));
    setEditingId(null);
    setShowAddRow(true);
  }

  function openEditRow(row) {
    setForm(buildFormFromRow(row, products));
    setEditingId(row.id);
    setShowAddRow(true);
  }

  // ── delete row ─────────────────────────────────────────────────────────────
  function deleteRow(id) {
    setState(s => ({ ...s, rows: s.rows.filter(r => r.id !== id) }));
    showToast('Row deleted', 'warn');
  }

  // ── update status inline ───────────────────────────────────────────────────
  function setStatus(id, status) {
    setState(s => ({ ...s, rows: s.rows.map(r => r.id === id ? { ...r, status } : r) }));
  }

  // ── add product column ─────────────────────────────────────────────────────
  function addProduct() {
    const name = newProd.trim();
    if (!name || products.includes(name)) return;
    setState(s => ({
      ...s,
      products: [...s.products, name],
      rows: s.rows.map(r => ({ ...r, qty: { ...r.qty, [name]: 0 } })),
    }));
    setNewProd('');
    setShowAddProd(false);
    showToast(`Product "${name}" added`);
  }

  // ── customer file upload ───────────────────────────────────────────────────
  function handleCustomerFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      Papa.parse(file, {
        complete: (res) => {
          const names = res.data.flat().map(c => String(c).trim()).filter(Boolean);
          setState(s => ({ ...s, customers: [...new Set([...s.customers, ...names])] }));
          showToast(`${names.length} customers loaded`);
          setShowUpload(false);
        },
      });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const names = data.flat().map(c => String(c).trim()).filter(Boolean);
        setState(s => ({ ...s, customers: [...new Set([...s.customers, ...names])] }));
        showToast(`${names.length} customers loaded`);
        setShowUpload(false);
      };
      reader.readAsBinaryString(file);
    }
  }

  // ── export ─────────────────────────────────────────────────────────────────
  function exportXLSX() {
    const data = rows.map(r => {
      const obj = { Date: r.date, Description: r.description, Type: r.type, Customer: r.customer };
      products.forEach(p => (obj[p] = r.type === 'out' ? -(r.qty[p] || 0) : (r.qty[p] || 0)));
      obj.Status = r.status;
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    XLSX.writeFile(wb, `stock_${today()}.xlsx`);
    showToast('Exported to Excel');
  }

  // ── summary cards ──────────────────────────────────────────────────────────
  const pendingCount = rows.filter(r => r.status === 'Pending').length;
  const totalOut = rows.filter(r => r.type === 'out').reduce((acc, r) => {
    products.forEach(p => (acc[p] = (acc[p] || 0) + (r.qty[p] || 0)));
    return acc;
  }, {});

  return (
    <div className="app">
      {/* ── header ── */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-mark"><Package size={20} /></div>
          <div>
            <h1>Stock Tracker</h1>
            <p className="header-sub">Water Treatment Products · UAE</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setShowUpload(true)}>
            <Users size={15} /> Customers
            {customers.length > 0 && <span className="chip">{customers.length}</span>}
          </button>
          <button className="btn btn-ghost" onClick={exportXLSX}>
            <Download size={15} /> Export
          </button>
          <button className="btn btn-accent" onClick={openAddRow}>
            <Plus size={15} /> Add Transaction
          </button>
        </div>
      </header>

      {/* ── summary strip ── */}
      <div className="summary-strip">
        {products.map(p => (
          <div key={p} className="summary-card">
            <div className="sc-label">{p}</div>
            <div className={`sc-balance ${totals[p] < 0 ? 'neg' : totals[p] === 0 ? 'zero' : ''}`}>
              {fmt(totals[p])}
            </div>
            <div className="sc-sub">
              <TrendingDown size={11} /> {fmt(totalOut[p] || 0)} sold
            </div>
          </div>
        ))}
        <div className="summary-card summary-card--stat">
          <div className="sc-label">Pending Orders</div>
          <div className="sc-balance amber">{pendingCount}</div>
          <div className="sc-sub"><Clock size={11} /> awaiting delivery</div>
        </div>
        <button className="add-product-card" onClick={() => setShowAddProd(true)}>
          <Plus size={18} />
          <span>Add Product</span>
        </button>
      </div>

      {/* ── filters ── */}
      <div className="filters-bar">
        <input
          className="search-input"
          placeholder="Search customer or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="filter-group">
          <span className="filter-label">Status</span>
          {['All', ...new Set([...Object.keys(STATUS_META), ...Object.keys(IN_STATUS_META)])].map(s => (
            <button
              key={s}
              className={`filter-pill ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilterStatus(s)}
            >{s}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Product</span>
          {['All', ...products].map(p => (
            <button
              key={p}
              className={`filter-pill ${filterProduct === p ? 'active' : ''}`}
              onClick={() => setFilterProduct(p)}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* ── table ── */}
      <div className="table-wrap">
        <table className="stock-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Customer</th>
              {products.map(p => <th key={p} className="num-col">{p}</th>)}
              <th>Memo</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={products.length + 6} className="empty-state">No records match your filters.</td></tr>
            )}
            {visible.map(row => {
              const isOut = row.type === 'out';
              return (
                <tr key={row.id} className={isOut ? 'row-out' : 'row-in'}>
                  <td className="mono-cell">{row.date}</td>
                  <td>{row.description}</td>
                  <td className="customer-cell">{row.customer || <span className="text-muted">—</span>}</td>
                  {products.map(p => {
                    const v = row.qty?.[p] || 0;
                    return (
                      <td key={p} className="num-col">
                        {v !== 0 ? (
                          <span className={isOut ? 'qty-out' : 'qty-in'}>
                            {isOut ? '-' : '+'}{v}
                          </span>
                        ) : <span className="text-muted">—</span>}
                      </td>
                    );
                  })}
                  <td className="memo-cell">{row.memo || <span className="text-muted">—</span>}</td>
                  <td>
                    <select
                      className="status-select"
                      value={row.status || ''}
                      onChange={e => setStatus(row.id, e.target.value)}
                      style={{ color: statusMetaFor(row.type)[row.status]?.color || 'var(--text-muted)' }}
                    >
                      <option value="">—</option>
                      {Object.keys(statusMetaFor(row.type)).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => openEditRow(row)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="icon-btn danger" onClick={() => deleteRow(row.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* totals footer */}
          <tfoot>
            <tr className="totals-row">
              <td colSpan={3}>Balance</td>
              {products.map(p => (
                <td key={p} className={`num-col total-cell ${totals[p] < 0 ? 'neg' : ''}`}>
                  {fmt(totals[p])}
                </td>
              ))}
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Add/Edit Transaction Modal ── */}
      {showAddRow && (
        <Modal title={editingId ? 'Edit Transaction' : 'Add Transaction'} onClose={() => { setShowAddRow(false); setEditingId(null); }}>
          <div className="form-grid">
            <label>Date
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </label>
            <label>Type
              <select
                value={form.type}
                onChange={e => {
                  const newType = e.target.value;
                  const validStatuses = Object.keys(statusMetaFor(newType));
                  setForm(f => ({
                    ...f,
                    type: newType,
                    status: validStatuses.includes(f.status) ? f.status : validStatuses[1] || validStatuses[0],
                  }));
                }}
              >
                <option value="in">Stock In</option>
                <option value="out">Stock Out (Sale)</option>
              </select>
            </label>
            <label className="span2">Description
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            {form.type === 'out' && (
              <label className="span2">Customer
                <select value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))}>
                  <option value="">— select or type —</option>
                  {customers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            {products.map(p => (
              <label key={p}>{p}
                <input
                  type="number" min="0"
                  placeholder="0"
                  value={form.qty[p]}
                  onChange={e => setForm(f => ({ ...f, qty: { ...f.qty, [p]: e.target.value } }))}
                />
              </label>
            ))}
            <label className="span2">Status
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {Object.keys(statusMetaFor(form.type)).map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="span2">Memo / Notes
              <input
                value={form.memo || ''}
                placeholder="e.g. Pending cash for filters"
                onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => { setShowAddRow(false); setEditingId(null); }}>Cancel</button>
            <button className="btn btn-accent" onClick={submitRow}>
              {editingId ? <><CheckCircle size={14} /> Save Changes</> : <><Plus size={14} /> Add</>}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Add Product Modal ── */}
      {showAddProd && (
        <Modal title="Add Product Column" onClose={() => setShowAddProd(false)}>
          <label>Product / SKU name
            <input
              value={newProd}
              onChange={e => setNewProd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProduct()}
              placeholder="e.g. Bwm 999"
              autoFocus
            />
          </label>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddProd(false)}>Cancel</button>
            <button className="btn btn-accent" onClick={addProduct}><Plus size={14} /> Add Column</button>
          </div>
        </Modal>
      )}

      {/* ── Upload Customers Modal ── */}
      {showUpload && (
        <Modal title="Upload Customer List" onClose={() => setShowUpload(false)}>
          <div className="upload-zone">
            <Upload size={32} color="var(--accent)" />
            <p>Upload a CSV or Excel file with one customer name per row/column.</p>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleCustomerFile} />
          </div>
          {customers.length > 0 && (
            <div className="customer-preview">
              <p className="preview-label">{customers.length} customers loaded</p>
              <div className="customer-chips">
                {customers.slice(0, 20).map(c => <span key={c} className="cust-chip">{c}</span>)}
                {customers.length > 20 && <span className="cust-chip muted">+{customers.length - 20} more</span>}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
                onClick={() => setState(s => ({ ...s, customers: [] }))}>
                Clear list
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.type === 'warn' ? 'toast-warn' : ''}`}>
          {toast.type !== 'warn' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
