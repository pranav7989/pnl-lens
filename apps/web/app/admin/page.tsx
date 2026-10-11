/**
 * @file  apps/web/app/admin/page.tsx
 * @area  Admin
 * @what  Admin console route (/admin). Staff only; role read from the database; renders AdminConsole with the role's tabs.
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getRole, PERMS, isStaff } from '@/lib/admin/rbac';
import AdminConsole from '@/components/admin/AdminConsole';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PnL Lens — Admin', robots: { index: false } };

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin');
  const role = await getRole(user.id);
  if (!isStaff(role)) return <div className="panel center-card"><h3>Not available</h3><p className="muted">This page is for the PnL Lens team.</p></div>;
  return <AdminConsole role={role} perms={PERMS[role]} pg={process.env.STORE_DRIVER === 'pg'} />;
}
