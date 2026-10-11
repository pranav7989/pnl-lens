/**
 * @file  app/api/admin/roles/route.ts
 * @area  Admin
 * @what  POST — assign a role (owners: any; admins: not owner; nobody changes their own).
 */
import { requirePerm, assignable, type Role } from '@/lib/admin/rbac';
import { json, fail } from '@/lib/api/http';
import { normaliseEmail } from '@/lib/auth/otp';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
/** POST { email, role } — owners assign any role; admins anything except owner. Nobody can change their own role. */
export async function POST(req: Request) {
  const who = await requirePerm('roles:manage'); if (who instanceof Response) return who;
  const b = await req.json().catch(() => ({}));
  const email = normaliseEmail(b?.email), role = b?.role as Role;
  if (!email || !assignable(who.role).includes(role)) return fail(403, 'forbidden', 'You can’t assign that role.');
  const { rows } = await pool().query(`select id, role from public.users where email = $1`, [email]);
  if (!rows[0]) return fail(404, 'not_found', 'No user with that email.');
  if (rows[0].id === who.id) return fail(403, 'forbidden', 'You can’t change your own role.');
  if (rows[0].role === 'owner' && who.role !== 'owner') return fail(403, 'forbidden', 'Only an owner can change an owner.');
  await pool().query(`update public.users set role = $2 where id = $1`, [rows[0].id, role]);
  await pool().query(`insert into public.audit_log (user_id, action, meta) values ($1, 'role_change', $2)`, [who.id, JSON.stringify({ email, from: rows[0].role, to: role })]);
  return json({ ok: true });
}
