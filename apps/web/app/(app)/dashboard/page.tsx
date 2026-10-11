/**
 * @file  apps/web/app/(app)/dashboard/page.tsx
 * @area  Reports
 * @what  Signed-in dashboard: list of saved reports, expiry countdown, credits.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/store';
import { engine } from '@pnl-lens/engine';
import DeleteReportButton from '@/components/DeleteReportButton';

export const dynamic = 'force-dynamic';

function money(v: number, cur: string | null) { engine.setCurrency(cur || 'INR'); return engine.inr(v) as string; }
function daysLeft(iso: string) { return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)); }

export default async function Dashboard() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/dashboard');
  const store = getStore();
  const [reports, credits] = await Promise.all([store.listReports(user.id), store.getCredits(user.id)]);

  return (
    <>
      <div className="report-head">
        <div>
          <h1 className="page-title">Your reports</h1>
          <p className="page-sub">Reports stay available for 30 days, then they are deleted automatically.</p>
        </div>
        <div className="actions">
          {credits > 0 ? <Link className="btn" href="/upload">New report</Link> : <Link className="btn" href="/pricing">Buy a credit</Link>}
        </div>
      </div>
      <div className="panel">
        {reports.length === 0 ? (
          <div className="empty">No reports yet. <Link href="/upload" style={{ color: 'var(--y)' }}>Upload your first file</Link>.</div>
        ) : (
          <div className="tw"><table>
            <thead><tr><th>Created</th><th>Files</th><th>Market</th><th className="n">Positions</th><th className="n">Net P&amp;L</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {reports.map((r) => {
                const left = daysLeft(r.expiresAt);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="muted">{r.fileNames.join(', ')}</td>
                    <td>{r.market || '—'}</td>
                    <td className="n">{r.tradeCount}</td>
                    <td className={`n ${r.netPnl > 0 ? 'gain' : r.netPnl < 0 ? 'loss' : ''}`}><b>{r.purged ? '—' : money(r.netPnl, r.currency)}</b></td>
                    <td>{r.purged ? <span className="muted">Expired</span> : <span className={`expiry${left <= 3 ? ' soon' : ''}`}>{left === 0 ? 'Expires today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}</td>
                    <td className="n">{r.purged ? null : <><Link href={`/report/${r.id}`} style={{ color: 'var(--y)', fontWeight: 600, marginRight: 14 }}>Open</Link><DeleteReportButton id={r.id} /></>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
