/**
 * @file  app/api/reports/route.ts
 * @area  Reports
 * @what  GET list / POST create report. POST validates the JSON and spends one credit atomically (create_report_with_credit).
 */
import { track, captureError } from '@/lib/admin/telemetry';
import { getStore } from '@/lib/store';
import { json, fail, requireUser, isResponse } from '@/lib/api/http';
import { validateCreateReport } from '@/lib/api/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return json({ reports: await getStore().listReports(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  // PHASE 7 (developer): per-user rate limit here (10 reports/day).
  const v = validateCreateReport(await req.text());
  if (!v.ok) return fail(400, v.error);
  let res;
  try { res = await getStore().createReportWithCredit(user.id, v.body); }
  catch (e) { await captureError(e, { source: 'server', route: 'POST /api/reports', userId: user.id }); throw e; }
  if ((res as any)?.id) await track(user.id, 'report_created', { files: (v.body as any)?.fileNames?.length ?? null });
  if ('error' in res) return fail(402, 'no_credits', 'No report credits left. Buy one to continue.');
  return json({ id: res.id }, 201);
}
