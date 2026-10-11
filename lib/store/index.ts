/**
 * @file  lib/store/index.ts
 * @area  Reports
 * @what  Picks the report store (file or Postgres).
 */
import type { Store } from './types';
import { FileStore } from './file-store';
import { PgStore } from './pg-store';

/** STORE_DRIVER=pg (Amazon RDS / any Postgres) | file (local JSON, zero setup). */
let store: Store | null = null;
export function getStore(): Store {
  if (!store) store = process.env.STORE_DRIVER === 'pg' ? new PgStore() : new FileStore();
  return store;
}
export type { Store, ReportSummary, GetReportResult, CreateReportInput } from './types';
