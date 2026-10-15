// ─── Cloud sync engine ───────────────────────────────────────────────────────
// The app keeps working from one local `state` object (and localStorage). This
// file mirrors that state to Firestore and merges changes made on other devices.
//
//  • rows & orders are synced one document per record
//  • everything else (items, categories, customers, suppliers, settings) is one
//    small "meta" document
//
// To decide what changed, we remember a fingerprint ("shadow") of what the cloud
// held the last time this device synced. Comparing local ↔ cloud ↔ shadow tells
// us whether a record was added, edited or deleted here or elsewhere.
import { useEffect, useRef, useState } from 'react';
import { subscribeKind, commitOps, PROJECT_ID } from './cloud';

export const META_KEYS = ['products', 'categories', 'itemDefaults', 'customers', 'suppliers', 'settings', 'catsCleaned'];
const KINDS = ['rows', 'orders', 'meta'];
const SHADOW_KEY = 'stock_sync_shadow_v1';
const PRISTINE_PRODUCTS = ['211G', 'Bwm 303', 'Bwm 777'];

// ── hashing ──────────────────────────────────────────────────────────────────
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const hashCache = new WeakMap();
export function hashVal(v) {
  if (v && typeof v === 'object') {
    let h = hashCache.get(v);
    if (!h) { h = cyrb53(stableStringify(v)); hashCache.set(v, h); }
    return h;
  }
  return cyrb53(stableStringify(v));
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function parseDoc(json, id) {
  try {
    const o = JSON.parse(json);
    if (id && o && typeof o === 'object' && !Array.isArray(o) && 'id' in o) o.id = id;
    return o;
  } catch {
    return null;
  }
}

// ── pure merge helpers (unit-tested) ─────────────────────────────────────────
// local: array of records · cloud: Map(id → json text) · shadow: { id → hash }
export function mergeCollection(local, cloud, shadow) {
  const localMap = new Map(local.map(x => [x.id, x]));
  const ids = [...localMap.keys()];
  cloud.forEach((_, id) => { if (!localMap.has(id)) ids.push(id); });

  const items = [], push = [], del = [];
  ids.forEach(id => {
    const l = localMap.get(id);
    const cj = cloud.get(id);
    const c = cj != null ? parseDoc(cj, id) : null;
    const lh = l ? hashVal(l) : null;
    const ch = c ? hashVal(c) : null;
    const sh = shadow[id] || null;

    if (l && c) {
      if (lh === ch) items.push(l);
      else if (sh && lh === sh) items.push(c);                     // changed elsewhere
      else if (sh && ch === sh) { items.push(l); push.push(l); }   // changed here
      else items.push(c);                                          // both changed: cloud wins
    } else if (l) {                                                // not in cloud
      if (sh && lh === sh) { /* deleted elsewhere → drop it here */ }
      else { items.push(l); push.push(l); }                        // new here (or edited here)
    } else if (c) {                                                // only in cloud
      if (sh && ch === sh) del.push(id);                           // deleted here → delete there
      else items.push(c);                                          // new elsewhere
    }
  });

  const nextShadow = {};
  items.forEach(x => { nextShadow[x.id] = hashVal(x); });
  return { items, push, del, nextShadow };
}

export function pickMeta(state) {
  const m = {};
  META_KEYS.forEach(k => { if (state[k] !== undefined) m[k] = state[k]; });
  return m;
}

function unionList(primary = [], extra = []) {
  const out = [...primary];
  extra.forEach(x => { if (!out.includes(x)) out.push(x); });
  return out;
}

export function mergeMeta(localMeta, cloudMeta, shadowHash, pristine) {
  if (!cloudMeta) return { meta: localMeta, push: true };
  const lh = hashVal(localMeta), ch = hashVal(cloudMeta);
  if (lh === ch) return { meta: localMeta, push: false };
  if (pristine) return { meta: cloudMeta, push: false };
  if (shadowHash && lh === shadowHash) return { meta: cloudMeta, push: false };
  if (shadowHash && ch === shadowHash) return { meta: localMeta, push: true };
  const meta = {
    ...cloudMeta,
    products: unionList(cloudMeta.products, localMeta.products),
    categories: unionList(cloudMeta.categories, localMeta.categories),
    customers: unionList(cloudMeta.customers, localMeta.customers),
    suppliers: unionList(cloudMeta.suppliers, localMeta.suppliers),
    itemDefaults: { ...(localMeta.itemDefaults || {}), ...(cloudMeta.itemDefaults || {}) },
    catsCleaned: !!(cloudMeta.catsCleaned || localMeta.catsCleaned),
  };
  return { meta, push: hashVal(meta) !== ch };
}

// A brand-new install that has never been used: safe to replace with cloud data.
export function isPristine(state) {
  const sameProducts = state.products.length === PRISTINE_PRODUCTS.length
    && state.products.every((p, i) => p === PRISTINE_PRODUCTS[i]);
  const noPrices = Object.values(state.itemDefaults || {}).every(d => !d.cost && !d.price && !d.hidden && !d.internal);
  return sameProducts && noPrices && !state.rows.length && !state.orders.length
    && !state.customers.length && !state.suppliers.length;
}

// ── shadow persistence ───────────────────────────────────────────────────────
function emptyShadow() { return { project: PROJECT_ID, rows: {}, orders: {}, meta: null }; }
function loadShadow() {
  try {
    const s = JSON.parse(localStorage.getItem(SHADOW_KEY) || 'null');
    if (s && s.project === PROJECT_ID) return { ...emptyShadow(), ...s };
  } catch {}
  return emptyShadow();
}
function saveShadow(sh) {
  try { localStorage.setItem(SHADOW_KEY, JSON.stringify(sh)); } catch {}
}

// ── React hook ───────────────────────────────────────────────────────────────
export function useCloudSync({ enabled, state, setState, normalize, userEmail }) {
  const [info, setInfo] = useState({ phase: 'off', message: '', last: null });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const stateRef = useRef(state);
  stateRef.current = state;
  const S = useRef({
    active: false, shadow: emptyShadow(), cloud: null, got: null, timer: null, retry: null, pending: 0, email: '',
  });
  S.current.email = userEmail || '';

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── connect / disconnect ──
  useEffect(() => {
    const s = S.current;
    if (!enabled) {
      s.active = false;
      setInfo({ phase: 'off', message: '', last: null });
      return undefined;
    }
    s.active = false;
    s.shadow = loadShadow();
    s.cloud = { rows: new Map(), orders: new Map(), meta: new Map() };
    s.got = { rows: false, orders: false, meta: false };
    setInfo({ phase: 'connecting', message: '', last: null });

    const fail = (err) => {
      const code = (err && err.code) || '';
      const message = code.includes('permission')
        ? 'Permission denied — check the Firestore rules and that your email is listed.'
        : (err && err.message) || 'Sync problem';
      setInfo(i => ({ ...i, phase: 'error', message }));
    };

    function initialMerge() {
      const local = stateRef.current;
      const pristine = isPristine(local);
      const shadow = s.shadow;

      const rowsRes = mergeCollection(pristine ? [] : local.rows, s.cloud.rows, shadow.rows);
      const ordersRes = mergeCollection(pristine ? [] : local.orders, s.cloud.orders, shadow.orders);
      const cloudMetaJson = s.cloud.meta.get('config');
      const cloudMeta = cloudMetaJson != null ? parseDoc(cloudMetaJson) : null;
      const metaRes = mergeMeta(pickMeta(local), cloudMeta, shadow.meta, pristine && !!cloudMeta);

      s.shadow = {
        project: PROJECT_ID,
        rows: rowsRes.nextShadow,
        orders: ordersRes.nextShadow,
        meta: hashVal(metaRes.meta),
      };
      saveShadow(s.shadow);

      setState(normalize({ ...local, ...clone(metaRes.meta), rows: rowsRes.items, orders: ordersRes.items }));

      const ops = [];
      rowsRes.push.forEach(x => ops.push({ kind: 'rows', id: x.id, json: stableStringify(x) }));
      rowsRes.del.forEach(id => ops.push({ kind: 'rows', id, json: null }));
      ordersRes.push.forEach(x => ops.push({ kind: 'orders', id: x.id, json: stableStringify(x) }));
      ordersRes.del.forEach(id => ops.push({ kind: 'orders', id, json: null }));
      if (metaRes.push) ops.push({ kind: 'meta', id: 'config', json: stableStringify(metaRes.meta) });

      s.active = true;
      send(ops);
      if (ops.length === 0) setInfo({ phase: 'synced', message: '', last: Date.now() });
    }

    function applyRemote(kind, upserts, removed) {
      setState(st => {
        const byId = new Map(upserts.map(o => [o.id, o]));
        const gone = new Set(removed);
        const next = [];
        st[kind].forEach(x => {
          if (gone.has(x.id)) return;
          if (byId.has(x.id)) { next.push(byId.get(x.id)); byId.delete(x.id); } else next.push(x);
        });
        byId.forEach(o => next.push(o));
        return { ...st, [kind]: next };
      });
    }

    function onChanges(kind, changes, meta) {
      if (!s.active) {
        changes.forEach(c => {
          if (c.type === 'removed') s.cloud[kind].delete(c.id);
          else if (c.json != null) s.cloud[kind].set(c.id, c.json);
        });
        s.got[kind] = true;
        if (KINDS.every(k => s.got[k])) initialMerge();
        return;
      }

      // after the first merge: apply what other devices changed
      if (kind === 'meta') {
        const c = changes.filter(x => x.type !== 'removed' && x.json != null).pop();
        if (c) {
          const obj = parseDoc(c.json);
          if (obj && hashVal(obj) !== s.shadow.meta) {
            s.shadow.meta = hashVal(obj);
            saveShadow(s.shadow);
            setState(st => normalize({ ...st, ...clone(obj) }));
          }
        }
      } else {
        const upserts = [], removed = [];
        changes.forEach(c => {
          if (c.type === 'removed') {
            if (s.shadow[kind][c.id]) { delete s.shadow[kind][c.id]; removed.push(c.id); }
            return;
          }
          const obj = c.json != null ? parseDoc(c.json, c.id) : null;
          if (!obj) return;
          const h = hashVal(obj);
          if (s.shadow[kind][c.id] === h) return;       // our own write coming back
          s.shadow[kind][c.id] = h;
          upserts.push(obj);
        });
        if (upserts.length || removed.length) { saveShadow(s.shadow); applyRemote(kind, upserts, removed); }
      }
      if (!meta.pending && !meta.fromCache && s.pending === 0) setInfo(i => ({ ...i, phase: 'synced', message: '', last: Date.now() }));
    }

    function send(ops) {
      if (!ops.length) return;
      s.pending += 1;
      setInfo(i => ({ ...i, phase: 'syncing' }));
      commitOps(ops, s.email)
        .then(() => {
          s.pending -= 1;
          if (s.pending === 0) setInfo({ phase: 'synced', message: '', last: Date.now() });
        })
        .catch(err => {
          s.pending -= 1;
          // forget the fingerprints so the next pass sends these again
          ops.forEach(o => {
            if (o.kind === 'meta') s.shadow.meta = null;
            else if (o.json == null) s.shadow[o.kind][o.id] = 'retry';
            else delete s.shadow[o.kind][o.id];
          });
          saveShadow(s.shadow);
          fail(err);
          clearTimeout(s.retry);
          s.retry = setTimeout(() => flush(), 15000);
        });
    }

    function flush() {
      if (!s.active) return;
      const st = stateRef.current;
      const ops = [];
      ['rows', 'orders'].forEach(kind => {
        const seen = new Set();
        st[kind].forEach(x => {
          seen.add(x.id);
          const h = hashVal(x);
          if (s.shadow[kind][x.id] !== h) {
            ops.push({ kind, id: x.id, json: stableStringify(x) });
            s.shadow[kind][x.id] = h;
          }
        });
        Object.keys(s.shadow[kind]).forEach(id => {
          if (!seen.has(id)) { ops.push({ kind, id, json: null }); delete s.shadow[kind][id]; }
        });
      });
      const m = pickMeta(st);
      const mh = hashVal(m);
      if (s.shadow.meta !== mh) { ops.push({ kind: 'meta', id: 'config', json: stableStringify(m) }); s.shadow.meta = mh; }
      if (ops.length) { saveShadow(s.shadow); send(ops); }
    }
    s.flush = flush;

    const unsubs = KINDS.map(kind =>
      subscribeKind(kind, (changes, meta) => onChanges(kind, changes, meta), fail)
    );
    return () => {
      unsubs.forEach(u => u && u());
      clearTimeout(s.timer);
      clearTimeout(s.retry);
      s.active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── push local edits (debounced) ──
  useEffect(() => {
    const s = S.current;
    if (!enabled || !s.active) return undefined;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => s.flush && s.flush(), 600);
    return () => clearTimeout(s.timer);
  }, [state, enabled]);

  return { ...info, online, active: enabled && info.phase !== 'connecting' && info.phase !== 'off' };
}
