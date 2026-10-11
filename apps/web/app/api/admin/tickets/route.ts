/**
 * @file  apps/web/app/api/admin/tickets/route.ts
 * @area  Admin
 * @what  PATCH — update a support ticket status/notes.
 */
import { requirePerm } from '@/lib/admin/rbac';
import { json, fail } from '@/lib/api/http';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
/** PATCH { id, status?, notes? } */
export async function PATCH(req: Request) {
  const who = await requirePerm('tab:support'); if (who instanceof Response) return who;
  const b = await req.json().catch(() => ({}));
  if (!Number.isInteger(b?.id) || (b.status && !['open', 'in_progress', 'resolved'].includes(b.status))) return fail(400, 'invalid', 'Bad request');
  const { rowCount } = await pool().query(`update public.support_tickets set status = coalesce($2, status), notes = coalesce($3, notes), assigned_to = coalesce(assigned_to, $4), updated_at = now() where id = $1`, [b.id, b.status || null, typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null, who.id]);
  await pool().query(`insert into public.audit_log (user_id, action, meta) values ($1, 'ticket_update', $2)`, [who.id, JSON.stringify(b)]).catch(() => {});
  return rowCount ? json({ ok: true }) : fail(404, 'not_found', 'Ticket not found');
}
