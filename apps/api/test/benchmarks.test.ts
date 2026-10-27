/**
 * @file  apps/api/test/benchmarks.test.ts
 * @area  Tests
 * @what  How you compare: the report's segment, "not enough traders yet" without quantiles, the share it beats from stored quantiles (own segment first, else all traders, lower-is-better flipped), owner only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis, golden } from '@pnl-lens/db/testing';
import { segmentOf, benchmarkValues, quantiles, ALL } from '@pnl-lens/shared/insights/benchmarks';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('benchmarks api', () => {
  let x: TestApp, u: string, id: string;
  const tb = golden('zerodha_tradebook_csv');
  beforeAll(async () => {
    x = await testApp('t_api_benchmarks');
    u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 1 });
    const { analysisId } = await readyAnalysis(x.t, u, { report: tb });
    id = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } })).json().id;
  });
  afterAll(async () => { await x?.close(); });
  const get = async (by = u) => x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}/benchmarks`, headers: await as(by) });
  const seg = segmentOf(tb.trades, tb.m.market)!;
  const q = (lo: number, hi: number) => quantiles(Array.from({ length: 101 }, (_, i) => lo + ((hi - lo) * i) / 100)).map(String);

  it('no benchmarks yet: the segment and how many traders there are', async () => {
    await x.t.admin.query(`insert into benchmarks (segment, metric, traders, quantiles) values ($1, 'win_rate', 12, null)`, [seg]);
    const r = (await get()).json();
    expect(r).toMatchObject({ segment: seg, enough: false, segmentTraders: 12, minTraders: 50 });
    expect(r.metrics.every((m: any) => m.better === null)).toBe(true);
  });

  it('own segment first, else all traders; lower-is-better is flipped', async () => {
    await x.t.admin.query('delete from benchmarks');
    await x.t.admin.query(`insert into benchmarks (segment, metric, traders, quantiles) values ($1, 'win_rate', 80, $2), ($3, 'deep_loss_share', 200, $4)`,
      [seg, q(0, 1), ALL, q(0, 1)]);
    const r = (await get()).json(), v = benchmarkValues(tb.trades)!;
    const win = r.metrics.find((m: any) => m.key === 'win_rate'), deep = r.metrics.find((m: any) => m.key === 'deep_loss_share');
    expect(r.enough).toBe(true);
    expect(win).toMatchObject({ group: seg, traders: 80 });
    expect(win.better).toBeCloseTo(v.win_rate!, 2);                       // values 0…1 spread evenly
    expect(deep).toMatchObject({ group: ALL, traders: 200 });
    expect(deep.better).toBeCloseTo(1 - v.deep_loss_share!, 2);
    expect(r.metrics.find((m: any) => m.key === 'payoff').better).toBeNull();
  });

  it('owner only', async () => {
    expect((await get(await makeUser(x.t))).statusCode).toBe(404);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}/benchmarks` })).statusCode).toBe(401);
  });
});
