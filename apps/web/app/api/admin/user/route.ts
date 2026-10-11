/**
 * @file  apps/web/app/api/admin/user/route.ts
 * @area  Admin
 * @what  GET ?email= — support lookup: profile, likely cause and full timeline for one user.
 */
import { requirePerm } from '@/lib/admin/rbac';
import { userLookup } from '@/lib/admin/queries';
import { json, fail } from '@/lib/api/http';
import { normaliseEmail } from '@/lib/auth/otp';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const who = await requirePerm('user:lookup'); if (who instanceof Response) return who;
  const email = normaliseEmail(new URL(req.url).searchParams.get('email'));
  if (!email) return fail(400, 'invalid_email', 'Enter a valid email.');
  const data = await userLookup(email);
  await pool().query(`insert into public.audit_log (user_id, action, meta) values ($1, 'admin_user_lookup', $2)`, [who.id, JSON.stringify({ email })]).catch(() => {});
  return data ? json(data) : fail(404, 'not_found', 'No user with that email.');
}
