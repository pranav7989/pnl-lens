/**
 * @file  tests/pg-store.test.ts
 * @area  Tests
 * @what  PostgreSQL store integration (needs TEST_DATABASE_URL).
 */
/**
 * Integration test for PgStore against a real Postgres.
 * Skipped unless TEST_DATABASE_URL (lens_app role) and TEST_ADMIN_URL are set, e.g.:
 *   TEST_ADMIN_URL=postgres://lens_admin:...@localhost/lens TEST_DATABASE_URL=postgres://lens_app:...@localhost/lens npm run test:db
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import pg from 'pg';
import { runAnalysis } from '@/lib/engine';

const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_URL;
const run = APP && ADMIN ? describe : describe.skip;
const USER = '00000000-0000-0000-0000-0000000000aa', OTHER = '00000000-0000-0000-0000-0000000000bb';

run('PgStore on PostgreSQL', () => {
  let admin: pg.Client, store: any;
  const report = runAnalysis(XLSX, [{ name: 'tb.csv', data: new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'zerodha_tradebook.csv'))) }]).report!;
  const input = { report, fileNames: ['tb.csv'], fileHashes: ['a'.repeat(64)] };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
    for (const [id, bal] of [[USER, 2], [OTHER, 1]] as const) {
      await admin.query(`insert into users(id,email,country) values ($1,$2,'IN') on conflict do nothing`, [id, `${id}@t.local`]);
      await admin.query(`insert into credits(user_id,balance) values ($1,$2) on conflict (user_id) do update set balance=$2`, [id, bal]);
    }
    const { PgStore } = await import('@/lib/store/pg-store');
    store = new PgStore();
  });
  afterAll(async () => {
    await admin.query('update reports set report=null where user_id = any($1)', [[USER, OTHER]]);
    await admin.end();
    const { pool } = await import('@/lib/db'); await pool().end();
  });

  let id = '';
  it('creates a report and consumes a credit', async () => {
    const r = await store.createReportWithCredit(USER, input);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/); id = r.id;
    expect(await store.getCredits(USER)).toBe(1);
  });
  it('round-trips the report JSON intact', async () => {
    const r = await store.getReport(USER, id);
    expect(r.status).toBe('ok');
    expect(r.report.m.n).toBe(report.m.n);
    expect(r.report.trades.length).toBe(report.trades.length);
    expect(r.summary.currency).toBe('INR');
    expect(r.summary.netPnl).toBeCloseTo(report.m.net, 0);
  });
  it('isolates users', async () => {
    expect((await store.getReport(OTHER, id)).status).toBe('not_found');
    expect(await store.deleteReport(OTHER, id)).toBe(false);
    expect((await store.listReports(OTHER)).length).toBe(0);
  });
  it('returns no_credits at zero balance', async () => {
    await store.createReportWithCredit(USER, input);
    expect(await store.createReportWithCredit(USER, input)).toEqual({ error: 'no_credits' });
  });
  it('lists newest first', async () => {
    const list = await store.listReports(USER);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(new Date(list[0].createdAt) >= new Date(list[1].createdAt)).toBe(true);
  });
  it('delete nulls the payload and is idempotent', async () => {
    expect(await store.deleteReport(USER, id)).toBe(true);
    expect(await store.deleteReport(USER, id)).toBe(false);
    expect((await store.getReport(USER, id)).status).toBe('purged');
  });
  it('purges expired reports', async () => {
    await admin.query(`update reports set expires_at = now() - interval '1 day' where user_id = $1 and purged_at is null`, [USER]);
    expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect((await store.listReports(USER)).every((r: any) => r.purged)).toBe(true);
  });
});
