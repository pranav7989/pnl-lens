/**
 * @file  apps/worker/test/actuals.test.ts
 * @area  Tests
 * @what  Plan lines matched to a real tradebook (golden Zerodha, 3 Mar 2025) on a real database: matched trades and results stored per line, the day scored from the tradebook (its unmatched trades are off-plan), a typed result loses to the match, a later tradebook without the trade clears the match, and the worker cannot read other tables.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, golden, asRole, expectPgError, type TestDb } from '@pnl-lens/db/testing';
import { createDb, createReportFromAnalysis, deleteReport } from '@pnl-lens/db';
import { parseLine } from '@pnl-lens/shared/plan/parse';
import { matchPlans } from '../src/actuals.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('plan lines vs the tradebook', () => {
  let t: TestDb; let pool: pg.Pool; let close: () => Promise<void>;
  beforeAll(async () => {
    t = await freshDb('t_worker_actuals');
    const w = createDb({ connectionString: t.workerUrl, max: 4, ssl: false });
    pool = w.pool; close = () => w.db.destroy();
  });
  afterAll(async () => { await close?.(); await t?.close(); });
  const q = async (sql: string, p: unknown[] = []) => (await t.admin.query(sql, p)).rows;

  it('matches, stores results, scores the day from the tradebook; the match wins over a typed result', async () => {
    const u = await makeUser(t);
    await givePlan(t, u, { reports: 2 });
    const { analysisId } = await readyAnalysis(t, u, { report: golden('zerodha_tradebook_csv') });
    const report = await createReportFromAnalysis(t.app, u, analysisId, null);
    const [plan] = await q(`insert into trade_plans (user_id, plan_date) values ($1, '2025-03-03') returning id`, [u]);
    const line = async (pos: number, text: string) => (await q(`insert into trade_plan_lines (plan_id, user_id, position, raw_text, parsed, features, check_result, check_version)
                                                                 values ($1, $2, $3, $4, $5, '{}', '{"chips":[]}', '1.0') returning id`, [plan.id, u, pos, text, JSON.stringify(parseLine(text))]))[0].id;
    const a = await line(1, 'NIFTY 22500 PE buy 100 1 lot'), b = await line(2, 'RELIANCE buy 1300 qty 10'), c = await line(3, 'BANKNIFTY FUT buy 50000 1 lot');
    await q(`insert into plan_outcomes (line_id, user_id, taken, manual_pnl) values ($1, $2, true, 999)`, [a, u]);       // typed before the tradebook came

    expect(await matchPlans(pool, u)).toEqual({ days: 1, matched: 2, offPlan: 3 });
    const outs = await q('select line_id, taken, manual_pnl::float8 m, cardinality(matched_trade_ids) n, round(matched_pnl, 2)::float8 p from plan_outcomes where user_id = $1 order by line_id', [u]);
    expect(outs).toEqual([
      { line_id: a, taken: true, m: 999, n: 1, p: 5424 }, { line_id: b, taken: null, m: null, n: 1, p: -13716 }, { line_id: c, taken: null, m: null, n: 0, p: null },
    ]);
    const [s] = await q(`select planned, taken, not_taken, unmarked, off_plan, round(on_plan_pnl, 2)::float8 on_plan, round(off_plan_pnl, 2)::float8 off_pnl, rules_kept, rules_total, source
                           from plan_day_scores where user_id = $1 and plan_date = '2025-03-03'`, [u]);
    expect(s).toEqual({ planned: 3, taken: 2, not_taken: 0, unmarked: 1, off_plan: 3, on_plan: 5424 - 13716, off_pnl: 2322.5 + 1279.5 + 4710, rules_kept: 2, rules_total: 2, source: 'tradebook' });

    // the report goes: nothing is matched any more
    await deleteReport(t.app, u, report);
    expect(await matchPlans(pool, u)).toEqual({ days: 0, matched: 0, offPlan: 0 });
    expect(await q('select line_id, taken, cardinality(matched_trade_ids) n, matched_pnl from plan_outcomes where user_id = $1 order by line_id', [u]))
      .toEqual([{ line_id: a, taken: true, n: 0, matched_pnl: null }, { line_id: b, taken: null, n: 0, matched_pnl: null }, { line_id: c, taken: null, n: 0, matched_pnl: null }]);
    const [after] = await q(`select taken, unmarked, off_plan, on_plan_pnl::float8 p, source from plan_day_scores where user_id = $1 and plan_date = '2025-03-03'`, [u]);
    expect(after).toEqual({ taken: 1, unmarked: 2, off_plan: 0, p: 999, source: 'journal' });     // the typed result is back
  });

  it('the worker reads plans but cannot change them, and cannot read reports', async () => {
    await expectPgError(asRole(t, 'lens_worker', `update trade_plan_lines set raw_text = 'x'`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `delete from journal_trades`), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'select * from reports'), '42501');
  });
});
