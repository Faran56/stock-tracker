import React, { useMemo, useState } from 'react';
import {
  Search, Plus, Eye, EyeOff, ArrowUp, ArrowDown, Tag, Layers, Package, AlertTriangle,
} from 'lucide-react';
import { fmt, money } from './utils';

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'bal', label: 'Stock balance' },
  { key: 'value', label: 'Stock value' },
  { key: 'price', label: 'Sale price' },
  { key: 'margin', label: 'Margin' },
];

const STOCK_FILTERS = [
  ['All', 'All stock levels'],
  ['alert', 'Needs attention'],
  ['ok', 'In stock'],
  ['low', 'Low stock'],
  ['out', 'Out of stock'],
];

const STATUS_LABEL = { ok: 'In stock', low: 'Low', out: 'Out', over: 'Oversold' };

function compare(a, b, key) {
  const av = a[key], bv = b[key];
  // nulls (e.g. margin with no price) always sink to the bottom
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string') return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
  return av - bv;
}

export default function Items({
  info, categories, onUpdateDefault, onSetCategory, onToggleHidden,
  onAddProduct, onNewCategory, onManageCategories, presetStock,
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState(presetStock || 'All');
  const [showHidden, setShowHidden] = useState(false);
  const [grouped, setGrouped] = useState(categories.length > 1);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const active = useMemo(() => info.filter(i => !i.hidden), [info]);
  const hiddenCount = info.length - active.length;

  const kpi = useMemo(() => ({
    items: active.length,
    units: active.reduce((s, i) => s + Math.max(i.bal, 0), 0),
    value: active.reduce((s, i) => s + i.value, 0),
    alerts: active.filter(i => i.alert).length,
  }), [active]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = info.filter(i => {
      if (i.hidden && !showHidden) return false;
      if (catFilter !== 'All' && i.category !== catFilter) return false;
      if (q && !(`${i.name} ${i.category}`.toLowerCase().includes(q))) return false;
      if (stockFilter === 'alert' && !i.alert) return false;
      if (stockFilter === 'ok' && i.status !== 'ok') return false;
      if (stockFilter === 'low' && i.status !== 'low') return false;
      if (stockFilter === 'out' && i.status !== 'out' && i.status !== 'over') return false;
      return true;
    });
    out.sort((a, b) => {
      const c = compare(a, b, sortBy);
      const r = sortDir === 'asc' ? c : -c;
      return r !== 0 ? r : a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return out;
  }, [info, search, catFilter, stockFilter, showHidden, sortBy, sortDir]);

  const groups = useMemo(() => {
    if (!grouped) return [{ category: null, items: list }];
    const map = {};
    list.forEach(i => { (map[i.category] = map[i.category] || []).push(i); });
    const order = [...categories.filter(c => map[c]), ...Object.keys(map).filter(c => !categories.includes(c))];
    return order.map(c => ({ category: c, items: map[c] }));
  }, [list, grouped, categories]);

  function headerSort(key) {
    if (sortBy === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  }
  function sortArrow(key) {
    if (sortBy !== key) return null;
    return sortDir === 'asc' ? <ArrowUp size={12} className="sort-icon active" /> : <ArrowDown size={12} className="sort-icon active" />;
  }

  function renderRow(i) {
    const catOptions = categories.includes(i.category) ? categories : [...categories, i.category];
    return (
      <div key={i.name} className={`gt-row items-row ${i.hidden ? 'is-hidden' : ''}`}>
        <div className="gt-cell gt-title">
          <span className="item-name">{i.name}</span>
          {i.hidden && <span className="hidden-tag">Hidden</span>}
          {i.internal && <span className="hidden-tag prod-tag">Production</span>}
        </div>

        <div className="gt-cell" data-label="Category">
          <select
            className="cat-select"
            value={i.category}
            onChange={e => (e.target.value === '__new__' ? onNewCategory(i.name) : onSetCategory(i.name, e.target.value))}
          >
            {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">＋ New category…</option>
          </select>
        </div>

        <div className="gt-cell" data-label="Used for">
          <select
            className="cat-select"
            value={i.internal ? 'production' : 'sale'}
            onChange={e => onUpdateDefault(i.name, 'internal', e.target.value === 'production')}
            title="Production materials are consumed in manufacturing, so they are left out of sales profit in Reports"
          >
            <option value="sale">Sale</option>
            <option value="production">Production</option>
          </select>
        </div>

        <div className="gt-cell" data-label="In stock">
          <div className="bal-wrap">
            <span className={`bal-num ${i.bal < 0 ? 'neg' : i.bal === 0 ? 'zero' : ''}`}>{fmt(i.bal)}</span>
            {(i.alert || i.status === 'over') && (
              <span className={`stock-tag stock-tag--${i.status}`}>{STATUS_LABEL[i.status]}</span>
            )}
          </div>
          <div className="bal-sub">in {fmt(i.tin)} · out {fmt(i.tout)}</div>
        </div>

        <div className="gt-cell" data-label="Reorder at">
          <input
            type="number" min="0" step="1" placeholder="—" inputMode="numeric"
            className="items-input"
            value={i.raw.min}
            onChange={e => onUpdateDefault(i.name, 'minStock', e.target.value)}
          />
        </div>

        <div className="gt-cell" data-label="Cost (AED)">
          <input
            type="number" min="0" step="0.01" placeholder="0.00" inputMode="decimal"
            className="items-input"
            value={i.raw.cost}
            onChange={e => onUpdateDefault(i.name, 'cost', e.target.value)}
          />
        </div>

        <div className="gt-cell" data-label="Price (AED)">
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className="items-input"
            placeholder={i.internal ? 'n/a' : '0.00'}
            disabled={i.internal}
            value={i.internal ? '' : i.raw.price}
            onChange={e => onUpdateDefault(i.name, 'price', e.target.value)}
          />
        </div>

        <div className="gt-cell gt-num" data-label="Margin">
          <span className={i.internal || i.margin == null ? 'text-muted' : i.margin < 0 ? 'neg-text' : 'profit-text'}>
            {i.internal || i.margin == null ? '—' : `${i.margin.toFixed(1)}%`}
          </span>
        </div>

        <div className="gt-cell gt-num" data-label="Stock value">
          <span className="mono-cell">{i.value > 0 ? money(i.value) : '—'}</span>
        </div>

        <div className="gt-cell gt-actions">
          <button
            className="icon-btn"
            onClick={() => onToggleHidden(i.name)}
            title={i.hidden ? 'Show this item again' : 'Hide this item'}
            aria-label={i.hidden ? 'Show item' : 'Hide item'}
          >
            {i.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page items-page">
      <div className="page-head">
        <div>
          <h2>Items</h2>
          <p className="page-sub">
            Your inventory in one place. Cost and price auto-fill new transactions. Mark raw materials as
            “Production” so they never count as a sale at a loss. Hide items you no longer use — they stay in your history.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={onManageCategories}><Tag size={15} /> Categories</button>
          <button className="btn btn-accent" onClick={onAddProduct}><Plus size={15} /> Add Item</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Items</span>
          <b className="stat-value">{kpi.items}</b>
          <span className="stat-sub">{hiddenCount > 0 ? `${hiddenCount} hidden` : `${categories.length} categories`}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Units in stock</span>
          <b className="stat-value">{fmt(kpi.units)}</b>
          <span className="stat-sub">across visible items</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Stock value (cost)</span>
          <b className="stat-value stat-value--sm">{money(kpi.value)}</b>
          <span className="stat-sub">needs cost on items</span>
        </div>
        <div className={`stat-card ${kpi.alerts > 0 ? 'stat-card--warn' : ''}`}>
          <span className="stat-label">Needs attention</span>
          <b className="stat-value">{kpi.alerts}</b>
          <span className="stat-sub">low or out of stock</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrap grow">
          <Search size={14} className="search-icon" />
          <input className="search-input" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} aria-label="Filter by category">
          <option value="All">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} aria-label="Filter by stock level">
          {STOCK_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="sort-group">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort by">
            {SORTS.map(s => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            aria-label="Toggle sort direction"
          >
            {sortDir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </button>
        </div>
      </div>

      <div className="toggle-row">
        <label className="check">
          <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />
          <Layers size={13} /> Group by category
        </label>
        <label className="check">
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          <Eye size={13} /> Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
        </label>
        <span className="result-count">{list.length} of {info.length} items</span>
      </div>

      <div className="gt items-gt">
        <div className="gt-head">
          <div className="gt-h sortable" onClick={() => headerSort('name')}>Item {sortArrow('name')}</div>
          <div className="gt-h sortable" onClick={() => headerSort('category')}>Category {sortArrow('category')}</div>
          <div className="gt-h">Used for</div>
          <div className="gt-h sortable" onClick={() => headerSort('bal')}>In stock {sortArrow('bal')}</div>
          <div className="gt-h">Reorder at</div>
          <div className="gt-h">Cost (AED)</div>
          <div className="gt-h sortable" onClick={() => headerSort('price')}>Price (AED) {sortArrow('price')}</div>
          <div className="gt-h gt-num sortable" onClick={() => headerSort('margin')}>Margin {sortArrow('margin')}</div>
          <div className="gt-h gt-num sortable" onClick={() => headerSort('value')}>Value {sortArrow('value')}</div>
          <div className="gt-h"></div>
        </div>

        {list.length === 0 && (
          <div className="empty-state">
            <Package size={28} />
            <p>{info.length === 0 ? 'No items yet. Add your first item.' : 'No items match these filters.'}</p>
          </div>
        )}

        {groups.map(g => (
          <React.Fragment key={g.category || 'all'}>
            {g.category && (
              <div className="gt-group">
                <span className="gt-group-name"><Tag size={12} /> {g.category}</span>
                <span className="gt-group-meta">
                  {g.items.length} {g.items.length === 1 ? 'item' : 'items'}
                  {' · '}{fmt(g.items.reduce((s, i) => s + Math.max(i.bal, 0), 0))} units
                  {g.items.some(i => i.alert) && (
                    <span className="gt-group-warn"><AlertTriangle size={11} /> {g.items.filter(i => i.alert).length}</span>
                  )}
                </span>
              </div>
            )}
            {g.items.map(renderRow)}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
