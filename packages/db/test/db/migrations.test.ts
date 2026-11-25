/**
 * @file  packages/db/test/db/migrations.test.ts
 * @area  Tests
 * @what  Migrations apply from 0001 on an empty database and on top of a 0007 database with old data; the old web flow keeps working.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { testDbAvailable, freshDb, createEmptyDatabase, runScript, connect, adminUrl, asRole, expectPgError, DB_PKG, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const MIGRATIONS = fs.readdirSync(path.join(DB_PKG, 'migrations')).filter((f) => f.endsWith('.sql')).sort();

describe.skipIf(!ok)('migrations on an empty database', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_migrate_fresh'); });
  afterAll(async () => { await t?.close(); });

  it('applies every migration, 0001 to the last, once', async () => {
    const { rows } = await t.admin.query('select name from schema_migrations order by name');
    expect(rows.map((r) => r.name)).toEqual(MIGRATIONS);
    expect(MIGRATIONS[0]).toBe('0001_schema.sql');
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(14);
  });

  it('a second run changes nothing', () => {
    expect(runScript('migrate.mjs', t.name)).toContain('database is up to date');
  });

  it('creates the v2 tables, views and research schema', async () => {
    const { rows } = await t.admin.query(`select table_schema || '.' || table_name as n from information_schema.tables
      where table_schema in ('public', 'research')`);
    const names = new Set(rows.map((r) => r.n));
    for (const n of ['public.statement_files', 'public.analyses', 'public.analysis_files', 'public.file_access_log', 'public.parse_runs',
      'public.trades', 'public.fills', 'public.report_metrics', 'public.report_traits', 'public.consents', 'public.data_requests',
      'public.current_trades', 'public.user_consent_current', 'research.subjects', 'research.trades', 'research.report_metrics',
      'research.report_traits']) expect(names, n).toContain(n);
  });

  it('migrations 0001-0007 are unchanged since the baseline commit, apart from the Phase 1 @file path (rule 3)', () => {
    for (const f of MIGRATIONS.slice(0, 7)) {
      const base = spawnSync('git', ['show', `dc53d78:db/migrations/${f}`], { cwd: DB_PKG, encoding: 'utf8' });
      if (base.status !== 0) return;          // not a git checkout (e.g. inside an image): nothing to compare
      const strip = (s: string) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('-- @file')).join('\n');
      expect(strip(fs.readFileSync(path.join(DB_PKG, 'migrations', f), 'utf8')), f).toBe(strip(base.stdout));
    }
  });
});

describe.skipIf(!ok)('migrating a database that is at 0007 with data', () => {
  let t: TestDb;
  const USER = '00000000-0000-0000-0000-00000000a001';
  let oldReport = '';

  beforeAll(async () => {
    const name = 't_migrate_upgrade';
    await createEmptyDatabase(name);
    // Apply 0001-0007 exactly as the old migrate script did.
    const c = new pg.Client({ connectionString: adminUrl(name) });
    await c.connect();
    await c.query('create table public.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    for (const f of MIGRATIONS.slice(0, 7)) {
      await c.query('begin');
      await c.query(fs.readFileSync(path.join(DB_PKG, 'migrations', f), 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
    }
    await c.end();
    runScript('setup-roles.mjs', name);
    t = await connect(name);
    // Old-style data: a user, a paid plan via the webhook function, a report via the old credit function.
    await t.admin.query(`insert into users (id, email, country) values ($1, 'old@t.local', 'IN')`, [USER]);
    await t.admin.query(`insert into payments (user_id, gateway_order_id, amount_minor, currency, plan_id) values ($1, 'order_old', 49900, 'INR', 'snapshot')`, [USER]);
    await asRole(t, 'lens_app', `select grant_plan('order_old', 'pay_old', '{}'::jsonb, 5, 3, 183)`);
    const r = await asRole(t, 'lens_app', `select create_report_with_credit($1, '{"version":1,"m":{"n":3}}'::jsonb, array['a.csv'], array['h'], 'India', 'INR', 3, 1200, 30) as id`, [USER]);
    oldReport = r[0].id;
    // now apply 0008+
    runScript('migrate.mjs', name);
    runScript('setup-roles.mjs', name);
  });
  afterAll(async () => { await t?.close(); });

  it('applies the new migrations on top', async () => {
    const { rows } = await t.admin.query('select count(*)::int as n from schema_migrations');
    expect(rows[0].n).toBe(MIGRATIONS.length);
  });

  it('keeps old reports, plans and credits intact', async () => {
    const r = (await t.admin.query('select report, currency, file_names, analysis_id, used_fingerprints from reports where id = $1', [oldReport])).rows[0];
    expect(r.report).toEqual({ version: 1, m: { n: 3 } });
    expect(r.currency).toBe('INR');
    expect(r.file_names).toEqual(['a.csv']);
    expect(r.analysis_id).toBeNull();
    expect(r.used_fingerprints).toEqual([]);
    const s = (await t.admin.query('select reports_total, files_per_report, payment_id from subscriptions where user_id = $1', [USER])).rows;
    expect(s).toHaveLength(1);
    expect(s[0].payment_id).not.toBeNull();
    expect((await t.admin.query('select balance from credits where user_id = $1', [USER])).rows[0].balance).toBe(4);
  });

  it('the old web flow (create_report_with_credit, delete_report) still works as lens_app until the Phase 6 cutover', async () => {
    const r = await asRole(t, 'lens_app', `select create_report_with_credit($1, '{}'::jsonb, array['b.csv'], array['h2'], null, 'USDT', 1, 0, 30) as id`, [USER]);
    expect(r[0].id).toMatch(/^[0-9a-f-]{36}$/);               // 4-letter currency now fits (F12)
    expect((await asRole(t, 'lens_app', 'select delete_report($1, $2) as ok', [USER, r[0].id]))[0].ok).toBe(true);
  });

  it('the app role lost direct writes to credits and report contents (D6, rule 5)', async () => {
    await expectPgError(asRole(t, 'lens_app', 'update credits set balance = 99 where user_id = $1', [USER]), '42501');
    await expectPgError(asRole(t, 'lens_app', `update reports set report = '{}' where id = $1`, [oldReport]), '42501');
  });
});
