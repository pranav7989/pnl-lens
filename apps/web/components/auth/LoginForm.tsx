/**
 * @file  apps/web/components/auth/LoginForm.tsx
 * @area  Auth
 * @what  Sign-in form: Google button + email code (two steps).
 */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = { background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '11px 12px', width: '100%', marginTop: 4 } as const;

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
    const { ok, data } = await post('/api/auth/otp/request', { email });
    setBusy(false);
    if (!ok) { setMsg(data.message || 'Could not send the code.'); return; }
    setSentTo(data.masked || email); setCode('');
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('');
    const { ok, data } = await post('/api/auth/otp/verify', { email, code });
    setBusy(false);
    if (!ok) { setMsg(data.message || 'That code did not work.'); return; }
    router.push(next); router.refresh();
  }

  return (
    <div>
      {google && !sentTo && (
        <>
          <a className="btn" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
             style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', textDecoration: 'none', background: '#fff', color: '#1f1f1f' }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.7 7-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--muted)', fontSize: 12 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />or use an email code<span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
        </>
      )}

      {!sentTo ? (
        <form onSubmit={send}>
          <label className="muted" style={{ fontSize: 13 }}>Email
            <input style={input} type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
          </label>
          <button className="btn" style={{ marginTop: 14, width: '100%' }} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>We sent a 6-digit code to <b style={{ color: 'var(--ink)' }}>{sentTo}</b>. It expires in 10 minutes.</p>
          <input style={{ ...input, fontSize: 22, letterSpacing: 8, textAlign: 'center' }} name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" aria-label="6-digit code" />
          <button className="btn" style={{ marginTop: 14, width: '100%' }} disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
            <button type="button" className="linkbtn" style={{ color: 'var(--muted)' }} onClick={() => { setSentTo(''); setMsg(''); }}>Use a different email</button>
            <button type="button" className="linkbtn" style={{ color: 'var(--y)' }} onClick={() => send()} disabled={busy}>Resend code</button>
          </div>
        </form>
      )}
      {msg && <p className="status err" role="alert">{msg}</p>}
    </div>
  );
}
