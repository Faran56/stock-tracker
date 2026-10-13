import React, { useState, useEffect, useRef } from 'react';
import { X, Plus } from 'lucide-react';

// ─── Modal ───────────────────────────────────────────────────────────────────
// Clicking the dimmed backdrop intentionally does NOT close the modal — this
// avoids losing an in-progress transaction. Use the X button or Cancel.
// On phones the modal becomes a bottom sheet (see App.css).
export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal-box ${wide ? 'modal-box--wide' : ''}`}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ─── SearchableSelect ────────────────────────────────────────────────────────
// Type-to-filter combobox used for Customer and Supplier fields. Typing text
// that doesn't match an option offers to add it as new (allowCreate).
export function SearchableSelect({ value, onChange, onCreate, options, placeholder, allowCreate = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, []);

  const q = query.toLowerCase().trim();
  const filtered = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
  const exactMatch = options.some(o => o.toLowerCase() === q);

  function choose(opt) {
    setQuery(opt);
    onChange(opt);
    setOpen(false);
  }

  return (
    <div className="searchable-select" ref={wrapRef}>
      <input
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="searchable-dropdown">
          {filtered.slice(0, 50).map(opt => (
            <div key={opt} className="searchable-option" onClick={() => choose(opt)}>{opt}</div>
          ))}
          {filtered.length === 0 && !allowCreate && <div className="searchable-empty">No matches</div>}
          {allowCreate && query.trim() && !exactMatch && (
            <div
              className="searchable-option searchable-create"
              onClick={() => { onCreate && onCreate(query.trim()); choose(query.trim()); }}
            >
              <Plus size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Add "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
