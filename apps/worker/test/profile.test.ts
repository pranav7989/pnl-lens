/**
 * @file  apps/worker/test/profile.test.ts
 * @area  Tests
 * @what  Trade Check profile rebuild on a real database: features for every stored trade, baseline and patterns from a golden report, a second copy of the same statement counted once, versions switched atomically (two at once stay consistent), old versions dropped, no reports = no profile, the nightly catch-up list, grants, export and account deletion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, golden, asRole, expectPgError, type TestDb } from '@pnl-lens/db/testing';
import { createDb, createReportFromAnalysis, deleteReport } from '@pnl-lens/db';
import { rebuildProfile, rebuildDueProfiles } from '../src/profile.js';

const ok = await testDbAvailable();
const NOW = new Date('2026-10-01T03:00:00Z');

describe.skipIf(!ok)('Trade Check profile rebuild', () => {
  let t: TestDb; let pool: pg.Pool; let close: () => Promise<void>;
  beforeAll(async () => {
    t = await freshDb('t_worker_profile');
    const w = createDb({ connectionString: t.workerUrl, max: 4, ssl: false });
    pool = w.pool; close = () => w.db.destroy();
  });
  afterAll(async () => { await close?.(); await t?.close(); });
  const q = async (sql: string, p: unknown[] = []) => (await t.admin.query(sql, p)).rows;
  const report = async (u: string, id = 'zerodha_tradebook_csv') => {
    const { analysisId } = await readyAnalysis(t, u, { report: golden(id) });
    return createReportFromAnalysis(t.app, u, analysisId, null);
  };

  it('builds features, baseline and patterns from the live reports; a repeat statement counts once', async () => {
    const u = await makeUser(t);
    await givePlan(t, u, { reports: 5 });
    const r1 = await report(u);
    expect(await rebuildProfile(pool, u, NOW)).toMatchObject({ version: 1, trades: 96 });
    expect((await q('select count(*)::int n, count(distinct trade_id)::int d from trade_features where user_id = $1', [u]))[0]).toEqual({ n: 96, d: 96 });
    const [p] = await q('select active_version, n_trades, period_from::text pf, period_to::text pt, source_report_ids from trader_profiles where user_id = $1', [u]);
    expect(p).toEqual({ active_version: 1, n_trades: 96, pf: '2025-01-06', pt: '2025-03-26', source_report_ids: [r1] });
    const [ob] = await q(`select n_trades, wins, total_pnl::float8 total from trader_patterns where user_id = $1 and profile_version = 1 and segment_key = 'instrument=option|side=buy'`, [u]);
    expect(ob).toEqual({ n_trades: 55, wins: 26, total: 21338.25 });

    await report(u);                                                           // the same statement again
    expect(await rebuildProfile(pool, u, NOW)).toMatchObject({ version: 2, trades: 96 });
    await rebuildProfile(pool, u, NOW);
    expect((await q('select array_agg(distinct profile_version order by profile_version) v from trader_patterns where user_id = $1', [u]))[0].v).toEqual([2, 3]);
    expect((await q('select active_version from trader_profiles where user_id = $1', [u]))[0].active_version).toBe(3);
  });

  it('two rebuilds at once: one waits, versions stay consecutive and the active one is complete', async () => {
    const u = await makeUser(t);
    await givePlan(t, u, { reports: 2 });
    await report(u, 'dhan_tradebook_csv');
    const [a, b] = await Promise.all([rebuildProfile(pool, u, NOW), rebuildProfile(pool, u, NOW)]);
    expect([a.version, b.version].sort()).toEqual([1, 2]);
    const [p] = await q('select active_version from trader_profiles where user_id = $1', [u]);
    const [n] = await q('select count(*)::int n from trader_patterns where user_id = $1 and profile_version = $2', [u, p.active_version]);
    expect(n.n).toBe(a.patterns);
  });

  it('no live reports: no profile; the nightly catch-up finds who is due', async () => {
    const u = await makeUser(t), v = await makeUser(t);
    await givePlan(t, u, { reports: 2 }); await givePlan(t, v, { reports: 2 });
    const r = await report(u);
    await report(v, 'dhan_tradebook_csv');
    const due = async () => (await q('select user_id from profiles_due(1000)')).map((x) => x.user_id);
    expect(await due()).toEqual(expect.arrayContaining([u, v]));
    expect(await rebuildDueProfiles(pool, NOW)).toMatchObject({ failed: 0 });
    expect(await due()).not.toContain(u);
    await deleteReport(t.app, u, r);
    expect(await due()).toContain(u);                                            // has a profile but no reports
    expect(await rebuildProfile(pool, u, NOW)).toMatchObject({ version: null, trades: 0 });
    expect(await q('select 1 from trader_profiles where user_id = $1 union all select 1 from trade_features where user_id = $1', [u])).toEqual([]);
  });

  it('grants: the app only reads; only the worker reads report trades; export and account deletion', async () => {
    const u = await makeUser(t);
    await givePlan(t, u, { reports: 1 });
    await report(u);
    await rebuildProfile(pool, u, NOW);
    expect((await asRole(t, 'lens_app', 'select count(*)::int n from trader_patterns where user_id = $1', [u]))[0].n).toBeGreaterThan(0);
    await expectPgError(asRole(t, 'lens_app', 'delete from trader_patterns where user_id = $1', [u]), '42501');
    await expectPgError(asRole(t, 'lens_app', 'update trader_profiles set active_version = 9'), '42501');
    await expectPgError(asRole(t, 'lens_app', 'select * from trade_features'), '42501');
    await expectPgError(asRole(t, 'lens_app', 'select * from profile_source_trades($1)', [u]), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'select * from reports'), '42501');
    const req = (await q(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u]))[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.trade_check_profile).toMatchObject({ version: 1, baseline: { n_trades: 96 } });
    expect(row.d.trade_check_profile.patterns.length).toBeGreaterThan(0);
    await q('select delete_account($1)', [u]);
    for (const tbl of ['trader_profiles', 'trader_patterns', 'trader_baselines', 'trade_features'])
      expect((await q(`select count(*)::int n from ${tbl} where user_id = $1`, [u]))[0].n, tbl).toBe(0);
  });
});
