/**
 * @file  apps/web/app/(app)/upload/page.tsx
 * @area  Reports
 * @what  Upload page wrapper: renders UploadClient (browser-side parsing and analysis).
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/store';
import UploadClient from '@/components/UploadClient';

export const dynamic = 'force-dynamic';

export default async function Upload() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/upload');
  const credits = await getStore().getCredits(user.id);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 className="page-title">New report</h1>
      <p className="page-sub">Your files are read in this browser tab and never uploaded. Only the finished report is saved.</p>
      <UploadClient credits={credits} />
    </div>
  );
}
