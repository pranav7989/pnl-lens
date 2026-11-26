/**
 * @file  apps/api/src/routes/reports.ts
 * @area  Reports
 * @what  Reports: list (MON-YY history), save an analysis (spends one report from a valid plan), "+" add files (file-set lock), get, rename, delete.
 */
/**
 * GET /reports, GET /reports/:id and DELETE /reports/:id keep the old response shapes (apps/web/app/api/reports).
 * POST /reports no longer accepts report JSON from the browser (plan §8, F7): it takes the id of an analysis the
 * server computed, and the database decides whether a plan allows it (rule 5).
 */
import { z } from 'zod';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { createReportFromAnalysis, addAnalysisToReport, listReports, getReport, renameReport, deleteReport, progressHistory, reportFiles, planToCheck, setReportCapital, isDbError, type DbErrorCode } from '@pnl-lens/db';
import { scorePlan } from '@pnl-lens/shared/plan/score';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, UUID } from '../lib/http.js';

/** HTTP status and message for each refusal from the SQL functions. */
export const CLAIM_ERRORS: Partial<Record<DbErrorCode, [number, string]>> = {
  no_plan: [402, 'No reports left. Choose a plan to continue.'],
  plan_used_up: [402, 'You have used all the reports in your plan. Renew or upgrade to create more; past reports stay listed.'],
  plan_expired: [402, 'Your plan has ended. Your reports are still here. Choose a plan to create new ones.'],
  too_many_files: [402, 'Your plan allows fewer broker statements per report. Remove a file or upgrade.'],
  report_files_full: [402, 'This report already holds all the broker statements your plan allows. You can re-open a statement already in this report, or start a new report.'],
  user_blocked: [403, 'This account is disabled.'],
  analysis_not_found: [404, 'not_found'],
  report_not_found: [404, 'not_found'],
  already_claimed: [409, 'This analysis has already been saved.'],
  analysis_not_ready: [409, 'The files are still being analysed.'],
  analysis_targets_report: [409, 'These files belong to an existing report.'],
  analysis_targets_other_report: [409, 'These files belong to a different report.'],
  report_locked: [409, 'Files can’t be added to this report.'],
  analysis_expired: [410, 'This preview has expired. Upload the files again.'],
};

const summary = (r: { id: string; created_at: Date; expires_at?: Date | number | null; file_names: string[]; market: string | null; currency: string | null;
  trade_count: number | null; net_pnl_minor: string | null; purged_at?: Date | null; title?: string | null; month_label?: string | null }) => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  // v2 reports never expire (D4: stored as 'infinity'); pre-v2 rows keep their date
  expiresAt: r.expires_at == null || r.expires_at === Infinity ? null : new Date(r.expires_at as Date).toISOString(),
  fileNames: r.file_names,
  market: r.market,
  currency: r.currency ? String(r.currency).trim() : null,
  tradeCount: r.trade_count ?? 0,
  netPnl: r.net_pnl_minor != null ? Number(r.net_pnl_minor) / 100 : 0,
  purged: !!r.purged_at,
  title: r.title ?? null,
  monthLabel: r.month_label ?? null,
});

