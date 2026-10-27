/**
 * @file  packages/db/test/db/roles.test.ts
 * @area  Tests
 * @what  Least privilege (rule 4): what lens_app, lens_worker, lens_research and PUBLIC can and cannot do after migration 0014.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, asRole, expectPgError, type TestDb } from './harness.js';
import { createReportFromAnalysis } from '../../src/queries/reports.js';
import { assertRole } from '../../src/client.js';

const ok = await testDbAvailable();
const DENIED = '42501';

describe.skipIf(!ok)('database roles', () => {
  let t: TestDb, user = '', report = '', analysis = '';
  beforeAll(async () => {
    t = await freshDb('t_roles');
    user = await makeUser(t);
    await givePlan(t, user);
    analysis = (await readyAnalysis(t, user)).analysisId;
    report = await createReportFromAnalysis(t.app, user, analysis);
  });
  afterAll(async () => { await t?.close(); });

  it('the app and worker connect as themselves, never as a superuser', async () => {
    await assertRole(t.app, 'lens_app');
    await assertRole(t.worker, 'lens_worker');
    await expect(assertRole(t.app, 'lens_worker')).rejects.toThrow(/must be lens_worker/);
  });

  describe('lens_app (api)', () => {
    const denied = [
      ['delete trades', 'delete from trades'],
      ['delete reports', 'delete from reports'],
      ['delete analyses', 'delete from analyses'],
      ['update credits', 'update credits set balance = 100'],
      ['insert credits', `insert into credits (user_id, balance) values (gen_random_uuid(), 1)`],
      ['insert subscriptions', `insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason) select id, 'single', 1, 1, now(), 'x' from users limit 1`],
      ['update subscriptions', 'update subscriptions set reports_used = 0'],
      ['rewrite a report payload', `update reports set report = '{}'`],
      ['insert a report directly', `insert into reports (user_id, file_names, file_hashes, expires_at) select id, array['a'], array['h'], now() from users limit 1`],
      ['update analyses', `update analyses set status = 'ready'`],
      ['insert trades', `insert into trades (analysis_id, user_id, seq, symbol, kind, qty, pnl, currency, engine_version) select id, user_id, 999, 'X', 'EQ', 1, 1, 'INR', 'x' from analyses limit 1`],
      ['update consents', 'update consents set granted = true'],
      ['write per-file reports', `insert into analysis_file_reports (analysis_id, position, file_id, user_id) select analysis_id, 0, file_id, user_id from analysis_files limit 1`],
      ['update the file access log', 'update file_access_log set reason = null'],
      ['delete the file access log', 'delete from file_access_log'],
      ['run purge jobs', 'select purge_raw_files()'],
      ['call internal helpers', `select shred_files(array[]::uuid[], 'purged', 'x', 'system', null)`],
      ['read the research schema', 'select * from research.subjects'],
      ['create tables', 'create table probe (x int)'],
    ] as const;
    for (const [what, q] of denied) it(`cannot ${what}`, () => expectPgError(asRole(t, 'lens_app', q), DENIED));

    it('can rename a report (title only) and read its own data', async () => {
      await asRole(t, 'lens_app', `update reports set title = 'ok' where id = $1`, [report]);
      const rows = await asRole(t, 'lens_app', 'select count(*)::int as n from current_trades where user_id = $1', [user]);
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  describe('lens_worker (worker)', () => {
    const denied = [
      ['read users', 'select * from users'],
      ['read payments', 'select * from payments'],
      ['read credits', 'select * from credits'],
      ['read subscriptions', 'select * from subscriptions'],
      ['read consents', 'select * from consents'],
      ['read reports', 'select * from reports'],
      ['read the audit log', 'select * from audit_log'],
      ['change who owns an analysis', 'update analyses set user_id = user_id'],
      ['change file keys', 'update statement_files set wrapped_dek = null'],
      ['delete trades', 'delete from trades'],
      ['claim reports', `select create_report_from_analysis(gen_random_uuid(), gen_random_uuid(), null)`],
      ['grant plans', `select admin_grant_plan(gen_random_uuid(), gen_random_uuid(), 'single', 1, 1, 1, 'xxx')`],
      ['grant plans via the webhook function', `select grant_plan('o', 'p', '{}'::jsonb, 1, 1, 1)`],
      ['read real user ids behind the research pseudonyms', 'select * from research.consenting_users'],
      ['read the research pseudonym key', 'select * from research.pseudonym_key'],
      ['create tables', 'create table probe (x int)'],
    ] as const;
    for (const [what, q] of denied) it(`cannot ${what}`, () => expectPgError(asRole(t, 'lens_worker', q), DENIED));

    it('can read the pseudonymised research views (research dataset, 0021)', async () => {
      await asRole(t, 'lens_worker', 'select * from research.trades limit 1');
    });
    it('can run the scheduled purge jobs', async () => {
      const r = await asRole(t, 'lens_worker', 'select purge_raw_files() as a, purge_drafts() as b, purge_otp_codes() as c');
      expect(r[0]).toEqual({ a: 0, b: 0, c: 0 });
    });
  });

  describe('lens_research (future)', () => {
    it('cannot log in, even with a password', async () => {
      await t.admin.query(`alter role lens_research password 'research-probe-password'`);
      const c = new pg.Client({ connectionString: t.appUrl.replace(/lens_app:[^@]+@/, 'lens_research:research-probe-password@') });
      await expect(c.connect()).rejects.toThrow(/not permitted to log in/);
      await t.admin.query('alter role lens_research password null');
    });
    it('can read only the pseudonymised research views', async () => {
      await asRole(t, 'lens_research', 'select * from research.trades limit 1');
      await expectPgError(asRole(t, 'lens_research', 'select * from research.consenting_users'), DENIED);
      await expectPgError(asRole(t, 'lens_research', 'select * from research.pseudonym_key'), DENIED);
      await expectPgError(asRole(t, 'lens_research', 'select * from public.trades'), DENIED);
      await expectPgError(asRole(t, 'lens_research', 'select * from public.users'), DENIED);
    });
  });

  it('PUBLIC cannot execute any v2 function', async () => {
    const { rows } = await t.admin.query(`
      select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'research') and p.proname in ('create_report_from_analysis', 'add_analysis_to_report', 'admin_grant_plan',
         'analysis_file_set', 'shred_files', 'wipe_report', 'purge_raw_files', 'purge_drafts', 'purge_otp_codes', 'delete_report_v2',
         'delete_account', 'grant_plan')
         and has_function_privilege('public', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it('PUBLIC cannot connect to the database', async () => {
    const { rows } = await t.admin.query(`select has_database_privilege('public', current_database(), 'connect') as c`);
    expect(rows[0].c).toBe(false);
  });
});
