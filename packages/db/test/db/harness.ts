/**
 * @file  packages/db/test/db/harness.ts
 * @area  Tests
 * @what  DB test harness: fresh database per suite on the throwaway test Postgres, real migrate + setup-roles scripts, role-scoped clients, fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { createDb, type Db } from '../../src/client.js';
import { createUpload, storeAnalysisResult } from '../../src/queries/analyses.js';
import type { ReportV1 } from '@pnl-lens/engine/types';

const ROOT = path.resolve(__dirname, '../../../..');
export const DB_PKG = path.resolve(__dirname, '../..');
export const GOLDEN = path.join(ROOT, 'packages/engine/test/golden');

const env: Record<string, string> = { ...process.env } as Record<string, string>;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}
const PORT = env.TEST_PG_PORT || '55432';
const HOST = '127.0.0.1';
const url = (user: string, pw: string, db: string) => `postgres://${user}:${encodeURIComponent(pw)}@${HOST}:${PORT}/${db}`;
export const adminUrl = (db: string) => url('lens_admin', passwords.admin, db);
export const passwords = { admin: env.TEST_POSTGRES_PASSWORD || '', app: env.LENS_APP_PASSWORD || '', worker: env.LENS_WORKER_PASSWORD || '' };

/** True when the throwaway test Postgres (npm run db:test:up) answers. */
export async function testDbAvailable(): Promise<boolean> {
  if (!passwords.admin || !passwords.app || !passwords.worker) return false;
  const c = new pg.Client({ connectionString: url('lens_admin', passwords.admin, 'postgres'), connectionTimeoutMillis: 2000 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

export function runScript(script: string, dbName: string) {
  const r = spawnSync(process.execPath, [path.join(DB_PKG, 'scripts', script)], {
    encoding: 'utf8',
    env: { ...process.env, MIGRATE_DATABASE_URL: url('lens_admin', passwords.admin, dbName), DATABASE_URL: '',
      LENS_APP_PASSWORD: passwords.app, LENS_WORKER_PASSWORD: passwords.worker, DATABASE_SSL: '' },
  });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

export async function createEmptyDatabase(name: string) {
  const c = new pg.Client({ connectionString: url('lens_admin', passwords.admin, 'postgres') });
  await c.connect();
  await c.query(`drop database if exists ${name} with (force)`);
  await c.query(`create database ${name}`);
  await c.end();
}

export interface TestDb {
  name: string;
  admin: pg.Client;
  app: Db;
  worker: Db;
  appUrl: string;
  workerUrl: string;
  adminUrl: string;
  close(): Promise<void>;
}

/** A brand-new database migrated from 0001 by the real scripts, as the stack's migrate job does. */
export async function freshDb(name: string): Promise<TestDb> {
  await createEmptyDatabase(name);
  runScript('migrate.mjs', name);
  runScript('setup-roles.mjs', name);
  return connect(name);
}

export async function connect(name: string): Promise<TestDb> {
  const adminUrl = url('lens_admin', passwords.admin, name);
  const appUrl = url('lens_app', passwords.app, name);
  const workerUrl = url('lens_worker', passwords.worker, name);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const app = createDb({ connectionString: appUrl, max: 4, ssl: false });
  const worker = createDb({ connectionString: workerUrl, max: 4, ssl: false });
  return {
    name, admin, app: app.db, worker: worker.db, appUrl, workerUrl, adminUrl,
    async close() { await app.db.destroy(); await worker.db.destroy(); await admin.end(); },
  };
}

// ---- fixtures ---------------------------------------------------------------------

const readGolden = (id: string) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${id}.json`), 'utf8')).report as ReportV1 | null;
export function golden(id: string): ReportV1 {
  const r = readGolden(id);
  if (!r) throw new Error(`golden ${id} has no report`);
  return { ...r, generatedAt: '2026-10-12T00:00:00.000Z' };
}
/** Golden cases that produce a report (open_only_xlsx has no closed trades, so none). */
export const goldenIds = () => fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((id) => readGolden(id));

export async function makeUser(t: TestDb, opts: { role?: string; email?: string } = {}): Promise<string> {
  const { rows } = await t.admin.query(
    `insert into users (email, country, role) values ($1, 'IN', $2) returning id`,
    [opts.email ?? `${crypto.randomUUID()}@t.local`, opts.role ?? 'user']);
  return rows[0].id;
}

export async function givePlan(t: TestDb, userId: string, o: { reports?: number; used?: number; files?: number; days?: number; startsDaysAgo?: number } = {}): Promise<string> {
  const { rows } = await t.admin.query(
    `insert into subscriptions (user_id, plan_id, reports_total, reports_used, files_per_report, starts_at, ends_at, grant_reason)
     values ($1, 'snapshot', $2, $3, $4, now() - make_interval(days => $6), now() + make_interval(days => $5), 'test') returning id`,
    [userId, o.reports ?? 5, o.used ?? 0, o.files ?? 3, o.days ?? 30, o.startsDaysAgo ?? 1]);
  await t.admin.query(`update credits set balance = balance + $2 where user_id = $1`, [userId, (o.reports ?? 5) - (o.used ?? 0)]);
  return rows[0].id;
}

let fileSeq = 0;
export function fakeFile(name = 'statement.csv', content?: string) {
  const sha = crypto.createHash('sha256').update(content ?? `${name}-${++fileSeq}-${crypto.randomUUID()}`).digest('hex');
  return {
    originalName: name, ext: path.extname(name).toLowerCase() || '.csv', detectedKind: 'sheet' as const, sizeBytes: 1234, sha256: sha,
    storageKey: `u/${crypto.randomUUID()}`, encKeyId: 'k1', wrappedDek: crypto.randomBytes(40), iv: crypto.randomBytes(12),
  };
}

export interface ReadyOpts {
  files?: number;
  /** fingerprints for the NEW files (the worker sets them); defaults to unique values */
  fingerprints?: string[];
  existingFileIds?: string[];
  targetReportId?: string;
  report?: ReportV1;
}

/** Upload (as lens_app) + store result (as lens_worker): an analysis ready to be claimed. */
export async function readyAnalysis(t: TestDb, userId: string, o: ReadyOpts = {}) {
  const n = o.files ?? 1;
  const files = Array.from({ length: n }, (_, i) => fakeFile(`file${i}.csv`));
  const up = await createUpload(t.app, { userId, files, existingFileIds: o.existingFileIds, targetReportId: o.targetReportId ?? null });
  const fps: Record<string, string> = {};
  up.fileIds.forEach((id, i) => { fps[id] = o.fingerprints?.[i] ?? `t${crypto.randomUUID()}`; });
  await storeAnalysisResult(t.worker, {
    analysisId: up.analysisId, engineVersion: 'test-1', report: o.report ?? golden('zerodha_tradebook_csv'), fileFingerprints: fps,
  });
  return { analysisId: up.analysisId, fileIds: up.fileIds };
}

/** Run SQL as a role inside the admin session (for permission checks); always resets. */
export async function asRole<T = any>(t: TestDb, role: string, sqlText: string, params: unknown[] = []): Promise<T[]> {
  await t.admin.query(`set role ${role}`);
  try { return (await t.admin.query(sqlText, params)).rows; } finally { await t.admin.query('reset role'); }
}

/** Expect a Postgres error with this SQLSTATE. */
export async function expectPgError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e: any) { if (e.code === code) return e; throw new Error(`expected SQLSTATE ${code}, got ${e.code}: ${e.message}`); }
  throw new Error(`expected SQLSTATE ${code}, but it succeeded`);
}
