/**
 * @file  apps/web/app/(app)/layout.tsx
 * @area  Auth
 * @what  Signed-in area (dashboard, upload, report): an email account without a password is sent to set one first.
 */
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api-client';

/** After the first email code a password is required; closing the tab at that step does not skip it. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me?.needsPassword) redirect('/login?step=set');
  return children;
}
