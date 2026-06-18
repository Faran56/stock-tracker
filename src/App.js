import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Plus, Upload, Trash2, Package, Users, TrendingDown,
  X, CheckCircle, Clock, Truck, AlertCircle,
  Download, RefreshCw, Edit2, ArrowUp, ArrowDown, ArrowUpDown,
  FileText, Truck as TruckIcon, BarChart3, ListChecks,
} from 'lucide-react';
import Reports from './Reports';
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
  { id: uid(), date: '2026-06-11', description: 'Opening Stock', type: 'in',  customer: '', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 2, 'Bwm 303': 0, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Received', memo: '' },
  { id: uid(), date: '2026-06-11', description: 'Received from Somicon', type: 'in',  customer: '', supplier: 'Somicon', invoiceNo: '', deliveryNo: '', qty: { '211G': 31, 'Bwm 303': 24, 'Bwm 777': 5 }, price: {}, cost: {}, status: 'Received', memo: '' },
  { id: uid(), date: '2026-06-11', description: 'Sale', type: 'out', customer: 'Matar Al Kutbi', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 0, 'Bwm 303': 4, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Delivered', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Omar Al Rahba', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 10, 'Bwm 303': 0, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Pending', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Sultan Al Habtoor', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 5, 'Bwm 303': 0, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Pending', memo: '' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Omar Al Khazna', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 0, 'Bwm 303': 3, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Pending', memo: 'Pending cash for Filters' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Al Hadeel', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 0, 'Bwm 303': 6, 'Bwm 777': 0 }, price: {}, cost: {}, status: 'Pending', memo: 'Pending Water hardner' },
  { id: uid(), date: '2026-06-12', description: 'Sale', type: 'out', customer: 'Adill', supplier: '', invoiceNo: '', deliveryNo: '', qty: { '211G': 0, 'Bwm 303': 0, 'Bwm 777': 20 }, price: {}, cost: {}, status: 'Pending', memo: '' },
];

