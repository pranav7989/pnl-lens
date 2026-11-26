/**
 * @file  apps/web/components/workspace/PlanButton.tsx
 * @area  Reports
 * @what  "30-day plan" button at the top right of a report: downloads the server-built PDF of 5 Do and 5 Don't rules (the one download a report has).
 */
'use client';
import { useState } from 'react';

export default function PlanButton({ reportId, onError }: { reportId: string; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/reports/${reportId}/plan.pdf`, { credentials: 'same-origin' });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(res.status === 429 ? 'Too many downloads in a minute. Try again shortly.' : j?.message && j.message !== j.error ? j.message : 'Please try again in a moment.');
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'pnl-lens-30-day-plan.pdf';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <button className="btn plan-dl" onClick={download} disabled={busy} aria-busy={busy} data-plan-download
      title="Your do’s and don’ts for the next 30 days, built from this report">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11" /><path d="M7 10.5 12 15.5 17 10.5" /><path d="M5 20h14" />
      </svg>
      {busy ? 'Preparing your plan…' : '30-day plan'}
    </button>
  );
}
