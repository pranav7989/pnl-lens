/**
 * @file  apps/web/app/api/reports/[id]/route.ts
 * @area  Reports
 * @what  GET one report / DELETE (soft-delete: payload nulled, row kept for billing history).
 */
import { getStore } from '@/lib/store';
import { json, fail, requireUser, isResponse } from '@/lib/api/http';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!UUID.test(params.id)) return fail(404, 'not_found');
  const r = await getStore().getReport(user.id, params.id);
  if (r.status === 'not_found') return fail(404, 'not_found');
  if (r.status === 'purged') return json({ error: 'expired', summary: r.summary }, 410);
  return json({ summary: r.summary, report: r.report });
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!UUID.test(params.id)) return fail(404, 'not_found');
  const ok = await getStore().deleteReport(user.id, params.id);
  return ok ? json({ deleted: true }) : fail(404, 'not_found');
}
