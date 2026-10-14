/**
 * @file  apps/web/app/admin/page.tsx
 * @area  Admin
 * @what  Admin console page: staff only (role from the API, read from the database on every request).
 */
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api-client';
import { PERMS, isStaff, type Role } from '@pnl-lens/shared/admin/rbac';
import AdminConsole from '@/components/admin/AdminConsole';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PnL Lens — Admin', robots: { index: false } };

export default async function AdminPage() {
  const me = await getMe();
  if (!me) redirect('/login?next=/admin');
  const role = me.role as Role;
  if (!isStaff(role)) return <div className="panel center-card"><h3>Not available</h3><p className="muted">This page is for the PnL Lens team.</p></div>;
  return <AdminConsole role={role} perms={PERMS[role]} pg />;
}
