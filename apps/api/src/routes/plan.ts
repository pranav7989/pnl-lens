/**
 * @file  apps/api/src/routes/plan.ts
 * @area  Reports
 * @what  30-day plan: the report owner's PDF download (the one download a report has), the check-up calendar file, and check-up email reminders.
 */
/**
 * The plan is built from the stored report on every download (packages/shared/src/plan), so it always covers the
 * next 30 days from today. Reports stay view-only otherwise (no CSV/PDF of the report itself).
 */
import { z } from 'zod';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { buildPlan, istDate, addDays } from '@pnl-lens/shared/plan';
import { scorePlan } from '@pnl-lens/shared/plan/score';
import { getReport, activeReminder, setReminder, cancelReminder, savePlanSnapshot, planToCheck } from '@pnl-lens/db';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, UUID, ipOf } from '../lib/http.js';
import { renderPlanPdf, planDateLabel } from '../lib/plan-pdf.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => { if (!ISO.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
const appUrlOf = (req: { protocol: string; host: string }) => (process.env.APP_URL || `${req.protocol}://${req.host}`).replace(/\/$/, '');

/** an all-day calendar event; no personal data in it */
export function checkupIcs(date: string, appUrl: string, now = new Date()): string {
  const d = date.replace(/-/g, ''), next = addDays(date, 1).replace(/-/g, '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PnL Lens//30-Day Plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:checkup-${d}@pnllens.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
    'SUMMARY:PnL Lens check-up: upload your new statement',
    `DESCRIPTION:Upload this month’s P&L statement or tradebook to see how your numbers moved and get your next 30-day plan.\\n${appUrl}/upload`,
    `URL:${appUrl}/upload`, 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export async function planRoutes(app: App, deps: Deps) {
  const s = { tags: ['reports'], security: [{ session: [] }] };
  const limit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/reports/:id/plan.pdf', { config: limit, schema: { ...s, summary: '30-day plan (PDF) for one of my reports', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const r = await getReport(deps.db, user.id, req.params.id);
    if (!r) return fail(reply, 404, 'not_found');
    if (r.purged_at || !r.report) return fail(reply, 410, 'expired');
    // last month's plan, scored on this report, opens the new plan ("Your last plan: 6 of 8 met")
    const prev = await planToCheck(deps.db, user.id, r.id, new Date(r.created_at));
    const lastCheck = prev ? scorePlan(prev.plan, r.report) : null;
    const plan = buildPlan(r.report, { lastCheck: lastCheck && lastCheck.measured ? lastCheck : null });
    // kept so the next report can score this plan (check-up)
    await savePlanSnapshot(deps.db, user.id, r.id, { generatedAt: plan.generatedAt, checkupOn: plan.checkupOn, dos: plan.dos, donts: plan.donts } as any);
    const pdf = await renderPlanPdf({ plan, reportId: r.id, appUrl: appUrlOf(req) });
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta, ip) values ($1, 'plan_downloaded', $2, $3::inet)`, [user.id, JSON.stringify({ report_id: r.id }), ipOf(req)]);
    await trackWith(deps.pool, user.id, 'plan_downloaded', { checkupOn: plan.checkupOn });
    return reply.header('Content-Type', 'application/pdf').header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="pnl-lens-30-day-plan-${planDateLabel(plan.generatedAt)}.pdf"`).send(pdf);
  });

  // public: holds only a date and the upload link, so the PDF's button works in any calendar app
  app.get('/plan.ics', { config: limit, schema: { tags: ['reports'], summary: 'Check-up calendar event (.ics)', querystring: z.object({ date: z.string() }) } }, async (req, reply) => {
    const date = req.query.date;
    const today = istDate(new Date());
    if (!validDate(date) || date < addDays(today, -400) || date > addDays(today, 400)) return fail(reply, 400, 'bad_date');
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="pnl-lens-check-up-${date}.ics"`).send(checkupIcs(date, appUrlOf(req)));
  });

  app.get('/me/reminders', { schema: { ...s, tags: ['me'], summary: 'My active check-up reminder' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    return ok(reply, { reminder: await activeReminder(deps.db, user.id) });
  });

  app.post('/me/reminders', {
    config: limit,
    schema: { ...s, tags: ['me'], summary: 'Turn on a check-up reminder (replaces the active one)', body: z.object({ reportId: z.string().nullable().optional(), date: z.string() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const { date } = req.body;
    const today = istDate(new Date());
    if (!validDate(date) || date <= today || date > addDays(today, 60)) return fail(reply, 400, 'bad_date', 'Choose a date within the next 60 days.');
    let reportId: string | null = null;
    if (req.body.reportId) {
      if (!UUID.test(req.body.reportId) || !(await getReport(deps.db, user.id, req.body.reportId))) return fail(reply, 404, 'not_found');
      reportId = req.body.reportId;
    }
    const reminder = await setReminder(deps.db, user.id, reportId, date);
    await trackWith(deps.pool, user.id, 'plan_reminder_set', { days: Math.round((Date.parse(date) - Date.parse(today)) / 86400e3) });
    return ok(reply, { reminder }, 201);
  });

  app.delete('/me/reminders/:id', { schema: { ...s, tags: ['me'], summary: 'Cancel my check-up reminder', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    return (await cancelReminder(deps.db, user.id, req.params.id)) ? ok(reply, { cancelled: true }) : fail(reply, 404, 'not_found');
  });
}
