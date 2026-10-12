/**
 * @file  apps/web/app/(app)/dashboard/page.tsx
 * @area  Reports
 * @what  Signed-in dashboard: plan card, report history grouped by month (MON-YY) with rename, credits.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api-client';
import { loadPlans, loadHistory } from '@/lib/workspace-data';
import { PlanCard } from '@/components/workspace/PlanCard';
import History from '@/components/workspace/History';
import { currentPlan } from '@/components/workspace/model';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const me = await getMe();
  if (!me) redirect('/login?next=/dashboard');
  const [plans, reports] = await Promise.all([loadPlans(), loadHistory()]);
  return (
    <>
      <div className="report-head">
        <div>
          <h1 className="page-title">Your reports</h1>
          <p className="page-sub">Your reports stay here until you delete them.</p>
        </div>
        <div className="actions">
          {me.credits > 0 ? <Link className="btn" href="/upload">New report</Link> : <Link className="btn" href="/pricing">Buy a credit</Link>}
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 620 }}>
        <PlanCard plan={currentPlan(plans)} />
        {reports.length === 0
          ? <div className="empty">No reports yet. <Link href="/upload" style={{ color: 'var(--y)' }}>Upload your first file</Link>.</div>
          : <History reports={reports} />}
      </div>
    </>
  );
}
