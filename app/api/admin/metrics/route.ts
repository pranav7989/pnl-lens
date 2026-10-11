/**
 * @file  app/api/admin/metrics/route.ts
 * @area  Admin
 * @what  GET ?tab=users|finance|errors|support|product — metrics for one admin tab (permission checked per tab).
 */
import { requirePerm, type Perm, can } from '@/lib/admin/rbac';
import { usersTab, financeTab, errorsTab, supportTab, productTab } from '@/lib/admin/queries';
import { json, fail } from '@/lib/api/http';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
const TABS: Record<string, Perm> = { users: 'tab:users', finance: 'tab:finance', errors: 'tab:errors', support: 'tab:support', product: 'tab:product' };

export async function GET(req: Request) {
  const tab = new URL(req.url).searchParams.get('tab') || '';
  if (!TABS[tab]) return fail(400, 'bad_tab', 'Unknown tab');
  const who = await requirePerm(TABS[tab]); if (who instanceof Response) return who;
  if (process.env.STORE_DRIVER !== 'pg') return fail(503, 'needs_postgres', 'The admin console needs the PostgreSQL store.');
  const data = tab === 'users' ? await usersTab(can(who.role, 'user:pii')) : tab === 'finance' ? await financeTab() : tab === 'errors' ? await errorsTab() : tab === 'support' ? await supportTab() : await productTab();
  await pool().query(`insert into public.audit_log (user_id, action, meta) values ($1, 'admin_view', $2)`, [who.id, JSON.stringify({ tab })]).catch(() => {});
  return json(data);
}