export async function reportRoutes(app: App, deps: Deps) {
  const s = { security: [{ session: [] }], tags: ['reports'] };
  const claimFail = (reply: any, e: unknown) => {
    if (isDbError(e) && CLAIM_ERRORS[e.code]) { const [st, msg] = CLAIM_ERRORS[e.code]!; return fail(reply, st, e.code, msg); }
    throw e;
  };

  app.get('/reports', { schema: { ...s, summary: 'My reports, newest first (history, grouped by monthLabel in the UI)' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const rows = await listReports(deps.db, user.id);
    return ok(reply, { reports: rows.map((r) => ({ ...summary(r), from: r.from_date, to: r.to_date, progressScore: r.progress_score == null ? null : Number(r.progress_score) })) });
  });

  /** Save an analysis as a report: spends one report from a valid plan (server-side, rule 5). */
  app.post('/reports', {
    schema: { ...s, summary: 'Save an analysis as a report', body: z.object({ analysisId: z.string().regex(UUID), title: z.string().max(120).optional() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    try {
      const id = await createReportFromAnalysis(deps.db, user.id, req.body.analysisId, req.body.title ?? null);
      const files = await deps.db.selectFrom('reports').select('file_names').where('id', '=', id).executeTakeFirst();
      await trackWith(deps.pool, user.id, 'report_created', { files: files?.file_names.length ?? null });
      return ok(reply, { id }, 201);
    } catch (e) { return claimFail(reply, e); }
  });

  /** "+": the report now shows the new analysis of its old + new statements. Spends nothing; the file-set lock applies. */
  app.post('/reports/:id/files', {
    schema: { ...s, summary: 'Apply an analysis that added files to this report', params: z.object({ id: z.string() }), body: z.object({ analysisId: z.string().regex(UUID) }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    try {
      return ok(reply, { id: await addAnalysisToReport(deps.db, user.id, req.params.id, req.body.analysisId) });
    } catch (e) { return claimFail(reply, e); }
  });

  app.get('/reports/:id', { schema: { ...s, summary: 'One report with its payload and Progress history', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const r = await getReport(deps.db, user.id, req.params.id);
    if (!r) return fail(reply, 404, 'not_found');
    const sm = summary(r);
    const expired = sm.expiresAt !== null && new Date(sm.expiresAt) < new Date();
    if (r.purged_at || !r.report || expired) return reply.code(410).header('Cache-Control', 'no-store').send({ error: 'expired', summary: { ...sm, purged: true } });
    const history = (await progressHistory(deps.db, user.id)).map((h) => ({
      id: h.id, createdAt: h.created_at, from: h.from_date, to: h.to_date, score: h.progress_score == null ? null : Number(h.progress_score),
    }));
    // file tabs: each statement with its own dashboard (2+ files); a single-file report's tab is the report itself
    const all = await reportFiles(deps.db, user.id, r.id);
    const files = all.map((f) => ({ id: f.id, name: f.name, position: f.position, stored: f.stored, report: all.length > 1 ? f.report : null }));
    // file places: how many statements this report's plan allows, and how many it has ever used (lock)
    const sub = r.subscription_id ? await deps.db.selectFrom('subscriptions').select('files_per_report').where('id', '=', r.subscription_id).executeTakeFirst() : undefined;
    const places = { total: sub?.files_per_report ?? files.length, used: r.used_fingerprints?.length ?? files.length };
    // 30-day plan check-up: the newest plan downloaded before this report, scored on it (Met / Missed per rule)
    const prev = await planToCheck(deps.db, user.id, r.id, new Date(r.created_at));
    const planCheck = prev ? { ...scorePlan(prev.plan, r.report), fromReportId: prev.reportId, fromReportName: prev.reportName } : null;
    return ok(reply, { summary: sm, report: r.report, history, files, places, planCheck, capital: r.capital === null || r.capital === undefined ? null : Number(r.capital) });
  });

  /**
   * Lifetime view: the closed trades of every live report (only the trades, currency and names; the browser merges
   * them per currency, packages/shared/src/insights/lifetime.ts). Owner only by construction (user_id filter).
   */
  app.get('/me/lifetime', { schema: { ...s, tags: ['reports'], summary: 'All my live reports\' trades for the lifetime view' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const { rows } = await deps.pool.query(
      `select id, title, month_label, created_at, file_names, coalesce(report->'m'->>'currency', currency, 'INR') as currency, coalesce(report->'trades', '[]'::jsonb) as trades
         from public.reports where user_id = $1 and purged_at is null and report is not null order by created_at`, [user.id]);
    reply.header('Cache-Control', 'no-store');
    return ok(reply, { reports: rows.map((r) => ({
      id: r.id, title: r.title || null, files: r.file_names || [],
      createdAt: new Date(r.created_at).toISOString(), currency: String(r.currency).toUpperCase(), trades: r.trades,
    })) });
  });

  /** Optional capital used (0028), in the report's currency: unlocks % returns and % risk. null clears it. */
  app.put('/reports/:id/capital', {
    schema: { ...s, summary: 'Set the capital used for a report (or clear it)', params: z.object({ id: z.string() }), body: z.object({ capital: z.number().positive().max(100_000_000_000).nullable() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const done = await setReportCapital(deps.db, user.id, req.params.id, req.body.capital);
    if (!done) return fail(reply, 404, 'not_found');
    await trackWith(deps.pool, user.id, 'capital_set', { cleared: req.body.capital === null });
    return ok(reply, { capital: req.body.capital });
  });

  /** Rename (history only). An empty title clears it. */
  app.patch('/reports/:id', {
    schema: { ...s, summary: 'Rename a report', params: z.object({ id: z.string() }), body: z.object({ title: z.string().max(120).nullable() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const done = await renameReport(deps.db, user.id, req.params.id, req.body.title);
    return done ? ok(reply, { ok: true, title: req.body.title?.trim() || null }) : fail(reply, 404, 'not_found');
  });

  app.delete('/reports/:id', { schema: { ...s, summary: 'Delete a report, its trades and its files', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    return (await deleteReport(deps.db, user.id, req.params.id)) ? ok(reply, { deleted: true }) : fail(reply, 404, 'not_found');
  });
}
