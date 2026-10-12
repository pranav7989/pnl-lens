/**
 * @file  apps/web/lib/admin/rbac.ts
 * @area  Admin
 * @what  requirePerm() guard for web admin routes; the roles and permissions live in packages/shared/src/admin/rbac.ts.
 */
/**
 * Role-based access control. The role is read from the database on every admin request
 * (never trusted from the session token), so changes take effect immediately.
 */
import { pool } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';

import { can, type Role, type Perm } from '@pnl-lens/shared/admin/rbac';

export { PERMS, can, isStaff, assignable, type Role, type Perm } from '@pnl-lens/shared/admin/rbac';

export async function getRole(userId: string): Promise<Role> {
  if (process.env.AUTH_MODE === 'dev' && process.env.STORE_DRIVER !== 'pg') return 'owner';
  const { rows } = await pool().query('select role from public.users where id = $1', [userId]);
  return (rows[0]?.role as Role) || 'user';
}

/** For API routes: returns the staff member or a 401/403 Response. */
export async function requirePerm(perm: Perm): Promise<{ id: string; role: Role } | Response> {
  const u = await getSessionUser();
  if (!u) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const role = await getRole(u.id);
  if (!can(role, perm)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return { id: u.id, role };
}
