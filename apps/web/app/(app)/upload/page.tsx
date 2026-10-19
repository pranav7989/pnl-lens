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

export default async function Upload(props: { searchParams: Promise<{ from?: string }> }) {
  // ?from=blog (REQ-7): the article's call to action; kept through sign-in and sent with the upload for attribution
  const fromBlog = (await props.searchParams).from === 'blog';
  const user = await getSessionUser();
  if (!user) redirect(fromBlog ? `/login?next=${encodeURIComponent('/upload?from=blog')}` : '/login?next=/upload');
  const [{ plans, prices }, reports] = await Promise.all([loadPlanData(), loadHistory()]);
  return <Workspace mode="upload" plans={plans} reports={reports} prices={prices} source={fromBlog ? 'blog' : undefined} />;
}
