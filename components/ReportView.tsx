/**
 * @file  components/ReportView.tsx
 * @area  Reports
 * @what  Mounts the shared report renderer (lib/report-ui/render.js) and adds CSV/PDF/delete actions.
 */
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { mountReport } from '@/lib/report-ui/render.js';
import { formatterFor } from '@/lib/engine';
import type { ReportV1 } from '@/lib/engine/types';
import type { ReportSummary } from '@/lib/store/types';

export default function ReportView({ report, summary }: { report: ReportV1; summary: ReportSummary }) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!root.current) return;
    const h = mountReport(root.current, report, formatterFor(report));
    return () => h.destroy();
  }, [report]);

  const daysLeft = Math.max(0, Math.ceil((new Date(summary.expiresAt).getTime() - Date.now()) / 864e5));

  function exportCsv() {
    const cols = ['symbol', 'group', 'market', 'direction', 'entryDate', 'exitDate', 'entryHour', 'holdDays', 'qty', 'avgBuy', 'buy', 'sell', 'pct', 'pnl', 'netEst'];
    const esc = (v: unknown) => (v == null ? '' : typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
    const rows = [cols.join(','), ...report.trades.map((t: any) => cols.map((c) => esc(t[c])).join(','))];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `pnl-lens-${summary.id.slice(0, 8)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function remove() {
    if (!confirm('Delete this report permanently? This cannot be undone and the credit is not refunded.')) return;
    const res = await fetch(`/api/reports/${summary.id}`, { method: 'DELETE' });
    if (res.ok) { router.push('/dashboard'); router.refresh(); }
  }

  return (
    <>
      <div className="report-head">
        <div>
          <h1 className="page-title">Report</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {summary.fileNames.join(', ')} · created {new Date(summary.createdAt).toLocaleDateString()}{' '}
            <span className={`expiry${daysLeft <= 3 ? ' soon' : ''}`}>{daysLeft === 0 ? 'Expires today' : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={exportCsv}>CSV</button>
          <button className="btn ghost" onClick={() => window.print()}>PDF</button>
          <button className="btn ghost" onClick={remove}>Delete</button>
        </div>
      </div>
      <div ref={root}>
        <nav className="tabs" role="tablist">
          <button role="tab" data-tab="overview" aria-selected="true">Overview</button>
          <button role="tab" data-tab="progress" aria-selected="false">Progress</button>
          <button role="tab" data-tab="insights" aria-selected="false">Insights &amp; fixes</button>
          <button role="tab" data-tab="clusters" aria-selected="false">Clusters</button>
          <button role="tab" data-tab="positions" aria-selected="false">Positions</button>
        </nav>
        <section id="overview" className="tab" />
        <section id="progress" className="tab hide" />
        <section id="insights" className="tab hide" />
        <section id="clusters" className="tab hide" />
        <section id="positions" className="tab hide" />
      </div>
    </>
  );
}
