/**
 * @file  apps/api/test/desk-profile.test.ts
 * @area  Tests
 * @what  GET /desk/profile: sign-in, then an active plan and a live report are needed; "building" until the first profile; watch-outs from the active version only (weak first, a strength, sample size and period in every line, no advice wording), the profile date line and the tradebook hint; each trader sees only their own; report changes ask for a rebuild; GET /reports/:id carries the Desk's plan vs actual for the report's period.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis, golden } from '@pnl-lens/db/testing';
import { createReportFromAnalysis } from '@pnl-lens/db';
import { isAdvice } from '@pnl-lens/shared/plan/templates';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('desk profile', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_desk_profile'); });
  afterAll(async () => { await x?.close(); });
  const get = async (u?: string) => x.app.inject({ method: 'GET', url: '/api/v1/desk/profile', headers: await as(u) });
  const pattern = (u: string, version: number, key: string, dims: object, o: Record<string, unknown>) => x.t.admin.query(
    `insert into trader_patterns (user_id, profile_version, segment_key, dims, n_trades, n_days, n_expiries, wins, win_days, win_rate, wr_low, wr_high, total_pnl, expectancy,
       expectancy_shrunk, recency, score, shown, verdict, period_from, period_to, last_trade_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16, $17, $18, $19, $20, $20)`,
    [u, version, key, JSON.stringify(dims), o.n, o.days, o.expiries ?? null, o.wins, o.winDays, o.wr, o.lo, o.hi, o.total, o.exp, o.shrunk, o.score, o.shown ?? true, o.verdict, o.from, o.to]);

  it('access: signed in, then a plan, then a report; "building" until the first profile', async () => {
    expect((await get()).statusCode).toBe(401);
    const u = await makeUser(x.t);
    expect((await get(u)).json()).toEqual({ access: 'no_plan', profile: null });
    await givePlan(x.t, u, { reports: 2 });
    expect((await get(u)).json()).toEqual({ access: 'no_report', profile: null });
    const { analysisId } = await readyAnalysis(x.t, u, { report: golden('zerodha_tradebook_csv') });
    const res = await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } });
    expect(res.statusCode).toBe(201);
    expect(x.queue.profiles).toContain(u);                                     // the report asked for a rebuild
    expect((await get(u)).json()).toEqual({ access: 'ok', profile: null, building: true });
    await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${res.json().id}`, headers: await as(u) });
    expect(x.queue.profiles.filter((id) => id === u)).toHaveLength(2);
  });

  it('watch-outs from the active version: weak first, one strength, sample and period in each line, no advice', async () => {
    const u = await makeUser(x.t), other = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 2 });
    const { analysisId } = await readyAnalysis(x.t, u, { report: golden('zerodha_fo_statement_xlsx') });
    await createReportFromAnalysis(x.t.app, u, analysisId, null);
    await x.t.admin.query(`insert into trader_profiles (user_id, active_version, period_from, period_to, newest_trade, n_trades, currency, unavailable)
                           values ($1, 2, '2026-04-01', '2026-09-30', '2026-09-30', 240, 'INR', '{side,time_bucket}')`, [u]);
    await pattern(u, 2, 'instrument=option|side=buy|dte=0', { instrument: 'option', side: 'buy', dte: '0' },
      { n: 36, days: 12, expiries: 12, wins: 10, winDays: 3, wr: 0.278, lo: 0.17, hi: 0.42, total: -18420, exp: -511.67, shrunk: -390, score: 4000, verdict: 'weak', from: '2026-04-07', to: '2026-09-22' });
    await pattern(u, 2, 'instrument=option|side=buy|time_bucket=open', { instrument: 'option', side: 'buy', time_bucket: 'open' },
      { n: 108, days: 12, wins: 96, winDays: 12, wr: 0.889, lo: 0.83, hi: 0.93, total: 88300, exp: 817.59, shrunk: 760, score: 9000, verdict: 'strong', from: '2026-04-03', to: '2026-09-18' });
    await pattern(u, 2, 'instrument=option', { instrument: 'option' },
      { n: 5, days: 2, wins: 0, winDays: 0, wr: 0, lo: 0, hi: 0.4, total: -900, exp: -180, shrunk: -50, score: 99999, verdict: 'weak', shown: false, from: '2026-09-01', to: '2026-09-02' });
    await pattern(u, 1, 'instrument=equity', { instrument: 'equity' },                // an old version: never read
      { n: 40, days: 20, wins: 2, winDays: 1, wr: 0.05, lo: 0.01, hi: 0.1, total: -99000, exp: -2475, shrunk: -2000, score: 99999, verdict: 'weak', from: '2026-01-01', to: '2026-03-01' });
    const j = (await get(u)).json();
    expect(j.access).toBe('ok');
    expect(j.profile).toMatchObject({ version: 2, periodTo: '2026-09-30', checkedAgainst: 'Checked against your trades up to 30 Sep 2026', unlockTime: 'Upload a tradebook to unlock time-of-day checks.' });
    expect(j.profile.watchouts.map((w: any) => [w.kind, w.segment])).toEqual([['weak', 'instrument=option|side=buy|dte=0'], ['strong', 'instrument=option|side=buy|time_bucket=open']]);
    // the real clock decides "(older data)" (newest trade more than 60 days ago)
    expect(j.profile.watchouts[0].text).toMatch(/^Your history: option buys on expiry day · 12 expiries · 3 profitable · −₹18,420 \(Apr–Sep 2026\)( \(older data\))?$/);
    expect(j.profile.watchouts[1].text).toMatch(/^Your history: option buys before 11:00 · 108 trades · 89% win rate · avg \+₹818 \(Apr–Sep 2026\)( \(older data\))?$/);
    for (const w of j.profile.watchouts) expect(isAdvice(w.text)).toBe(false);
    // per trader: someone else's request never sees these
    await givePlan(x.t, other, { reports: 1 });
    const { analysisId: a2 } = await readyAnalysis(x.t, other, { report: golden('dhan_tradebook_csv') });
    await createReportFromAnalysis(x.t.app, other, a2, null);
    expect((await get(other)).json()).toEqual({ access: 'ok', profile: null, building: true });
  });

  it('a report carries the Desk\'s plan vs actual for its own period only', async () => {
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 2 });
    const { analysisId } = await readyAnalysis(x.t, u, { report: golden('zerodha_tradebook_csv') });     // 6 Jan – 26 Mar 2025
    const id = await createReportFromAnalysis(x.t.app, u, analysisId, null);
    const score = (d: string, taken: number, on: number, off: number) => x.t.admin.query(`insert into plan_day_scores (user_id, plan_date, planned, taken, not_taken, unmarked, off_plan,
      on_plan_pnl, off_plan_pnl, rules_kept, rules_total, source) values ($1, $2, 2, $3, 0, 0, $4, $5, 0, $3, $3, 'journal')`, [u, d, taken, off, on]);
    const empty = (await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: await as(u) })).json();
    expect(empty.planActual).toBeNull();
    await score('2025-02-03', 2, 1500, 0); await score('2025-02-04', 1, -700, 1); await score('2025-05-01', 2, 9999, 0);   // the last is after the period
    const r = (await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: await as(u) })).json();
    expect(r.planActual).toMatchObject({ from: '2025-01-06', to: '2025-03-26', days: 2, planned: 4, taken: 3, offPlan: 1, onPlanPnl: 800, rulesKept: 3, rulesTotal: 3 });
  });
});
