/**
 * @file  app/(app)/report/[id]/page.tsx
 * @area  Reports
 * @what  One saved report: loads the report JSON (owner only) and renders ReportView; shows an expiry page when purged.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/store';
import ReportView from '@/components/ReportView';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/report/${params.id}`);
  if (!UUID.test(params.id)) notFound();
  const r = await getStore().getReport(user.id, params.id);
  if (r.status === 'not_found') notFound();
  if (r.status === 'purged') {
    return (
      <div className="panel center-card">
        <h3>This report has expired</h3>
        <p className="muted">Reports are deleted 30 days after they are created. Upload your files again to generate a fresh one.</p>
        <Link className="btn" href="/upload">New report</Link>
      </div>
    );
  }
  return <ReportView report={r.report} summary={r.summary} />;
}
