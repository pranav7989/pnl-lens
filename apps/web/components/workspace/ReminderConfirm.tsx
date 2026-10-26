/**
 * @file  apps/web/components/workspace/ReminderConfirm.tsx
 * @area  Reports
 * @what  Confirms a check-up reminder: "Remind me on 20 Nov 2026?" → Turn on reminder → "Done. We'll email you on 20 Nov."
 */
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '@/lib/api-browser';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
const shortDate = (iso: string) => longDate(iso).replace(/ \d{4}$/, '');

export default function ReminderConfirm({ date, reportId }: { date: string; reportId: string | null }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask');
  const [error, setError] = useState('');
  const back = reportId ? `/report/${reportId}` : '/dashboard';
  if (!date) {
    return (<><h1 className="page-title" style={{ fontSize: 24 }}>This reminder link is incomplete</h1>
      <p className="muted" style={{ margin: '8px 0 16px' }}>Open “Remind me” again from your 30-day plan.</p>
      <Link className="btn ghost" href="/dashboard">Go to your reports</Link></>);
  }
  async function turnOn() {
    setState('busy'); setError('');
    try { await api('/me/reminders', { body: { reportId, date } }); setState('done'); }
    catch (e) { setError((e as ApiError).message || 'Could not turn on the reminder.'); setState('ask'); }
  }
  if (state === 'done') {
    return (<><h1 className="page-title" style={{ fontSize: 24 }} data-reminder-done>Done. We’ll email you on {shortDate(date)}.</h1>
      <p className="muted" style={{ margin: '8px 0 16px' }}>One email, on the morning of your check-up. You can cancel it anytime in Dashboard → Your data.</p>
      <Link className="btn" href={back}>{reportId ? 'Back to your report' : 'Go to your reports'}</Link></>);
  }
  return (
    <>
      <h1 className="page-title" style={{ fontSize: 24 }}>Remind me on {longDate(date)}?</h1>
      <p className="muted" style={{ margin: '8px 0 16px' }}>We’ll send one email that morning to upload next month’s statement and get your next 30-day plan.</p>
      {error && <p className="err" role="alert" style={{ color: 'var(--loss)', margin: '0 0 12px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={turnOn} disabled={state === 'busy'}>{state === 'busy' ? 'Turning on…' : 'Turn on reminder'}</button>
        <Link className="btn ghost" href={back}>Cancel</Link>
      </div>
    </>
  );
}
