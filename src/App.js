import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Plus, Upload, Trash2, Package, Users, X, CheckCircle, Clock, Truck, AlertCircle,
  Search, Download, RefreshCw, Edit2, ArrowUp, ArrowDown, ArrowUpDown, FileText,
  Truck as TruckIcon, BarChart3, ListChecks, Tag, SlidersHorizontal, ChevronDown,
  ClipboardList, Database, Settings as SettingsIcon, MoreVertical, Factory, LogOut, Loader2,
} from 'lucide-react';
import Reports from './Reports';
import Items from './Items';
import Customers from './Customers';
import SalesOrders from './SalesOrders';
import Login from './Login';
import { watchAuth, signOutUser } from './cloud';
import { useCloudSync } from './sync';
import { Modal, SearchableSelect } from './ui';
import {
  DEFAULT_CATEGORY, fmt, localToday, computeStock, buildItemInfo, prettyDate,
} from './utils';
import './App.css';

// ─── helpers ────────────────────────────────────────────────────────────────
const today = localToday;
const uid = () => Math.random().toString(36).slice(2, 9);

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
}

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

const ALL_STATUSES = [...new Set([...Object.keys(STATUS_META), ...Object.keys(IN_STATUS_META)])];

const INITIAL_PRODUCTS = ['211G', 'Bwm 303', 'Bwm 777'];


// ─── load / save ─────────────────────────────────────────────────────────────
function defaultItemDefaults(prods) {
  const d = {};
  prods.forEach(p => (d[p] = { cost: '', price: '', category: DEFAULT_CATEGORY }));
  return d;
}

const DEFAULT_SETTINGS = { company: 'Super Quality Trading LLC', vat: 5 };

// Bring any saved / restored data up to the current shape.
function normalizeState(parsed) {
  parsed.products = parsed.products || INITIAL_PRODUCTS;
  parsed.rows = parsed.rows || [];
  if (!parsed.itemDefaults) parsed.itemDefaults = defaultItemDefaults(parsed.products);
  const cats = new Set(parsed.categories || [DEFAULT_CATEGORY]);
  parsed.products.forEach(p => {
    if (!parsed.itemDefaults[p]) parsed.itemDefaults[p] = { cost: '', price: '', category: DEFAULT_CATEGORY };
    if (!parsed.itemDefaults[p].category) parsed.itemDefaults[p].category = DEFAULT_CATEGORY;
    cats.add(parsed.itemDefaults[p].category);
  });
  parsed.categories = [...cats];
  // One-time clean-up: the old category box created a new category on every
  // keystroke ("F", "Fi", "Fil"…). Drop categories that no item uses.
  if (!parsed.catsCleaned) {
    const used = new Set(parsed.products.map(p => parsed.itemDefaults[p].category));
    parsed.categories = parsed.categories.filter(c => c === DEFAULT_CATEGORY || used.has(c));
    parsed.catsCleaned = true;
  }
  if (!parsed.categories.includes(DEFAULT_CATEGORY)) parsed.categories.unshift(DEFAULT_CATEGORY);
  parsed.customers = parsed.customers || [];
  parsed.suppliers = parsed.suppliers || [];
  parsed.orders = parsed.orders || [];
  parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
  return parsed;
}

function loadState() {
  try {
    const s = localStorage.getItem('stock_v3');
    if (s) return normalizeState(JSON.parse(s));
    // migrate from v2 if present
    const old = localStorage.getItem('stock_v2');
    if (old) {
      const parsed = JSON.parse(old);
      const rows = (parsed.rows || []).map(r => ({
        supplier: '', invoiceNo: '', deliveryNo: '', price: {}, cost: {}, ...r,
      }));
      return normalizeState({
        ...parsed, rows, suppliers: [],
        itemDefaults: defaultItemDefaults(parsed.products || INITIAL_PRODUCTS),
        categories: [DEFAULT_CATEGORY], catsCleaned: true,
      });
    }
  } catch {}
  return normalizeState({
    products: INITIAL_PRODUCTS, rows: [], customers: [], suppliers: [],
    itemDefaults: defaultItemDefaults(INITIAL_PRODUCTS), categories: [DEFAULT_CATEGORY], catsCleaned: true,
  });
}
function saveState(state) {
  localStorage.setItem('stock_v3', JSON.stringify(state));
}

// ─── small components ────────────────────────────────────────────────────────
function ItemChips({ row, products, expanded, onToggle }) {
  const list = products.filter(p => Number(row.qty?.[p]) > 0);
  if (list.length === 0) return <span className="text-muted">—</span>;
  const LIMIT = 4;
  const shown = expanded ? list : list.slice(0, LIMIT);
  const sign = row.type === 'out' ? '−' : '+';
  return (
    <div className="chip-row">
      {shown.map(p => (
        <span key={p} className={`item-chip ${row.type === 'out' ? 'item-chip--out' : 'item-chip--in'}`}>
          {p} <b>{sign}{row.qty[p]}</b>
        </span>
      ))}
      {list.length > LIMIT && (
        <button className="item-chip item-chip--more" onClick={onToggle}>
          {expanded ? 'less' : `+${list.length - LIMIT} more`}
        </button>
      )}
    </div>
  );
}