// ─── load / save ─────────────────────────────────────────────────────────────
function loadState() {
  try {
    const s = localStorage.getItem('stock_v3');
    if (s) return JSON.parse(s);
    // migrate from v2 if present
    const old = localStorage.getItem('stock_v2');
    if (old) {
      const parsed = JSON.parse(old);
      const rows = (parsed.rows || []).map(r => ({
        supplier: '', invoiceNo: '', deliveryNo: '', price: {}, cost: {}, ...r,
      }));
      return { ...parsed, rows, suppliers: [] };
    }
  } catch {}
  return { products: INITIAL_PRODUCTS, rows: SEED_ROWS, customers: [], suppliers: [] };
}
function saveState(state) {
  localStorage.setItem('stock_v3', JSON.stringify(state));
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal-box ${wide ? 'modal-box--wide' : ''}`} onClick={e => e.stopPropagation()}>
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
  const { products, rows, customers, suppliers } = state;

  const [activeTab, setActiveTab] = useState('tracker'); // tracker | suppliers | reports

  const [showAddRow, setShowAddRow]   = useState(false);
  const [showAddProd, setShowAddProd] = useState(false);
  const [showUpload, setShowUpload]   = useState(false);
  const [showSupplierUpload, setShowSupplierUpload] = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterProduct, setFilterProduct] = useState('All');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [newSupplier, setNewSupplier] = useState('');

  // form state
  const [form, setForm] = useState(() => buildEmptyForm(INITIAL_PRODUCTS));
  const [newProd, setNewProd] = useState('');

  useEffect(() => { saveState(state); }, [state]);

  function buildEmptyForm(prods) {
    const qty = {}, price = {}, cost = {};
    prods.forEach(p => { qty[p] = ''; price[p] = ''; cost[p] = ''; });
    return {
      date: today(), description: 'Sale', type: 'out', customer: '', supplier: '',
      invoiceNo: '', deliveryNo: '', qty, price, cost, status: 'Pending', memo: '',
    };
  }

  function buildFormFromRow(row, prods) {
    const qty = {}, price = {}, cost = {};
    prods.forEach(p => {
      qty[p] = row.qty?.[p] || '';
      price[p] = row.price?.[p] || '';
      cost[p] = row.cost?.[p] || '';
    });
    return { ...row, qty, price, cost };
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── computed balances ──────────────────────────────────────────────────────
  function computeBalance() {
    const b = {};
    products.forEach(p => (b[p] = 0));
    rows.forEach(r => {
      products.forEach(p => {
        const v = Number(r.qty?.[p] || 0);
        b[p] += r.type === 'in' ? v : -v;
      });
    });
    return b;
  }
  const totals = computeBalance();

  // ── filters ────────────────────────────────────────────────────────────────
  const filtered = rows.filter(r => {
    if (filterStatus !== 'All' && r.status !== filterStatus) return false;
    if (filterProduct !== 'All' && !Number(r.qty?.[filterProduct])) return false;
    if (search) {
      const q = search.toLowerCase();
      const hit = [r.customer, r.supplier, r.description, r.invoiceNo, r.deliveryNo, r.memo]
        .some(f => (f || '').toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });

  // ── sorting ────────────────────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  function sortIcon(col) {
    if (sortBy !== col) return <ArrowUpDown size={12} className="sort-icon" />;
    return sortDir === 'asc'
      ? <ArrowUp size={12} className="sort-icon active" />
      : <ArrowDown size={12} className="sort-icon active" />;
  }

  const visible = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortBy === 'date') { av = a.date || ''; bv = b.date || ''; }
    else if (sortBy === 'customer') { av = (a.customer || a.supplier || '').toLowerCase(); bv = (b.customer || b.supplier || '').toLowerCase(); }
    else if (sortBy === 'status') { av = (a.status || '').toLowerCase(); bv = (b.status || '').toLowerCase(); }
    else if (sortBy === 'description') { av = (a.description || '').toLowerCase(); bv = (b.description || '').toLowerCase(); }
    else { av = ''; bv = ''; }

    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // ── add / edit row ─────────────────────────────────────────────────────────
  function submitRow() {
    const cleanQty = {}, cleanPrice = {}, cleanCost = {};
    products.forEach(p => {
      cleanQty[p] = Number(form.qty[p]) || 0;
      cleanPrice[p] = Number(form.price[p]) || 0;
      cleanCost[p] = Number(form.cost[p]) || 0;
    });

    if (editingId) {
      setState(s => ({
        ...s,
        rows: s.rows.map(r => r.id === editingId
          ? { ...form, qty: cleanQty, price: cleanPrice, cost: cleanCost, id: editingId }
          : r),
      }));
      showToast('Transaction updated');
    } else {
      const row = { ...form, qty: cleanQty, price: cleanPrice, cost: cleanCost, id: uid() };
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
      rows: s.rows.map(r => ({
        ...r,
        qty: { ...r.qty, [name]: 0 },
        price: { ...r.price, [name]: 0 },
        cost: { ...r.cost, [name]: 0 },
      })),
    }));
    setNewProd('');
    setShowAddProd(false);
    showToast(`Product "${name}" added`);
  }

  // ── customer file upload ───────────────────────────────────────────────────
  function parseNamesFromFile(file, onDone) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      Papa.parse(file, {
        complete: (res) => {
          const names = res.data.flat().map(c => String(c).trim()).filter(Boolean);
          onDone(names);
        },
      });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const names = data.flat().map(c => String(c).trim()).filter(Boolean);
        onDone(names);
      };
      reader.readAsBinaryString(file);
    }
  }

  function handleCustomerFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    parseNamesFromFile(file, (names) => {
      setState(s => ({ ...s, customers: [...new Set([...s.customers, ...names])] }));
      showToast(`${names.length} customers loaded`);
      setShowUpload(false);
    });
  }

  function handleSupplierFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    parseNamesFromFile(file, (names) => {
      setState(s => ({ ...s, suppliers: [...new Set([...s.suppliers, ...names])] }));
      showToast(`${names.length} suppliers loaded`);
      setShowSupplierUpload(false);
    });
  }

  function addSupplierManual() {
    const name = newSupplier.trim();
    if (!name || suppliers.includes(name)) return;
    setState(s => ({ ...s, suppliers: [...s.suppliers, name] }));
    setNewSupplier('');
    showToast(`Supplier "${name}" added`);
  }

  function removeSupplier(name) {
    setState(s => ({ ...s, suppliers: s.suppliers.filter(x => x !== name) }));
  }

  // ── export ─────────────────────────────────────────────────────────────────
  function exportXLSX() {
    const data = rows.map(r => {
      const obj = {
        Date: r.date, Description: r.description, Type: r.type,
        Customer: r.customer, Supplier: r.supplier,
        'Invoice #': r.invoiceNo, 'Delivery #': r.deliveryNo,
      };
      products.forEach(p => (obj[p] = r.type === 'out' ? -(r.qty[p] || 0) : (r.qty[p] || 0)));
      obj.Status = r.status;
      obj.Memo = r.memo || '';
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    XLSX.writeFile(wb, `stock_${today()}.xlsx`);
    showToast('Exported to Excel');
  }

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Stock Tracking Report', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${today()}`, 14, 22);

    const head = [['Date', 'Description', 'Customer/Supplier', 'Invoice#', 'Delivery#', ...products, 'Memo', 'Status']];
    const body = visible.map(r => [
      r.date,
      r.description,
      r.customer || r.supplier || '—',
      r.invoiceNo || '—',
      r.deliveryNo || '—',
      ...products.map(p => {
        const v = r.qty?.[p] || 0;
        if (!v) return '—';
        return r.type === 'out' ? `-${v}` : `+${v}`;
      }),
      r.memo || '—',
      r.status || '—',
    ]);

    autoTable(doc, {
      head, body,
      startY: 28,
      styles: { fontSize: 7, cellPadding: 2.5 },
      headStyles: { fillColor: [79, 125, 255] },
      alternateRowStyles: { fillColor: [245, 246, 250] },
    });

    const finalY = doc.lastAutoTable.finalY || 28;
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Balance:', 14, finalY + 10);
    let x = 40;
    products.forEach(p => {
      doc.text(`${p}: ${fmt(totals[p])}`, x, finalY + 10);
      x += 40;
    });

    doc.save(`stock_${today()}.pdf`);
    showToast('Exported to PDF');
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
            <h1>Hello Faran @ Super Quality Stock Tracking</h1>
            <p className="header-sub">Water Treatment Products · UAE</p>
          </div>
        </div>
        {activeTab === 'tracker' && (
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={() => setShowUpload(true)}>
              <Users size={15} /> Customers
              {customers.length > 0 && <span className="chip">{customers.length}</span>}
            </button>
            <button className="btn btn-ghost" onClick={exportXLSX}>
              <Download size={15} /> Excel
            </button>
            <button className="btn btn-ghost" onClick={exportPDF}>
              <FileText size={15} /> PDF
            </button>
            <button className="btn btn-accent" onClick={openAddRow}>
              <Plus size={15} /> Add Transaction
            </button>
          </div>
        )}
      </header>

      {/* ── tab nav ── */}
      <div className="tab-nav">
        <button className={`tab-btn ${activeTab === 'tracker' ? 'active' : ''}`} onClick={() => setActiveTab('tracker')}>
          <ListChecks size={15} /> Tracker
        </button>
        <button className={`tab-btn ${activeTab === 'suppliers' ? 'active' : ''}`} onClick={() => setActiveTab('suppliers')}>
          <TruckIcon size={15} /> Suppliers
          {suppliers.length > 0 && <span className="chip">{suppliers.length}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
          <BarChart3 size={15} /> Reports
        </button>
      </div>

      {activeTab === 'tracker' && (
        <>
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
              placeholder="Search customer, supplier, invoice#…"
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
                  <th className="sortable" onClick={() => toggleSort('date')}>Date {sortIcon('date')}</th>
                  <th className="sortable" onClick={() => toggleSort('description')}>Description {sortIcon('description')}</th>
                  <th className="sortable" onClick={() => toggleSort('customer')}>Customer / Supplier {sortIcon('customer')}</th>
                  <th>Invoice#</th>
                  <th>Delivery#</th>
                  {products.map(p => <th key={p} className="num-col">{p}</th>)}
                  <th>Memo</th>
                  <th className="sortable" onClick={() => toggleSort('status')}>Status {sortIcon('status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={products.length + 8} className="empty-state">No records match your filters.</td></tr>
                )}
                {visible.map(row => {
                  const isOut = row.type === 'out';
                  return (
                    <tr key={row.id} className={isOut ? 'row-out' : 'row-in'}>
                      <td className="mono-cell">{row.date}</td>
                      <td>{row.description}</td>
                      <td className="customer-cell">{row.customer || row.supplier || <span className="text-muted">—</span>}</td>
                      <td className="mono-cell">{row.invoiceNo || <span className="text-muted">—</span>}</td>
                      <td className="mono-cell">{row.deliveryNo || <span className="text-muted">—</span>}</td>
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
              <tfoot>
                <tr className="totals-row">
                  <td colSpan={5}>Balance</td>
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
        </>
      )}

      {activeTab === 'suppliers' && (
        <div className="suppliers-page">
          <div className="suppliers-header">
            <h2>Suppliers</h2>
            <button className="btn btn-ghost" onClick={() => setShowSupplierUpload(true)}>
              <Upload size={15} /> Upload List
            </button>
          </div>
          <div className="supplier-add-row">
            <input
              placeholder="Add supplier manually…"
              value={newSupplier}
              onChange={e => setNewSupplier(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSupplierManual()}
            />
            <button className="btn btn-accent" onClick={addSupplierManual}><Plus size={14} /> Add</button>
          </div>
          <div className="supplier-list">
            {suppliers.length === 0 && <div className="empty-state">No suppliers yet. Add one above or upload a list.</div>}
            {suppliers.map(s => (
              <div key={s} className="supplier-row">
                <span><TruckIcon size={14} /> {s}</span>
                <button className="icon-btn danger" onClick={() => removeSupplier(s)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'reports' && <Reports rows={rows} products={products} />}

      {/* ── Add/Edit Transaction Modal ── */}
      {showAddRow && (
        <Modal title={editingId ? 'Edit Transaction' : 'Add Transaction'} onClose={() => { setShowAddRow(false); setEditingId(null); }} wide>
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

            {form.type === 'out' ? (
              <label className="span2">Customer
                <select value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))}>
                  <option value="">— select or type —</option>
                  {customers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <label className="span2">Supplier
                <select value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}>
                  <option value="">— select supplier —</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}

            <label>Invoice #
              <input value={form.invoiceNo || ''} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="INV-1001" />
            </label>
            <label>Delivery #
              <input value={form.deliveryNo || ''} onChange={e => setForm(f => ({ ...f, deliveryNo: e.target.value }))} placeholder="DEL-2002" />
            </label>

            <div className="span2 price-table">
              <div className="price-table-head">
                <span>Product</span><span>Qty</span><span>{form.type === 'out' ? 'Sale Price/Unit' : 'Cost/Unit'}</span>
              </div>
              {products.map(p => (
                <div key={p} className="price-table-row">
                  <span className="price-table-label">{p}</span>
                  <input
                    type="number" min="0" placeholder="0"
                    value={form.qty[p]}
                    onChange={e => setForm(f => ({ ...f, qty: { ...f.qty, [p]: e.target.value } }))}
                  />
                  {form.type === 'out' ? (
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={form.price[p]}
                      onChange={e => setForm(f => ({ ...f, price: { ...f.price, [p]: e.target.value } }))}
                    />
                  ) : (
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={form.cost[p]}
                      onChange={e => setForm(f => ({ ...f, cost: { ...f.cost, [p]: e.target.value } }))}
                    />
                  )}
                </div>
              ))}
            </div>

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

      {/* ── Upload Suppliers Modal ── */}
      {showSupplierUpload && (
        <Modal title="Upload Supplier List" onClose={() => setShowSupplierUpload(false)}>
          <div className="upload-zone">
            <Upload size={32} color="var(--accent)" />
            <p>Upload a CSV or Excel file with one supplier name per row/column.</p>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleSupplierFile} />
          </div>
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
