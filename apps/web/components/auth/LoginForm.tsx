/**
 * @file  apps/web/components/auth/LoginForm.tsx
 * @area  Auth
 * @what  Sign-in form: Google button + email code (two steps).
 */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ google, next, error }: { google: boolean; next: string; error: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [msg, setMsg] = useState(error);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: object) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }
  async function send(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setMsg('');
    const { ok, data } = await post('/api/v1/auth/otp/request', { email });
    setBusy(false);
    if (!ok) { setMsg(data.message || 'Could not send the code.'); return; }
    setSentTo(data.masked || email); setCode('');
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('');
    const { ok, data } = await post('/api/v1/auth/otp/verify', { email, code });
    setBusy(false);
    if (!ok) { setMsg(data.message || 'That code did not work.'); return; }
    router.push(next); router.refresh();
  }

  return (
    <div>
      {google && !sentTo && (
        <>
          <a className="btn btn-block btn-google" href={`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.7 7-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </a>
          <div className="or-divider"><span />or use an email code<span /></div>
        </>
      )}

      {!sentTo ? (
        <form onSubmit={send}>
          <label className="field-label">Email
            <input className="field mt-8" type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
          </label>
          <button className="btn btn-block mt-16" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="muted small login-sent">We sent a 6-digit code to <b>{sentTo}</b>. It expires in 10 minutes.</p>
          <input className="field field-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" aria-label="6-digit code" />
          <button className="btn btn-block mt-16" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <div className="login-links">
            <button type="button" className="linkbtn quiet" onClick={() => { setSentTo(''); setMsg(''); }}>Use a different email</button>
            <button type="button" className="linkbtn accent" onClick={() => send()} disabled={busy}>Resend code</button>
          </div>
        </form>
      )}
      {msg && <p className="status err" role="alert">{msg}</p>}
    </div>
  );
}
