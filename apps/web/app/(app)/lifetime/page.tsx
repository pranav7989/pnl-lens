/**
 * @file  apps/web/app/(app)/lifetime/page.tsx
 * @area  Reports
 * @what  "All my trading": the lifetime view across every live report (merged per currency, duplicates counted once), with the Edge and Rewind analysis on all trades.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiServer } from '@/lib/api-client';
import LifetimeView from '@/components/workspace/Lifetime';

export const dynamic = 'force-dynamic';

export default async function LifetimePage() {
  const r = await apiServer<{ reports: { id: string; title: string | null; createdAt: string; currency: string; trades: any[] }[] }>('/me/lifetime');
  if (r.status === 401) redirect('/login?next=/lifetime');
  const reports = r.ok ? r.data.reports : [];
  if (reports.length < 2) {
    return (
      <div className="panel center-card" data-lifetime-empty>
        <h3>All my trading</h3>
        <p className="muted">The lifetime view joins all your reports into one picture. It needs at least two reports; you have {reports.length}.</p>
        <Link className="btn" href="/upload">New report</Link>
      </div>
    );
  }
  return <LifetimeView reports={reports} />;
}
