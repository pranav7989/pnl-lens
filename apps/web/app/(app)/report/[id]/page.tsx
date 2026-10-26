/**
 * @file  apps/web/app/(app)/report/[id]/page.tsx
 * @area  Reports
 * @what  One report in the workspace: file tabs, All files, +, ×, the five dashboard tabs; a "deleted" page once removed.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiServer } from '@/lib/api-client';
import { loadPlanData, loadHistory } from '@/lib/workspace-data';
import Workspace from '@/components/workspace/Workspace';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const r = await apiServer<any>(`/reports/${id}`);
  if (r.status === 401) redirect(`/login?next=/report/${id}`);
  if (r.status === 410) {
    return (
      <div className="panel center-card">
        <h3>This report was deleted</h3>
        <p className="muted">Upload your files again to generate a fresh one.</p>
        <Link className="btn" href="/upload">New report</Link>
      </div>
    );
  }
  if (!r.ok) notFound();
  const [{ plans, prices }, reports] = await Promise.all([loadPlanData(), loadHistory()]);
  const d = r.data;
  return (
    <Workspace mode="report" plans={plans} reports={reports} prices={prices}
      current={{ id, createdAt: d.summary.createdAt, title: d.summary.title, report: d.report, files: d.files, places: d.places, planCheck: d.planCheck ?? null }} />
  );
}
