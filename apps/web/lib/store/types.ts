/**
 * @file  apps/web/lib/store/types.ts
 * @area  Reports
 * @what  Report store interface.
 */
import type { ReportV1 } from '@pnl-lens/engine/types';

export interface CreateReportInput {
  report: ReportV1;
  fileNames: string[];
  fileHashes: string[];
}

export interface ReportSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  fileNames: string[];
  market: string | null;
  currency: string | null;
  tradeCount: number;
  netPnl: number;
  purged: boolean;
}

export type GetReportResult =
  | { status: 'ok'; summary: ReportSummary; report: ReportV1 }
  | { status: 'purged'; summary: ReportSummary }
  | { status: 'not_found' };

/**
 * Persistence boundary. Two implementations:
 *  - FileStore: local JSON file, zero setup, for development and demos.
 *  - PgStore: production (Amazon RDS for PostgreSQL), calls the SQL functions in db/migrations/0003_functions.sql.
 * Select with STORE_DRIVER=file|pg.
 */
export interface Store {
  getCredits(userId: string): Promise<number>;
  createReportWithCredit(userId: string, input: CreateReportInput): Promise<{ id: string } | { error: 'no_credits' }>;
  listReports(userId: string): Promise<ReportSummary[]>;
  getReport(userId: string, id: string): Promise<GetReportResult>;
  deleteReport(userId: string, id: string): Promise<boolean>;
  purgeExpired(): Promise<number>;
}