function CategoryRow({ name, count, locked, onRename, onDelete }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => { setDraft(name); }, [name]);
  function commit() {
    if (draft.trim() && draft.trim() !== name) onRename(name, draft);
    else setDraft(name);
  }
  return (
    <div className="cat-row">
      <input
        value={draft}
        disabled={locked}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
      />
      <span className="cat-count">{count} {count === 1 ? 'item' : 'items'}</span>
      {locked
        ? <span className="cat-lock">default</span>
        : <button className="icon-btn danger" onClick={() => onDelete(name)} aria-label={`Delete ${name}`}><Trash2 size={15} /></button>}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(loadState);
  const { products, rows, customers, suppliers, itemDefaults, categories, orders, settings } = state;

  const [activeTab, setActiveTab] = useState('tracker'); // tracker | orders | items | customers | suppliers | reports

  const [showAddRow, setShowAddRow]   = useState(false);
  const [showAddProd, setShowAddProd] = useState(false);
  const [showUpload, setShowUpload]   = useState(false);
  const [showSupplierUpload, setShowSupplierUpload] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [catPrompt, setCatPrompt] = useState(null); // { product } while naming a new category
  const [catPromptName, setCatPromptName] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem('stock_last_backup') || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterProduct, setFilterProduct] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [newSupplier, setNewSupplier] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [productFilter, setProductFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [itemsPreset, setItemsPreset] = useState({ stock: 'All', n: 0 });

  // form state
  const [form, setForm] = useState(() => buildEmptyForm(INITIAL_PRODUCTS));
  const [newProd, setNewProd] = useState('');
  const [newProdCat, setNewProdCat] = useState(DEFAULT_CATEGORY);

  useEffect(() => { saveState(state); }, [state]);

  // ── sign-in + cloud sync ──
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  useEffect(() => watchAuth(u => { setUser(u); setAuthReady(true); }), []);
  const sync = useCloudSync({
    enabled: !!user && !localOnly, state, setState, normalize: normalizeState, userEmail: user?.email,
  });

  function buildEmptyForm(prods) {
    const qty = {}, price = {}, cost = {};
    prods.forEach(p => {
      qty[p] = '';
      price[p] = itemDefaults?.[p]?.price || '';
      cost[p] = itemDefaults?.[p]?.cost || '';
    });
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
    return { ...row, type: row.type === 'out' && row.purpose === 'production' ? 'prod' : row.type, qty, price, cost };
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── stock, items ───────────────────────────────────────────────────────────
  const stock = useMemo(() => computeStock(rows, products), [rows, products]);
  const itemInfo = useMemo(() => buildItemInfo(products, itemDefaults, stock), [products, itemDefaults, stock]);
  const visibleProducts = useMemo(() => products.filter(p => !itemDefaults?.[p]?.hidden), [products, itemDefaults]);
  const alertItems = itemInfo.filter(i => !i.hidden && i.alert);
  const unitsInStock = itemInfo.filter(i => !i.hidden).reduce((s, i) => s + Math.max(i.bal, 0), 0);
  const pendingCount = rows.filter(r => r.status === 'Pending').length;

  // ── months ─────────────────────────────────────────────────────────────────
  const availableMonths = [...new Set(rows.map(r => (r.date || '').slice(0, 7)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));

  // ── filters ────────────────────────────────────────────────────────────────
  const filtered = rows.filter(r => {
    if (selectedMonth !== 'All' && (r.date || '').slice(0, 7) !== selectedMonth) return false;
    if (filterStatus !== 'All' && r.status !== filterStatus) return false;
    if (filterType === 'prod' && r.purpose !== 'production') return false;
    if (filterType === 'out' && (r.type !== 'out' || r.purpose === 'production')) return false;
    if (filterType === 'in' && r.type !== 'in') return false;
    if (filterProduct !== 'All' && !Number(r.qty?.[filterProduct])) return false;
    if (search) {
      const q = search.toLowerCase();
      const hit = [r.customer, r.supplier, r.description, r.invoiceNo, r.deliveryNo, r.memo]
        .some(f => (f || '').toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });
  const activeFilterCount = [selectedMonth, filterStatus, filterType, filterProduct].filter(v => v !== 'All').length;

  function clearFilters() {
    setSelectedMonth('All'); setFilterStatus('All'); setFilterType('All'); setFilterProduct('All'); setSearch('');
  }

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

  const shownIn = visible.filter(r => r.type === 'in' && r.status !== 'Cancelled')
    .reduce((s, r) => s + products.reduce((t, p) => t + Number(r.qty?.[p] || 0), 0), 0);
  const shownOut = visible.filter(r => r.type === 'out' && r.status !== 'Cancelled')
    .reduce((s, r) => s + products.reduce((t, p) => t + Number(r.qty?.[p] || 0), 0), 0);

  // ── add / edit row ─────────────────────────────────────────────────────────
  function submitRow() {
    const cleanQty = {}, cleanPrice = {}, cleanCost = {};
    products.forEach(p => {
      cleanQty[p] = Number(form.qty[p]) || 0;
      const priceVal = form.price[p];
      const costVal = form.cost[p];
      cleanPrice[p] = (priceVal === '' || priceVal == null)
        ? (Number(itemDefaults?.[p]?.price) || 0)
        : Number(priceVal) || 0;
      cleanCost[p] = (costVal === '' || costVal == null)
        ? (Number(itemDefaults?.[p]?.cost) || 0)
        : Number(costVal) || 0;
    });

    const isProd = form.type === 'prod';
    const custName = isProd ? '' : form.customer?.trim();
    const supName = form.type === 'in' ? form.supplier?.trim() : '';
    const base = {
      ...form,
      type: isProd ? 'out' : form.type,
      purpose: isProd ? 'production' : '',
      customer: isProd ? '' : form.customer,
    };

    if (editingId) {
      setState(s => ({
        ...s,
        rows: s.rows.map(r => r.id === editingId
          ? { ...base, qty: cleanQty, price: cleanPrice, cost: cleanCost, id: editingId }
          : r),
        customers: (custName && !s.customers.includes(custName)) ? [...s.customers, custName] : s.customers,
        suppliers: (supName && !s.suppliers.includes(supName)) ? [...s.suppliers, supName] : s.suppliers,
      }));
      showToast('Transaction updated');
    } else {
      const row = { ...base, qty: cleanQty, price: cleanPrice, cost: cleanCost, id: uid() };
      setState(s => ({
        ...s,
        rows: [...s.rows, row],
        customers: (custName && !s.customers.includes(custName)) ? [...s.customers, custName] : s.customers,
        suppliers: (supName && !s.suppliers.includes(supName)) ? [...s.suppliers, supName] : s.suppliers,
      }));
      showToast('Transaction added');
    }

    setForm(buildEmptyForm(products));
    setEditingId(null);
    setShowAddRow(false);
  }

  function openAddRow() {
    setForm(buildEmptyForm(products));
    setEditingId(null);
    setProductFilter('');
    setShowAddRow(true);
  }

  function openEditRow(row) {
    setForm(buildFormFromRow(row, products));
    setEditingId(row.id);
    setProductFilter('');
    setShowAddRow(true);
  }

  // ── products grouped by category (transaction modal, product filter) ───────
  function groupProductsByCategory(prods) {
    const groups = {};
    prods.forEach(p => {
      const cat = itemDefaults?.[p]?.category || DEFAULT_CATEGORY;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    const orderedCats = [...categories.filter(c => groups[c]), ...Object.keys(groups).filter(c => !categories.includes(c))];
    return orderedCats.map(cat => ({ category: cat, items: groups[cat] }));
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

  // ── add product ────────────────────────────────────────────────────────────
  function addProduct() {
    const name = newProd.trim();
    if (!name) return;
    if (products.some(p => p.toLowerCase() === name.toLowerCase())) {
      showToast(`"${name}" already exists`, 'warn');
      return;
    }
    const cat = categories.includes(newProdCat) ? newProdCat : DEFAULT_CATEGORY;
    setState(s => ({
      ...s,
      products: [...s.products, name],
      rows: s.rows.map(r => ({
        ...r,
        qty: { ...r.qty, [name]: 0 },
        price: { ...r.price, [name]: 0 },
        cost: { ...r.cost, [name]: 0 },
      })),
      itemDefaults: { ...s.itemDefaults, [name]: { cost: '', price: '', category: cat } },
    }));
    setNewProd('');
    setNewProdCat(DEFAULT_CATEGORY);
    setShowAddProd(false);
    showToast(`"${name}" added`);
  }

  // ── item defaults (cost / price / reorder level / hidden) ──────────────────
  function updateItemDefault(product, field, value) {
    setState(s => ({
      ...s,
      itemDefaults: {
        ...s.itemDefaults,
        [product]: { ...s.itemDefaults?.[product], [field]: value },
      },
    }));
  }

  function toggleHidden(product) {
    const nowHidden = !itemDefaults?.[product]?.hidden;
    updateItemDefault(product, 'hidden', nowHidden);
    showToast(nowHidden ? `"${product}" hidden` : `"${product}" is visible again`);
  }

  // ── customer / supplier files ──────────────────────────────────────────────
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

  function addSupplier(name) {
    if (!name || suppliers.includes(name)) return;
    setState(s => ({ ...s, suppliers: [...s.suppliers, name] }));
  }

  function addSupplierManual() {
    const name = newSupplier.trim();
    if (!name) return;
    addSupplier(name);
    setNewSupplier('');
    showToast(`Supplier "${name}" added`);
  }

  function removeSupplier(name) {
    setState(s => ({ ...s, suppliers: s.suppliers.filter(x => x !== name) }));
  }

  function addCustomer(name) {
    if (!name || customers.includes(name)) return;
    setState(s => ({ ...s, customers: [...s.customers, name] }));
    showToast(`Customer "${name}" added`);
  }

  function removeCustomer(name) {
    setState(s => ({ ...s, customers: s.customers.filter(x => x !== name) }));
  }

  // ── categories ─────────────────────────────────────────────────────────────
  const catExists = (name, except) =>
    categories.some(c => c !== except && c.toLowerCase() === name.toLowerCase());

  function setItemCategory(product, category) {
    updateItemDefault(product, 'category', category);
  }

  function createCategoryFor(product, rawName) {
    const name = rawName.trim();
    if (!name) return;
    const existing = categories.find(c => c.toLowerCase() === name.toLowerCase());
    setState(s => ({
      ...s,
      categories: existing ? s.categories : [...s.categories, name],
      itemDefaults: product
        ? { ...s.itemDefaults, [product]: { ...s.itemDefaults?.[product], category: existing || name } }
        : s.itemDefaults,
    }));
    showToast(existing ? `Moved to "${existing}"` : `Category "${name}" created`);
  }

  function renameCategory(oldName, rawNew) {
    const n = rawNew.trim();
    if (!n || n === oldName) return;
    if (catExists(n, oldName)) { showToast('That category already exists', 'warn'); return; }
    setState(s => {
      const nextDefaults = { ...s.itemDefaults };
      Object.keys(nextDefaults).forEach(p => {
        if (nextDefaults[p]?.category === oldName) nextDefaults[p] = { ...nextDefaults[p], category: n };
      });
      return { ...s, categories: s.categories.map(c => (c === oldName ? n : c)), itemDefaults: nextDefaults };
    });
    showToast(`Renamed to "${n}"`);
  }

  function deleteCategory(name) {
    if (name === DEFAULT_CATEGORY) return;
    const inUse = products.filter(p => (itemDefaults?.[p]?.category || DEFAULT_CATEGORY) === name).length;
    const msg = inUse > 0
      ? `Delete "${name}"? Its ${inUse} item${inUse === 1 ? '' : 's'} will move to "${DEFAULT_CATEGORY}".`
      : `Delete "${name}"?`;
    if (!window.confirm(msg)) return;
    setState(s => {
      const nextDefaults = { ...s.itemDefaults };
      Object.keys(nextDefaults).forEach(p => {
        if (nextDefaults[p]?.category === name) nextDefaults[p] = { ...nextDefaults[p], category: DEFAULT_CATEGORY };
      });
      return { ...s, categories: s.categories.filter(c => c !== name), itemDefaults: nextDefaults };
    });
    showToast(`Category "${name}" deleted`, 'warn');
  }

  // ── sales orders ───────────────────────────────────────────────────────────
  function saveOrder(order) {
    setState(s => {
      const exists = order.id && s.orders.some(o => o.id === order.id);
      const saved = { ...order, id: order.id || uid() };
      return { ...s, orders: exists ? s.orders.map(o => (o.id === saved.id ? saved : o)) : [...s.orders, saved] };
    });
    showToast(order.id ? `${order.no} updated` : `${order.no} created`);
  }

  function deleteOrder(order) {
    if (!window.confirm(`Delete ${order.no}?${order.status === 'Delivered' ? ' The stock-out sale it created is kept.' : ''}`)) return;
    setState(s => ({ ...s, orders: s.orders.filter(o => o.id !== order.id) }));
    showToast(`${order.no} deleted`, 'warn');
  }

  function deliverOrder(order) {
    const short = order.lines.filter(l => (stock.balance[l.product] || 0) < Number(l.qty));
    if (short.length > 0) {
      const names = short.map(l => `${l.product} (have ${stock.balance[l.product] || 0}, need ${l.qty})`).join(', ');
      if (!window.confirm(`Not enough stock for: ${names}.\n\nDeliver anyway? Stock will go negative.`)) return;
    } else if (!window.confirm(`Mark ${order.no} as delivered? This records a stock-out sale for ${order.customer}.`)) return;

    const qty = {}, price = {};
    order.lines.forEach(l => { qty[l.product] = (qty[l.product] || 0) + Number(l.qty); price[l.product] = Number(l.price) || 0; });
    const row = {
      id: uid(), date: today(), description: `Sale · ${order.no}`, type: 'out', purpose: '',
      customer: order.customer, supplier: '', invoiceNo: '', deliveryNo: '',
      qty, price, cost: {}, status: 'Delivered', memo: order.ref ? `Ref ${order.ref}` : '', orderNo: order.no,
    };
    setState(s => ({
      ...s,
      rows: [...s.rows, row],
      orders: s.orders.map(o => (o.id === order.id ? { ...o, status: 'Delivered', deliveredOn: today() } : o)),
    }));
    showToast(`${order.no} delivered — stock updated`);
  }

  // ── backup / restore / settings ────────────────────────────────────────────
  function backupAll() {
    const payload = {
      app: 'stock-tracker', schema: 4, exportedAt: new Date().toISOString(), data: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-tracker-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const stamp = today();
    localStorage.setItem('stock_last_backup', stamp);
    setLastBackup(stamp);
    setDataMenuOpen(false);
    showToast('Backup downloaded');
  }

  function restoreFromFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setDataMenuOpen(false);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || !Array.isArray(data.products) || !Array.isArray(data.rows)) throw new Error('bad');
        const when = parsed.exportedAt ? ` from ${prettyDate(parsed.exportedAt.slice(0, 10))}` : '';
        const msg = `Restore backup${when}?\n\nIt contains ${data.rows.length} transactions and ${data.products.length} items. ` +
          'This REPLACES everything currently in the app' +
          (sync.active && !localOnly ? ' — and, because cloud sync is on, on all your other devices too.' : '.') +
          ' Download a backup first if you are unsure.';
        if (!window.confirm(msg)) return;
        setState(normalizeState(JSON.parse(JSON.stringify(data))));
        showToast('Backup restored');
      } catch {
        showToast('That file is not a valid backup', 'warn');
      }
    };
    reader.readAsText(file);
  }

  function openSettings() {
    setSettingsDraft({ ...DEFAULT_SETTINGS, ...settings });
    setDataMenuOpen(false);
    setShowSettings(true);
  }
  function saveSettings() {
    const vat = Math.max(0, Number(settingsDraft.vat) || 0);
    setState(s => ({ ...s, settings: { company: settingsDraft.company.trim() || DEFAULT_SETTINGS.company, vat } }));
    setShowSettings(false);
    showToast('Settings saved');
  }

  const backupAge = lastBackup ? Math.floor((Date.now() - new Date(`${lastBackup}T00:00:00`).getTime()) / 86400000) : null;
  const backupStale = backupAge == null || backupAge >= 7;

  // ── export ─────────────────────────────────────────────────────────────────
  function itemsText(r) {
    return products
      .filter(p => Number(r.qty?.[p]) > 0)
      .map(p => `${p} ${r.type === 'out' ? '-' : '+'}${r.qty[p]}`)
      .join(', ');
  }

  function exportXLSX() {
    const data = rows.map(r => {
      const obj = {
        Date: r.date, Description: r.description, Type: r.purpose === 'production' ? 'production' : r.type,
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

    const head = [['Date', 'Description', 'Customer/Supplier', 'Invoice#', 'Delivery#', 'Items', 'Memo', 'Status']];
    const body = visible.map(r => [
      r.date,
      r.description,
      r.customer || r.supplier || '—',
      r.invoiceNo || '—',
      r.deliveryNo || '—',
      itemsText(r) || '—',
      r.memo || '—',
      r.status || '—',
    ]);

    autoTable(doc, {
      head, body,
      startY: 28,
      styles: { fontSize: 7, cellPadding: 2.5 },
      headStyles: { fillColor: [13, 148, 136] },
      alternateRowStyles: { fillColor: [245, 246, 250] },
      columnStyles: { 5: { cellWidth: 40 } },
    });

    doc.save(`stock_${today()}.pdf`);
    showToast('Exported to PDF');
  }

  function balanceRows() {
    return itemInfo.filter(i => !i.hidden || i.bal !== 0);
  }

  function exportBalanceXLSX() {
    const data = balanceRows().map(i => ({
      Product: i.name,
      Category: i.category,
      'Total In': i.tin,
      'Total Out': i.tout,
      'Current Balance': i.bal,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.sheet_add_aoa(ws, [[`Balance Stock — Generated ${today()}`]], { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance');
    XLSX.writeFile(wb, `balance_stock_${today()}.xlsx`);
    showToast('Balance stock exported');
  }

  function exportBalancePDF() {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Balance Stock Report', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated: ${today()}`, 14, 22);

    const head = [['Product', 'Category', 'Total In', 'Total Out', 'Current Balance']];
    const body = balanceRows().map(i => [i.name, i.category, fmt(i.tin), fmt(i.tout), fmt(i.bal)]);

    autoTable(doc, {
      head, body,
      startY: 28,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [13, 148, 136] },
      alternateRowStyles: { fillColor: [245, 246, 250] },
    });

    doc.save(`balance_stock_${today()}.pdf`);
    showToast('Balance stock exported');
  }

  function runExport(fn) {
    setExportOpen(false);
    fn();
  }

  // ── transaction modal: which products to list ──────────────────────────────
  const formProducts = products.filter(p => !itemDefaults?.[p]?.hidden || Number(form.qty?.[p]) > 0);
  const modalProducts = formProducts.filter(p => p.toLowerCase().includes(productFilter.trim().toLowerCase()));

  if (!authReady) {
    return <div className="login-shell"><Loader2 size={28} className="spin" color="var(--accent)" /></div>;
  }
  if (!user && !localOnly) return <Login onLocalOnly={() => setLocalOnly(true)} />;

  const syncLabel = localOnly ? 'This device only'
    : !sync.online ? 'Offline — saved on this device'
    : sync.phase === 'connecting' ? 'Connecting…'
    : sync.phase === 'syncing' ? 'Syncing…'
    : sync.phase === 'error' ? 'Sync problem'
    : 'Synced';
  const syncClass = localOnly ? 'local' : !sync.online ? 'offline' : sync.phase;

  const openOrderCount = orders.filter(o => o.status === 'Draft' || o.status === 'Confirmed').length;
  const TABS = [
    { id: 'tracker', label: 'Tracker', short: 'Tracker', Icon: ListChecks },
    { id: 'orders', label: 'Sales Orders', short: 'Orders', Icon: ClipboardList, count: openOrderCount },
    { id: 'items', label: 'Items', short: 'Items', Icon: Tag },
    { id: 'customers', label: 'Customers', short: 'Customers', Icon: Users },
    { id: 'suppliers', label: 'Suppliers', short: 'Suppliers', Icon: TruckIcon },
    { id: 'reports', label: 'Reports', short: 'Reports', Icon: BarChart3 },
  ];

  const restoreInput = (
    <input type="file" accept=".json,application/json" hidden onChange={restoreFromFile} />
  );

  return (
    <div className="shell">
      {/* ── sidebar (desktop) / bottom bar (phones) ── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Package size={19} /></div>
          <div className="brand-text">
            <div className="brand-name">Stock Tracker</div>
            <div className="brand-sub">{settings.company}</div>
          </div>
        </div>

        <nav className="side-nav">
          {TABS.map(({ id, label, short, Icon, count }) => (
            <button
              key={id}
              className={`side-link ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
              title={label}
            >
              <Icon size={18} />
              <span className="lbl-full">{label}</span>
              <span className="lbl-short">{short}</span>
              {count > 0 && <span className="side-badge">{count}</span>}
            </button>
          ))}
        </nav>

        <div className="side-foot">
          <div className={`sync-chip sync-${syncClass}`} title={sync.message || syncLabel}>
            <i /> <span className="sync-text">{syncLabel}</span>
          </div>
          {user && <div className="sync-user" title={user.email}>{user.email}</div>}
          <button className="side-foot-btn" onClick={backupAll} title="Download a backup of all data">
            <Database size={16} /> <span>Backup data</span>
            {backupStale && <i className="dot-warn" />}
          </button>
          <label className="side-foot-btn" title="Restore from a backup file">
            <Upload size={16} /> <span>Restore backup</span>{restoreInput}
          </label>
          <button className="side-foot-btn" onClick={openSettings} title="Company name and VAT">
            <SettingsIcon size={16} /> <span>Settings</span>
          </button>
          {user
            ? <button className="side-foot-btn" onClick={signOutUser} title="Sign out"><LogOut size={16} /> <span>Sign out</span></button>
            : <button className="side-foot-btn" onClick={() => setLocalOnly(false)} title="Sign in to sync"><LogOut size={16} /> <span>Sign in to sync</span></button>}
          <div className={`backup-note ${backupStale ? 'warn' : ''}`}>
            {lastBackup ? `Last backup ${backupAge === 0 ? 'today' : `${backupAge}d ago`}` : 'No backup yet'}
          </div>
        </div>
      </aside>

      <div className="main">
        {/* ── top bar (phones only) ── */}
        <header className="topbar">
          <div className="topbar-brand">
            <div className="brand-mark"><Package size={17} /></div>
            <span>{TABS.find(t => t.id === activeTab)?.label}</span>
          </div>
          <div className="menu-wrap">
            <button className="topbar-btn" onClick={() => setDataMenuOpen(o => !o)} aria-label="Data and settings">
              <MoreVertical size={20} />{backupStale && <i className="dot-warn" />}
            </button>
            {dataMenuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setDataMenuOpen(false)} />
                <div className="menu">
                  <div className={`sync-chip sync-${syncClass} in-menu`}><i /> <span className="sync-text">{syncLabel}</span></div>
                  {user && <div className="sync-user in-menu">{user.email}</div>}
                  <button onClick={backupAll}><Database size={15} /> Backup all data</button>
                  <label className="menu-item"><Upload size={15} /> Restore backup{restoreInput}</label>
                  <button onClick={openSettings}><SettingsIcon size={15} /> Settings</button>
                  {user
                    ? <button onClick={() => { setDataMenuOpen(false); signOutUser(); }}><LogOut size={15} /> Sign out</button>
                    : <button onClick={() => { setDataMenuOpen(false); setLocalOnly(false); }}><LogOut size={15} /> Sign in to sync</button>}
                  <div className={`menu-note ${backupStale ? 'warn' : ''}`}>
                    {lastBackup ? `Last backup ${backupAge === 0 ? 'today' : `${backupAge}d ago`}` : 'No backup yet'}
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

      {activeTab === 'tracker' && (
        <div className="page tracker-page">
          <div className="page-head">
            <div>
              <h2>Transactions</h2>
              <p className="page-sub">Every stock movement — purchases, sales and production use — in one place.</p>
            </div>
            <div className="page-head-actions">
              <div className="menu-wrap">
                <button className="btn btn-ghost" onClick={() => setExportOpen(o => !o)} aria-label="Export">
                  <Download size={15} /> Export <ChevronDown size={13} />
                </button>
                {exportOpen && (
                  <>
                    <div className="menu-backdrop" onClick={() => setExportOpen(false)} />
                    <div className="menu">
                      <div className="menu-label">Transactions</div>
                      <button onClick={() => runExport(exportXLSX)}><Download size={14} /> Excel</button>
                      <button onClick={() => runExport(exportPDF)}><FileText size={14} /> PDF (current filters)</button>
                      <div className="menu-label">Balance stock</div>
                      <button onClick={() => runExport(exportBalanceXLSX)}><Package size={14} /> Excel</button>
                      <button onClick={() => runExport(exportBalancePDF)}><FileText size={14} /> PDF</button>
                    </div>
                  </>
                )}
              </div>
              <button className="btn btn-accent hide-mobile" onClick={openAddRow}>
                <Plus size={15} /> Add Transaction
              </button>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Items</span>
              <b className="stat-value">{visibleProducts.length}</b>
              <span className="stat-sub">{categories.length > 1 ? `${categories.length} categories` : 'tracked'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Units in stock</span>
              <b className="stat-value">{fmt(unitsInStock)}</b>
              <span className="stat-sub">across visible items</span>
            </div>
            <button
              className={`stat-card stat-card--btn ${pendingCount > 0 ? 'stat-card--warn' : ''}`}
              onClick={() => { clearFilters(); setFilterStatus('Pending'); }}
            >
              <span className="stat-label">Pending</span>
              <b className="stat-value">{pendingCount}</b>
              <span className="stat-sub">tap to filter</span>
            </button>
            <button
              className={`stat-card stat-card--btn ${alertItems.length > 0 ? 'stat-card--danger' : ''}`}
              onClick={() => { setItemsPreset(p => ({ stock: 'alert', n: p.n + 1 })); setActiveTab('items'); }}
            >
              <span className="stat-label">Needs attention</span>
              <b className="stat-value">{alertItems.length}</b>
              <span className="stat-sub">low or out of stock</span>
            </button>
          </div>

          {alertItems.length > 0 && (
            <div className="alert-strip">
              <span className="alert-label"><AlertCircle size={13} /> Stock alerts</span>
              {alertItems.slice(0, 6).map(i => (
                <span key={i.name} className={`stock-tag stock-tag--${i.status}`}>
                  {i.name} · {i.bal <= 0 ? (i.bal < 0 ? `${i.bal}` : 'out') : `${i.bal} left`}
                </span>
              ))}
              {alertItems.length > 6 && (
                <button className="link-btn" onClick={() => { setItemsPreset(p => ({ stock: 'alert', n: p.n + 1 })); setActiveTab('items'); }}>
                  +{alertItems.length - 6} more
                </button>
              )}
            </div>
          )}

          {/* ── filters ── */}
          <div className="filters-bar">
            <div className="filters-main">
              <div className="search-wrap grow">
                <Search size={14} className="search-icon" />
                <input
                  className="search-input"
                  placeholder="Search customer, supplier, invoice#…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <button className="btn btn-ghost filters-toggle" onClick={() => setFiltersOpen(o => !o)}>
                <SlidersHorizontal size={15} /> Filters
                {activeFilterCount > 0 && <span className="chip">{activeFilterCount}</span>}
              </button>
            </div>
            <div className={`filters-extra ${filtersOpen ? 'open' : ''}`}>
              <label className="filter-field"><span>Month</span>
                <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                  <option value="All">All months</option>
                  {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
              <label className="filter-field"><span>Type</span>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="All">In &amp; out</option>
                  <option value="out">Sales (out)</option>
                  <option value="prod">Production use</option>
                  <option value="in">Purchases (in)</option>
                </select>
              </label>
              <label className="filter-field"><span>Status</span>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="All">All statuses</option>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="filter-field"><span>Item</span>
                <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
                  <option value="All">All items</option>
                  {categories.length > 1
                    ? groupProductsByCategory(visibleProducts).map(g => (
                      <optgroup key={g.category} label={g.category}>
                        {g.items.map(p => <option key={p} value={p}>{p}</option>)}
                      </optgroup>
                    ))
                    : visibleProducts.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="filter-field sort-field"><span>Sort</span>
                <div className="sort-group">
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                    <option value="date">Date</option>
                    <option value="customer">Customer / Supplier</option>
                    <option value="description">Description</option>
                    <option value="status">Status</option>
                  </select>
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} aria-label="Toggle sort direction">
                    {sortDir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  </button>
                </div>
              </label>
              {(activeFilterCount > 0 || search) && (
                <button className="link-btn clear-btn" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
          </div>

          {/* ── transactions ── */}
          <div className="gt tx">
            <div className="gt-head tx-head">
              <div className="gt-h sortable" onClick={() => toggleSort('date')}>Date {sortIcon('date')}</div>
              <div className="gt-h sortable" onClick={() => toggleSort('description')}>Description {sortIcon('description')}</div>
              <div className="gt-h sortable" onClick={() => toggleSort('customer')}>Customer / Supplier {sortIcon('customer')}</div>
              <div className="gt-h">Invoice / Delivery</div>
              <div className="gt-h">Items</div>
              <div className="gt-h">Memo</div>
              <div className="gt-h sortable" onClick={() => toggleSort('status')}>Status {sortIcon('status')}</div>
              <div className="gt-h"></div>
            </div>

            {visible.length === 0 && <div className="empty-state"><p>No records match your filters.</p></div>}

            {visible.map(row => {
              const isOut = row.type === 'out';
              const hasRefs = row.invoiceNo || row.deliveryNo;
              return (
                <div key={row.id} className={`gt-row tx-row ${row.purpose === 'production' ? 'row-prod' : isOut ? 'row-out' : 'row-in'}`}>
                  <div className="tx-date mono-cell">{row.date}</div>
                  <div className="tx-desc">{row.description}</div>
                  <div className="tx-party customer-cell">
                    {row.purpose === 'production'
                      ? <span className="pill pill-flat pill-amber"><Factory size={11} /> Production use</span>
                      : (row.customer || row.supplier || <span className="text-muted">—</span>)}
                  </div>
                  <div className={`tx-refs mono-cell ${hasRefs ? '' : 'is-empty'}`}>
                    {hasRefs ? (
                      <>
                        {row.invoiceNo && <div>INV {row.invoiceNo}</div>}
                        {row.deliveryNo && <div>DEL {row.deliveryNo}</div>}
                      </>
                    ) : <span className="text-muted">—</span>}
                  </div>
                  <div className="tx-items">
                    <ItemChips
                      row={row}
                      products={products}
                      expanded={!!expandedRows[row.id]}
                      onToggle={() => setExpandedRows(e => ({ ...e, [row.id]: !e[row.id] }))}
                    />
                  </div>
                  <div className={`tx-memo memo-cell ${row.memo ? '' : 'is-empty'}`}>{row.memo || <span className="text-muted">—</span>}</div>
                  <div className="tx-status">
                    <select
                      className="status-select"
                      value={row.status || ''}
                      onChange={e => setStatus(row.id, e.target.value)}
                      style={{ color: statusMetaFor(row.type)[row.status]?.color || 'var(--text-muted)' }}
                    >
                      <option value="">—</option>
                      {Object.keys(statusMetaFor(row.type)).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="tx-actions row-actions">
                    <button className="icon-btn" onClick={() => openEditRow(row)} aria-label="Edit"><Edit2 size={15} /></button>
                    <button className="icon-btn danger" onClick={() => deleteRow(row.id)} aria-label="Delete"><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tx-foot">
            <span>{visible.length} {visible.length === 1 ? 'transaction' : 'transactions'}</span>
            <span><b className="qty-in">+{fmt(shownIn)}</b> in · <b className="qty-out">−{fmt(shownOut)}</b> out (units shown)</span>
          </div>

          <button className="fab" onClick={openAddRow} aria-label="Add transaction"><Plus size={24} /></button>
        </div>
      )}

      {activeTab === 'orders' && (
        <SalesOrders
          orders={orders}
          customers={customers}
          products={visibleProducts.filter(p => !itemDefaults?.[p]?.internal)}
          itemDefaults={itemDefaults}
          categories={categories}
          stock={stock}
          settings={settings}
          onSave={saveOrder}
          onDelete={deleteOrder}
          onDeliver={deliverOrder}
          onAddCustomer={addCustomer}
        />
      )}

      {activeTab === 'items' && (
        <Items
          key={itemsPreset.n}
          presetStock={itemsPreset.stock}
          info={itemInfo}
          categories={categories}
          onUpdateDefault={updateItemDefault}
          onSetCategory={setItemCategory}
          onToggleHidden={toggleHidden}
          onAddProduct={() => setShowAddProd(true)}
          onNewCategory={(product) => { setCatPromptName(''); setCatPrompt({ product }); }}
          onManageCategories={() => { setCatPromptName(''); setShowCats(true); }}
        />
      )}

      {activeTab === 'customers' && (
        <Customers
          rows={rows}
          products={products}
          itemDefaults={itemDefaults}
          customers={customers}
          stock={stock}
          onUpload={() => setShowUpload(true)}
          onAddCustomer={addCustomer}
          onRemoveCustomer={removeCustomer}
        />
      )}

      {activeTab === 'suppliers' && (
        <div className="page suppliers-page">
          <div className="page-head">
            <div><h2>Suppliers</h2></div>
            <div className="page-head-actions">
              <button className="btn btn-ghost" onClick={() => setShowSupplierUpload(true)}>
                <Upload size={15} /> Upload List
              </button>
            </div>
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
            {suppliers.length === 0 && <div className="empty-state"><p>No suppliers yet. Add one above or upload a list.</p></div>}
            {suppliers.map(s => (
              <div key={s} className="supplier-row">
                <span><TruckIcon size={14} /> {s}</span>
                <button className="icon-btn danger" onClick={() => removeSupplier(s)} aria-label={`Remove ${s}`}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'reports' && <Reports rows={rows} products={products} itemDefaults={itemDefaults} categories={categories} />}

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
                  setForm(f => {
                    let description = f.description;
                    if (newType === 'prod' && (description === 'Sale' || !description)) description = 'Used in production';
                    if (newType !== 'prod' && description === 'Used in production') description = newType === 'out' ? 'Sale' : '';
                    return {
                      ...f,
                      type: newType,
                      description,
                      status: newType === 'prod' ? 'Delivered'
                        : validStatuses.includes(f.status) ? f.status : validStatuses[1] || validStatuses[0],
                    };
                  });
                }}
              >
                <option value="in">Stock In</option>
                <option value="out">Stock Out (Sale)</option>
                <option value="prod">Used in production</option>
              </select>
            </label>
            <label className="span2">Description
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>

            {form.type === 'prod' ? (
              <p className="span2 modal-hint prod-hint"><Factory size={13} /> Materials used in production are taken out of stock but never counted as a sale or a loss in Reports.</p>
            ) : form.type === 'out' ? (
              <label className="span2">Customer
                <SearchableSelect
                  value={form.customer}
                  onChange={v => setForm(f => ({ ...f, customer: v }))}
                  onCreate={addCustomer}
                  options={customers}
                  placeholder="Search or type a customer name…"
                />
              </label>
            ) : (
              <label className="span2">Supplier
                <SearchableSelect
                  value={form.supplier}
                  onChange={v => setForm(f => ({ ...f, supplier: v }))}
                  onCreate={addSupplier}
                  options={suppliers}
                  placeholder="Search or type a supplier name…"
                />
              </label>
            )}

            <label>Invoice #
              <input value={form.invoiceNo || ''} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} placeholder="INV-1001" />
            </label>
            <label>Delivery #
              <input value={form.deliveryNo || ''} onChange={e => setForm(f => ({ ...f, deliveryNo: e.target.value }))} placeholder="DEL-2002" />
            </label>

            <div className={`span2 price-table ${form.type === 'prod' ? 'price-table--qty' : ''}`}>
              {formProducts.length > 6 && (
                <div className="product-filter-input search-wrap">
                  <Search size={14} className="search-icon" />
                  <input
                    value={productFilter}
                    onChange={e => setProductFilter(e.target.value)}
                    placeholder="Search items…"
                  />
                </div>
              )}
              <div className="price-table-head">
                <span>Item</span><span>Qty</span>
                {form.type !== 'prod' && <span>{form.type === 'out' ? 'Price (AED)' : 'Cost (AED)'}</span>}
              </div>
              {groupProductsByCategory(modalProducts).map(group => (
                <React.Fragment key={group.category}>
                  {categories.length > 1 && <div className="price-table-category">{group.category}</div>}
                  {group.items.map(p => (
                    <div key={p} className="price-table-row">
                      <span className="price-table-label">{p}</span>
                      <input
                        type="number" min="0" placeholder="0" inputMode="numeric"
                        value={form.qty[p] ?? ''}
                        onChange={e => setForm(f => ({ ...f, qty: { ...f.qty, [p]: e.target.value } }))}
                      />
                      {form.type === 'prod' ? null : form.type === 'out' ? (
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          placeholder={itemDefaults?.[p]?.price ? `${itemDefaults[p].price}` : '0.00'}
                          value={form.price[p] ?? ''}
                          onChange={e => setForm(f => ({ ...f, price: { ...f.price, [p]: e.target.value } }))}
                        />
                      ) : (
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          placeholder={itemDefaults?.[p]?.cost ? `${itemDefaults[p].cost}` : '0.00'}
                          value={form.cost[p] ?? ''}
                          onChange={e => setForm(f => ({ ...f, cost: { ...f.cost, [p]: e.target.value } }))}
                        />
                      )}
                    </div>
                  ))}
                </React.Fragment>
              ))}
              {modalProducts.length === 0 && (
                <div className="price-table-empty">
                  {productFilter ? `No items match "${productFilter}".` : 'No visible items. Add or unhide items on the Items tab.'}
                </div>
              )}
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

      {/* ── Add Item Modal ── */}
      {showAddProd && (
        <Modal title="Add Item" onClose={() => setShowAddProd(false)}>
          <label className="stack-label">Item / SKU name
            <input
              value={newProd}
              onChange={e => setNewProd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProduct()}
              placeholder="e.g. Bwm 999"
              autoFocus
            />
          </label>
          <label className="stack-label">Category
            <select value={newProdCat} onChange={e => setNewProdCat(e.target.value)}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddProd(false)}>Cancel</button>
            <button className="btn btn-accent" onClick={addProduct}><Plus size={14} /> Add Item</button>
          </div>
        </Modal>
      )}

      {/* ── New category (from an item's category dropdown) ── */}
      {catPrompt && (
        <Modal title="New category" onClose={() => setCatPrompt(null)}>
          <label className="stack-label">Category name
            <input
              value={catPromptName}
              onChange={e => setCatPromptName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && catPromptName.trim()) { createCategoryFor(catPrompt.product, catPromptName); setCatPrompt(null); }
              }}
              placeholder="e.g. Membranes"
              autoFocus
            />
          </label>
          {catPrompt.product && <p className="modal-hint">"{catPrompt.product}" will be moved into this category.</p>}
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setCatPrompt(null)}>Cancel</button>
            <button
              className="btn btn-accent"
              disabled={!catPromptName.trim()}
              onClick={() => { createCategoryFor(catPrompt.product, catPromptName); setCatPrompt(null); }}
            >
              <Plus size={14} /> Create
            </button>
          </div>
        </Modal>
      )}

      {/* ── Manage categories ── */}
      {showCats && (
        <Modal title="Categories" onClose={() => setShowCats(false)}>
          <p className="modal-hint">Rename a category by editing it. Deleting a category moves its items to "{DEFAULT_CATEGORY}".</p>
          <div className="cat-list">
            {categories.map(c => (
              <CategoryRow
                key={c}
                name={c}
                locked={c === DEFAULT_CATEGORY}
                count={products.filter(p => (itemDefaults?.[p]?.category || DEFAULT_CATEGORY) === c).length}
                onRename={renameCategory}
                onDelete={deleteCategory}
              />
            ))}
          </div>
          <div className="cat-add">
            <input
              placeholder="New category…"
              value={catPromptName}
              onChange={e => setCatPromptName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && catPromptName.trim()) { createCategoryFor(null, catPromptName); setCatPromptName(''); }
              }}
            />
            <button
              className="btn btn-accent"
              disabled={!catPromptName.trim()}
              onClick={() => { createCategoryFor(null, catPromptName); setCatPromptName(''); }}
            >
              <Plus size={14} /> Add
            </button>
          </div>
          <div className="modal-footer">
            <button className="btn btn-accent" onClick={() => setShowCats(false)}>Done</button>
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
                onClick={() => { if (window.confirm('Clear the saved customer name list? Your transactions are not affected.')) setState(s => ({ ...s, customers: [] })); }}>
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

      {/* ── Settings ── */}
      {showSettings && (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <label className="stack-label">Company name (shown on sales order PDFs)
            <input value={settingsDraft.company} onChange={e => setSettingsDraft(d => ({ ...d, company: e.target.value }))} />
          </label>
          <label className="stack-label">VAT rate (%)
            <input type="number" min="0" step="0.5" inputMode="decimal" value={settingsDraft.vat}
              onChange={e => setSettingsDraft(d => ({ ...d, vat: e.target.value }))} />
          </label>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>Cancel</button>
            <button className="btn btn-accent" onClick={saveSettings}>Save</button>
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
    </div>
  );
}
