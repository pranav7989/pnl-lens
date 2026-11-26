/**
 * @file  apps/web/components/workspace/UnsubscribeButton.tsx
 * @area  Reports
 * @what  The button on /unsubscribe that stops the weekly summary email (POST with the link's token).
 */
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '@/lib/api-browser';

export default function UnsubscribeButton({ u, t }: { u: string; t: string }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask'), [err, setErr] = useState('');
  async function stop() {
    setState('busy'); setErr('');
    try { await api('/digest/unsubscribe', { body: { u, t } }); setState('done'); }
    catch (e) { setErr((e as ApiError).message || 'Could not stop the emails.'); setState('ask'); }
  }
  if (state === 'done') return (<><p className="muted" data-unsubscribed>Done. You will not get the weekly summary any more. You can turn it back on in Dashboard → Your data.</p><Link className="btn ghost" href="/dashboard">Go to your reports</Link></>);
  return (
    <>
      <p className="muted">Stop the Monday summary of your focus rules, journal and check-up date?</p>
      {err && <p className="status err" role="alert">{err}</p>}
      <button type="button" className="btn" onClick={stop} disabled={state === 'busy'}>{state === 'busy' ? 'Stopping…' : 'Stop the weekly summary'}</button>
    </>
  );
}
