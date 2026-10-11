/**
 * @file  lib/store/pg-store.ts
 * @area  Reports
 * @what  Report store on PostgreSQL (credits, reports, purge, delete).
 */
import { pool } from '@/lib/db';
import type { Store, CreateReportInput, ReportSummary, GetReportResult } from './types';
import { reportTtlDays } from '@/lib/config';

/**
 * Production store on plain PostgreSQL (Amazon RDS). Uses the SQL functions in
 * db/migrations/0003_functions.sql so credit consumption + insert are one transaction.
 * Every query is scoped by user_id — the API layer never passes a user-supplied owner.
 */
const COLS = 'id, created_at, expires_at, file_names, market, currency, trade_count, net_pnl_minor, purged_at';
const toSummary = (r: any): ReportSummary => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
  fileNames: r.file_names,
  market: r.market,
  currency: r.currency ? String(r.currency).trim() : null,
  tradeCount: r.trade_count ?? 0,
  netPnl: r.net_pnl_minor != null ? Number(r.net_pnl_minor) / 100 : 0,
  purged: !!r.purged_at,
});

export class PgStore implements Store {
  async getCredits(userId: string) {
    const { rows } = await pool().query('select balance from public.credits where user_id = $1', [userId]);
    return rows[0]?.balance ?? 0;
  }

  async createReportWithCredit(userId: string, input: CreateReportInput) {
    try {
      const { rows } = await pool().query(
        'select public.create_report_with_credit($1, $2::jsonb, $3::text[], $4::text[], $5, $6, $7, $8, $9) as id',
        [
          userId, JSON.stringify(input.report), input.fileNames, input.fileHashes,
          input.report.m.market ?? null, input.report.m.currency ?? null,
          input.report.m.n, Math.round(input.report.m.net * 100), reportTtlDays(),
        ],
      );
      return { id: rows[0].id as string };
    } catch (e: any) {
      if (e?.code === 'P0001' && /no_credits/.test(e.message)) return { error: 'no_credits' as const };
      throw e;
    }
  }

  async listReports(userId: string) {
    const { rows } = await pool().query(`select ${COLS} from public.reports where user_id = $1 order by created_at desc limit 200`, [userId]);
    return rows.map(toSummary);
  }

  async getReport(userId: string, id: string): Promise<GetReportResult> {
    const { rows } = await pool().query(`select ${COLS}, report from public.reports where id = $1 and user_id = $2`, [id, userId]);
    const r = rows[0];
    if (!r) return { status: 'not_found' };
    const s = toSummary(r);
    if (s.purged || !r.report || new Date(s.expiresAt) < new Date()) return { status: 'purged', summary: { ...s, purged: true } };
    return { status: 'ok', summary: s, report: r.report };
  }

  async deleteReport(userId: string, id: string) {
    const { rows } = await pool().query('select public.delete_report($1, $2) as ok', [userId, id]);
    return !!rows[0]?.ok;
  }

  async purgeExpired() {
    const { rows } = await pool().query('select public.purge_expired_reports() as n');
    return Number(rows[0].n);
  }
}
