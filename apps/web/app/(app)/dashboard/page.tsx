/**
 * @file  apps/web/app/(app)/dashboard/page.tsx
 * @area  Reports
 * @what  Signed-in dashboard: plan card, reports (search, sort, rename); your data (research opt-in, export, delete account).
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api-client';
import { loadPlanData, loadHistory } from '@/lib/workspace-data';
import { PlanCard } from '@/components/workspace/PlanCard';
import ReportList from '@/components/workspace/ReportList';
import DataRights from '@/components/workspace/DataRights';
import JourneyBar from '@/components/workspace/JourneyBar';
import { currentPlan } from '@/components/workspace/model';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const me = await getMe();
  if (!me) redirect('/login?next=/dashboard');
  const [{ plans, prices }, reports] = await Promise.all([loadPlanData(), loadHistory()]);
  return (
    <>
      <JourneyBar plans={plans} reports={reports} prices={prices} />
      <div className="report-head">
        <div>
          <h1 className="page-title">Your reports</h1>
          <p className="page-sub">Your reports stay here until you delete them.</p>
        </div>
        <div className="actions">
          {(me.reportsLeft ?? 0) > 0 ? <Link className="btn" href="/upload">New report</Link> : <Link className="btn" href="/pricing">See plans</Link>}
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 620 }}>
        <PlanCard plan={currentPlan(plans)} />
        {reports.length === 0
          ? <div className="empty">No reports yet. <Link href="/upload" style={{ color: 'var(--y)' }}>Upload your first file</Link>.</div>
          : <ReportList reports={reports} />}
      </div>
      <DataRights />
    </>
  );
}
