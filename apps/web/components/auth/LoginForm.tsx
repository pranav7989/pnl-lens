/**
 * @file  apps/web/components/auth/LoginForm.tsx
 * @area  Auth
 * @what  Sign-in card steps: email (Continue with Google · OR · Continue with email) → password, or a one-time code for a new email → set a password; Forgot password → code → new password.
 */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withViewTransition } from '@/lib/motion/viewTransition';

type Step = 'email' | 'password' | 'code' | 'set' | 'forgot';

const TITLES: Record<Step, [string, string]> = {
  email: ['Sign in or create an account', 'New here? Signing in creates your account.'],
  password: ['Welcome back', ''],
  code: ['Check your email', ''],
  set: ['Set a password', 'You’ll sign in with your email and this password next time.'],
  forgot: ['Reset your password', 'We’ll email you a code to confirm it’s you.'],
};

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.7 7-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
);

/** Password box with a show/hide button. */
function PasswordField({ value, onChange, label, autoComplete, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input className="field" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label}
             autoComplete={autoComplete} autoFocus={autoFocus} required maxLength={128} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        {show
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.7 3.9M6.6 6.6C4.6 8 3.2 10 2.5 12c1 2.5 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2.5 12C3.5 9.5 7 5 12 5s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
    </div>
  );
}

export default function LoginForm({ google, next, error, initialStep = 'email', initialEmail = '' }:
  { google: boolean; next: string; error: string; initialStep?: Step; initialEmail?: string }) {
  const router = useRouter();
  const [step, setStepNow] = useState<Step>(initialStep);
  /** step changes morph inside the card (View Transition, motion.css); instant with reduced motion or older browsers */
  const setStep = (next: Step) => withViewTransition(() => setStepNow(next), { react: true });
  const [reset, setReset] = useState(initialStep === 'forgot');          // code step leads to "Choose a new password"
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [msg, setMsg] = useState(error);
  const [busy, setBusy] = useState(false);
  const source = /[?&]from=blog(&|$)/.test(next) ? { source: 'blog' } : {};

  async function post(url: string, body: object) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } finally { setBusy(false); } };
  const go = () => { router.push(next); router.refresh(); };
  const toCode = (masked: string) => { setSentTo(masked || email); setCode(''); setStep('code'); };
  const back = () => { setStep('email'); setReset(false); setPassword(''); setConfirm(''); setMsg(''); };

  const start = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const { ok, data } = await post('/api/v1/auth/start', { email });
    if (!ok) { setMsg(data.message || 'Could not continue. Try again.'); return; }
    if (data.method === 'password') { setPassword(''); setStep('password'); } else toCode(data.masked);
  }); };
  const signIn = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const { ok, data } = await post('/api/v1/auth/password/login', { email, password, ...source });
    if (!ok) { setMsg(data.message || 'That email and password don’t match.'); return; }
    go();
  }); };
  const forgot = (e?: React.FormEvent) => { e?.preventDefault(); run(async () => {
    const { ok, data } = await post('/api/v1/auth/password/forgot', { email });
    if (!ok) { setMsg(data.message || 'Could not send the code.'); return; }
    setReset(true); toCode(data.masked);
  }); };
  const resend = () => run(async () => {
    const { ok, data } = await post(reset ? '/api/v1/auth/password/forgot' : '/api/v1/auth/otp/request', { email });
    if (!ok) { setMsg(data.message || 'Could not send the code.'); return; }
    setSentTo(data.masked || email); setCode('');
  });
  const verify = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const { ok, data } = await post('/api/v1/auth/otp/verify', { email, code, ...source });
    if (!ok) { setMsg(data.message || 'That code did not work.'); return; }
    if (data.needsPassword || reset) { setPassword(''); setConfirm(''); setStep('set'); } else go();
  }); };
  const save = (e: React.FormEvent) => { e.preventDefault();
    if (password !== confirm) { setMsg('The two passwords don’t match.'); return; }
    run(async () => {
      const { ok, data } = await post('/api/v1/auth/password/set', { password });
      if (!ok) { setMsg(data.message || 'Could not save the password.'); return; }
      go();
    });
  };

  const [title, sub] = TITLES[step];
  return (
    <div data-step={step}>
      <h3>{step === 'set' && reset ? 'Choose a new password' : title}</h3>
      {step === 'password'
        ? <p className="muted center-sub login-who"><b>{email}</b> <button type="button" className="linkbtn accent" onClick={back}>Change</button></p>
        : sub && <p className="muted center-sub">{sub}</p>}

      {step === 'email' && (
        <>
          {google && (
            <>
              <a className="btn btn-block btn-provider" href={`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`}><GoogleIcon />Continue with Google</a>
              <p className="login-or" aria-hidden="true">OR</p>
            </>
          )}
          <form onSubmit={start} className="login-email">
            <input className="field" type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email" aria-label="Email" />
            <button className="btn btn-block" disabled={busy}>{busy ? 'Please wait…' : 'Continue with email'}</button>
          </form>
        </>
      )}

      {step === 'password' && (
        <form onSubmit={signIn} className="login-email">
          <input type="email" name="email" value={email} readOnly hidden autoComplete="username" />
          <PasswordField value={password} onChange={setPassword} label="Password" autoComplete="current-password" autoFocus />
          <button className="btn btn-block" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="login-links">
            <button type="button" className="linkbtn quiet" onClick={back}>Use a different email</button>
            <button type="button" className="linkbtn accent" onClick={() => forgot()} disabled={busy}>Forgot password?</button>
          </div>
        </form>
      )}

      {step === 'forgot' && (
        <form onSubmit={forgot} className="login-email">
          <input className="field" type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email" aria-label="Email" />
          <button className="btn btn-block" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verify}>
          <p className="muted small login-sent">We sent a 6-digit code to <b>{sentTo}</b>. It expires in 10 minutes.</p>
          <input className="field field-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" aria-label="6-digit code" />
          <button className="btn btn-block mt-16" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : reset ? 'Continue' : 'Sign in'}</button>
          <div className="login-links">
            <button type="button" className="linkbtn quiet" onClick={back}>Use a different email</button>
            <button type="button" className="linkbtn accent" onClick={resend} disabled={busy}>Resend code</button>
          </div>
        </form>
      )}

      {step === 'set' && (
        <form onSubmit={save} className="login-email">
          <input type="email" name="email" value={email} readOnly hidden autoComplete="username" />
          <PasswordField value={password} onChange={setPassword} label={reset ? 'New password' : 'Password'} autoComplete="new-password" autoFocus />
          <PasswordField value={confirm} onChange={setConfirm} label="Repeat the password" autoComplete="new-password" />
          <p className="muted small login-rule">At least 8 characters. Avoid common words and your email.</p>
          <button className="btn btn-block" disabled={busy || !password || !confirm}>{busy ? 'Saving…' : 'Save and continue'}</button>
        </form>
      )}

      {msg && <p className="status err" role="alert">{msg}</p>}
    </div>
  );
}
