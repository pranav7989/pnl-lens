/**
 * @file  packages/db/src/queries/reports.ts
 * @area  Database
 * @what  Reports (api, lens_app): claim an analysis, add files (file-set lock), rename, delete, MON-YY history, Progress history, trades.
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import { rethrow } from '../errors.js';

/** Spends one report from a valid plan. Throws DbError: no_plan | plan_expired | plan_used_up | too_many_files | … */
export async function createReportFromAnalysis(db: Db, userId: string, analysisId: string, title?: string | null): Promise<string> {
  try {
    const { rows } = await sql<{ id: string }>`select public.create_report_from_analysis(${userId}::uuid, ${analysisId}::uuid, ${title ?? null}::text) as id`.execute(db);
    return rows[0].id;
  } catch (e) { rethrow(e); }
}

/** The "+" button: replaces the report's content, spends nothing. Throws DbError: report_files_full | too_many_files | … */
export async function addAnalysisToReport(db: Db, userId: string, reportId: string, analysisId: string): Promise<string> {
  try {
    const { rows } = await sql<{ id: string }>`select public.add_analysis_to_report(${userId}::uuid, ${reportId}::uuid, ${analysisId}::uuid) as id`.execute(db);
    return rows[0].id;
  } catch (e) { rethrow(e); }
}

/** Rename (history only). Empty title clears it. False if not the user's live report. */
export async function renameReport(db: Db, userId: string, reportId: string, title: string | null): Promise<boolean> {
  const t = title?.trim() || null;
  const r = await db.updateTable('reports').set({ title: t })
    .where('id', '=', reportId).where('user_id', '=', userId).where('purged_at', 'is', null)
    .executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}

/** Deletes the report, its trades/metrics, and shreds its files. False if already gone. */
export async function deleteReport(db: Db, userId: string, reportId: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select public.delete_report_v2(${userId}::uuid, ${reportId}::uuid) as ok`.execute(db);
  return rows[0].ok;
}

/** History list (grouped by month_label in the UI), newest first, with the Progress score. */
export async function listReports(db: Db, userId: string, limit = 200) {
  return db.selectFrom('reports as r')
    .leftJoin('report_metrics as m', 'm.analysis_id', 'r.analysis_id')
    .select(['r.id', 'r.title', 'r.month_label', 'r.created_at', 'r.file_names', 'r.market', 'r.currency', 'r.trade_count',
      'r.net_pnl_minor', 'r.subscription_id', 'm.from_date', 'm.to_date', 'm.progress_score'])
    .where('r.user_id', '=', userId).where('r.purged_at', 'is', null)
    .orderBy('r.created_at', 'desc').limit(limit)
    .execute();
}

/** One report with its renderable payload. Undefined if not the user's; `purged_at` set if deleted. */
export async function getReport(db: Db, userId: string, reportId: string) {
  return db.selectFrom('reports')
    .select(['id', 'title', 'month_label', 'created_at', 'expires_at', 'purged_at', 'file_names', 'market', 'currency', 'trade_count',
      'net_pnl_minor', 'report', 'subscription_id', 'used_fingerprints', 'analysis_id'])
    .where('id', '=', reportId).where('user_id', '=', userId)
    .executeTakeFirst();
}

/** Progress tab history (render.js fmt.history): score and period of each live report, oldest first. */
export async function progressHistory(db: Db, userId: string) {
  return db.selectFrom('reports as r')
    .innerJoin('report_metrics as m', 'm.analysis_id', 'r.analysis_id')
    .select(['r.id', 'r.created_at', 'm.from_date', 'm.to_date', 'm.progress_score', 'm.net', 'm.n', 'm.currency'])
    .where('r.user_id', '=', userId).where('r.purged_at', 'is', null)
    .orderBy('r.created_at', 'asc')
    .execute();
}

/** A report's current trades in report order. */
export async function reportTrades(db: Db, userId: string, reportId: string) {
  return db.selectFrom('trades as t')
    .innerJoin('reports as r', 'r.analysis_id', 't.analysis_id')
    .selectAll('t')
    .where('r.id', '=', reportId).where('r.user_id', '=', userId).where('r.purged_at', 'is', null)
    .orderBy('t.seq')
    .execute();
}
