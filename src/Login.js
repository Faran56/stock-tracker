import React, { useState } from 'react';
import { Package, LogIn, Loader2 } from 'lucide-react';
import { signIn, resetPassword } from './cloud';

function friendly(err) {
  const code = (err && err.code) || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Email or password is not correct.';
  if (code.includes('invalid-email')) return 'That email address does not look right.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('network')) return 'No internet connection. Connect and try again.';
  if (code.includes('operation-not-allowed')) return 'Email/Password sign-in is not enabled in Firebase yet (Authentication → Sign-in method).';
  if (code.includes('user-disabled')) return 'This account has been disabled.';
  return (err && err.message) || 'Could not sign in.';
}

export default function Login({ onLocalOnly }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function submit() {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError(''); setNote('');
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) { setError('Type your email first, then tap “Forgot password”.'); return; }
    setError(''); setNote('');
    try {
      await resetPassword(email.trim());
      setNote('If that email has an account, a reset link is on its way.');
    } catch (e) {
      setError(friendly(e));
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><Package size={22} /></div>
          <div>
            <div className="brand-name login-name">Stock Tracker</div>
            <div className="login-sub">Sign in to sync your data across devices</div>
          </div>
        </div>

        <label className="stack-label">Email
          <input type="email" autoComplete="username" inputMode="email" value={email}
            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} autoFocus />
        </label>
        <label className="stack-label">Password
          <input type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </label>

        {error && <div className="form-error">{error}</div>}
        {note && <div className="form-note">{note}</div>}

        <button className="btn btn-accent login-btn" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />} Sign in
        </button>
        <div className="login-links">
          <button className="link-btn" onClick={forgot}>Forgot password?</button>
          <button className="link-btn" onClick={onLocalOnly}>Use without syncing</button>
        </div>
        <p className="login-foot">“Use without syncing” works only on this device and is not backed up to the cloud.</p>
      </div>
    </div>
  );
}
