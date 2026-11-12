/**
 * @file  apps/worker/test/benchmarks.test.ts
 * @area  Tests
 * @what  Peer benchmarks build: only consenting traders, each once per segment (latest report), quantiles only for groups of 50+, the table replaced atomically, no ids stored; grants.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, golden, asRole, expectPgError, type TestDb } from '@pnl-lens/db/testing';
import { createReportFromAnalysis } from '@pnl-lens/db';
import { buildBenchmarks } from '../src/benchmarks.js';
import { ALL, MIN_TRADERS, segmentOf } from '@pnl-lens/shared/insights/benchmarks';

const ok = await testDbAvailable();

describe.skipIf(!ok)('peer benchmarks build', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_worker_benchmarks'); });
  afterAll(async () => { await t?.close(); });

  const trader = async (goldenId: string, consent: boolean) => {
    const u = await makeUser(t);
    await givePlan(t, u, { reports: 3 });
    const { analysisId } = await readyAnalysis(t, u, { report: golden(goldenId) });
    await createReportFromAnalysis(t.app, u, analysisId, null);
    await t.admin.query(`insert into consents (user_id, purpose, granted, policy_version, text_sha256) values ($1, 'research', $2, '2026-10', repeat('a', 64))`, [u, consent]);
    return u;
  };

  it(`segments under ${MIN_TRADERS} keep only their count; all traders with 50+ get quantiles; non-consenting traders are left out`, async () => {
    const big = ['zerodha_tradebook_csv', 'zerodha_tradebook_pdf', 'combo_three_files'];
    for (let i = 0; i < 52; i++) await trader(big[i % 3], true);
    for (let i = 0; i < 3; i++) await trader('binance_trades_csv', true);
    for (let i = 0; i < 5; i++) await trader('zerodha_tradebook_csv', false);       // no consent: never counted
    const r = await buildBenchmarks(t.worker);
    expect(r.traders).toBe(55);
    const rows = (await t.admin.query('select * from benchmarks')).rows;
    const all = rows.filter((x) => x.segment === ALL);
    expect(all.every((x) => x.traders === 55)).toBe(true);
    expect(all.find((x) => x.metric === 'win_rate').quantiles).toHaveLength(19);
    const crypto = segmentOf(golden('binance_trades_csv').trades, golden('binance_trades_csv').m.market)!;
    const small = rows.filter((x) => x.segment === crypto);
    expect(small.length).toBeGreaterThan(0);
    expect(small.every((x) => x.traders === 3 && x.quantiles === null)).toBe(true);
    // only aggregates: no ids anywhere in the table
    expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // rebuilding replaces the set
    await buildBenchmarks(t.worker);
    expect((await t.admin.query('select count(*)::int n from benchmarks')).rows[0].n).toBe(rows.length);
  });

  it('grants: the app reads, the worker writes', async () => {
    await asRole(t, 'lens_app', 'select * from benchmarks limit 1');
    await expectPgError(asRole(t, 'lens_app', `delete from benchmarks`), '42501');
    await asRole(t, 'lens_worker', `select count(*) from benchmarks`);
  });
});
