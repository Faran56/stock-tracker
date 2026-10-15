// ─── Firebase connection (thin wrapper) ──────────────────────────────────────
// All Firebase calls live here so the rest of the app never imports the SDK.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch,
} from 'firebase/firestore';

// These values identify your project. They are safe to be public: your data is
// protected by the Firestore security rules and by signing in, not by hiding them.
const firebaseConfig = {
  apiKey: 'AIzaSyCUcpYLp5QsPVZfQlnrJINVyLO68XOPBEU',
  authDomain: 'stock-tracker-9097a.firebaseapp.com',
  projectId: 'stock-tracker-9097a',
  storageBucket: 'stock-tracker-9097a.firebasestorage.app',
  messagingSenderId: '935979231348',
  appId: '1:935979231348:web:d39b5f5265df3df1dfc921',
};

export const PROJECT_ID = firebaseConfig.projectId;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Offline-first: Firestore keeps a copy on the device, so the app keeps working
// without signal and uploads changes when the connection returns.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  db = getFirestore(app);
}

// ── auth ─────────────────────────────────────────────────────────────────────
export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signOutUser = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

// ── data ─────────────────────────────────────────────────────────────────────
// Layout:  workspaces/main/{rows|orders|meta}/{id}  →  { json, updatedAt, by }
// "json" is the whole record as text, which keeps every field name safe and
// makes change detection exact.
export function subscribeKind(kind, onChanges, onError) {
  const col = collection(db, 'workspaces', 'main', kind);
  return onSnapshot(
    col,
    (snap) => {
      const changes = snap.docChanges().map(c => ({
        id: c.doc.id,
        type: c.type,
        json: c.type === 'removed' ? null : (c.doc.data().json ?? null),
      }));
      onChanges(changes, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
    },
    onError
  );
}

// ops: [{ kind, id, json }]  — json === null means delete
export async function commitOps(ops, by) {
  const SIZE = 400;
  for (let i = 0; i < ops.length; i += SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + SIZE).forEach(o => {
      const ref = doc(db, 'workspaces', 'main', o.kind, o.id);
      if (o.json == null) batch.delete(ref);
      else batch.set(ref, { json: o.json, updatedAt: Date.now(), by: by || '' });
    });
    await batch.commit();
  }
}
