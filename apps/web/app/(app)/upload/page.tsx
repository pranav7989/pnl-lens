/**
 * @file  apps/web/app/(app)/upload/page.tsx
 * @area  Reports
 * @what  New report: the workspace upload view (consent, files, loader; the API and worker read the files).
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { loadPlanData, loadHistory } from '@/lib/workspace-data';
import Workspace from '@/components/workspace/Workspace';

export const dynamic = 'force-dynamic';

export default async function Upload() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/upload');
  const [{ plans, prices }, reports] = await Promise.all([loadPlanData(), loadHistory()]);
  return <Workspace mode="upload" plans={plans} reports={reports} prices={prices} />;
}
