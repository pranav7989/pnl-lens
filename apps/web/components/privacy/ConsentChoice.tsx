'use client';
/**
 * @file  apps/web/components/privacy/ConsentChoice.tsx
 * @area  Privacy
 * @what  Research consent from the email link: shows the exact wording, records Yes / No thanks once, then a thank-you; expired / answered / invalid states.
 */
import { useState } from 'react';
import { CONSENT_RESEARCH } from '@/components/workspace/model';

export default function ConsentChoice({ token, state, saved, preselect }: { token: string; state: string; saved?: 'yes' | 'no'; preselect?: 'yes' | 'no' }) {
  const [done, setDone] = useState<'yes' | 'no' | null>(state === 'answered' ? saved ?? null : null);
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);

  async function answer(a: 'yes' | 'no') {
    setBusy(true); setMsg('');
    const res = await fetch(`/api/v1/research/invite/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: a }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setDone(a); else setMsg(data.message || 'Something went wrong. Please try again.');
  }

  if (state === 'invalid') return <><h3>This link is not valid</h3><p className="muted center-sub">It may have been copied incompletely. Nothing has changed. You can manage your choice anytime in Dashboard → Your data.</p></>;
  if (state === 'expired') return <><h3>This link has expired</h3><p className="muted center-sub">Nothing has changed. You can choose anytime in Dashboard → Your data.</p><a className="btn btn-block" href="/dashboard">Open my dashboard</a></>;
  if (done || state === 'answered') {
    return (
      <div data-done={done ?? 'answered'}>
        <h3>Thank you</h3>
        <p className="muted center-sub">{done === 'yes' ? 'Your reports will help improve PnL Lens. Your name and email are never included.'
          : done === 'no' ? 'Got it: your reports stay out. We won’t ask again for a while.' : 'Your choice is saved.'}</p>
        <p className="muted small">You can change your choice anytime in Dashboard → Your data.</p>
      </div>
    );
  }
  return (
    <div>
      <h3>Help improve PnL Lens</h3>
      <p className="muted center-sub">Would you like your past reports to help us spot trading patterns more accurately for everyone?</p>
      <blockquote className="rc-quote">{CONSENT_RESEARCH}</blockquote>
      <ul className="rc-list">
        <li>We use the trades and statistics from your reports, with your name and email removed.</li>
        <li>Never sold, never shown to anyone else.</li>
        <li>You can change this anytime in Dashboard → Your data.</li>
      </ul>
      <div className="login-email">
        <button className={`btn btn-block${preselect === 'no' ? ' ghost' : ''}`} disabled={busy} onClick={() => answer('yes')}>Yes, include my reports</button>
        <button className={`btn btn-block ${preselect === 'no' ? '' : 'ghost'}`} disabled={busy} onClick={() => answer('no')}>No thanks</button>
      </div>
      {msg && <p className="status err" role="alert">{msg}</p>}
    </div>
  );
}
