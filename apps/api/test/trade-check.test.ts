/**
 * @file  apps/api/test/trade-check.test.ts
 * @area  Tests
 * @what  Trade Check phase 2 API on a real database: plan + report gate, context, suggestions (accept once, dismiss, never again), a typed line checked and stored (rule ✕ + history !), the browser's check() on the same context gives the stored result, unclear lines refused with the fields, rules re-checked over the day, remove / keep (reason required) / edit, per-trader isolation, checklist, chips logged, and the check time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis, golden } from '@pnl-lens/db/testing';
import { createReportFromAnalysis } from '@pnl-lens/db';
import { checkDay } from '@pnl-lens/shared/plan/check';
import { isAdvice } from '@pnl-lens/shared/plan/templates';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

describe.skipIf(!ok)('trade check', () => {
  let x: TestApp;
  beforeAll(async () => {
    x = await testApp('t_api_trade_check');
    // today is a Nifty expiry; lot size 65
    await x.t.admin.query(`insert into expiry_calendar (underlying, exchange, expiry, kind) values ('NIFTY', 'NSE', $1, 'weekly'), ('NIFTY', 'NSE', $1::date + 35, 'monthly')`, [today()]);
    await x.t.admin.query(`insert into instrument_master (exchange, segment, symbol, underlying, instrument, expiry, lot_size, valid_from) values ('NSE', 'derivatives', 'NIFTY FUT X', 'NIFTY', 'FUTIDX', $1::date + 35, 65, $1)`, [today()]);
  });
  afterAll(async () => { await x?.close(); });
  const call = async (u: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    x.app.inject({ method, url: `/api/v1${url}`, headers: await as(u), ...(payload ? { payload } : {}) });

  /** a trader with a plan, a report and a profile where option buys on expiry day are weak */
  async function trader() {
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 2 });
    const { analysisId } = await readyAnalysis(x.t, u, { report: golden('zerodha_tradebook_csv') });
    await createReportFromAnalysis(x.t.app, u, analysisId, null);
    await x.t.admin.query(`insert into trader_profiles (user_id, active_version, period_from, period_to, newest_trade, n_trades, currency, usual_qty)
                           values ($1, 3, '2026-04-01', '2026-09-30', '2026-09-30', 240, 'INR', '{"NIFTY|option": 65}')`, [u]);
    await x.t.admin.query(`insert into trader_patterns (user_id, profile_version, segment_key, dims, n_trades, n_days, n_expiries, wins, win_days, win_rate, wr_low, wr_high,
                             total_pnl, expectancy, expectancy_shrunk, recency, score, shown, verdict, period_from, period_to, last_trade_at)
                           values ($1, 3, 'instrument=option|side=buy|dte=0', '{"instrument":"option","side":"buy","dte":"0"}', 36, 12, 12, 10, 3, 0.278, 0.17, 0.42,
                             -18420, -511.67, -390, 1, 4000, true, 'weak', '2026-04-07', '2026-09-22', '2026-09-22'),
                                  ($1, 3, 'underlying=NIFTY', '{"underlying":"NIFTY"}', 200, 60, null, 120, 40, 0.6, 0.55, 0.65, 50000, 250, 200, 1, 10, true, 'neutral', '2026-04-01', '2026-09-30', '2026-09-30')`, [u]);
    return u;
  }

  it('needs a plan and a report', async () => {
    const u = await makeUser(x.t);
    expect((await call(u, 'GET', '/desk/context')).json()).toMatchObject({ error: 'no_plan' });
    await givePlan(x.t, u, { reports: 1 });
    expect((await call(u, 'GET', '/desk/context')).statusCode).toBe(403);
    expect((await call(u, 'POST', `/desk/plans/${today()}/lines`, { text: 'NIFTY 24300 CE buy 120 1 lot' })).json()).toMatchObject({ error: 'no_report' });
  });

  it('suggestions: from weak habits and settings; accepted once; dismissed ones never come back', async () => {
    const u = await trader();
    await x.t.admin.query(`insert into desk_settings (user_id, max_trades_day, max_daily_loss) values ($1, 3, 6000)`, [u]);
    const ctx = (await call(u, 'GET', '/desk/context')).json();
    expect(ctx.context.profile).toMatchObject({ version: 3, currency: 'INR', tradedUnderlyings: ['NIFTY'] });
    expect(ctx.context.lots).toEqual({ NIFTY: 65 });
    expect(ctx.checkedAgainst).toBe('Checked against your trades up to 30 Sep 2026');
    const keys = ctx.suggestions.map((s: any) => s.key);
    expect(keys).toEqual(['segment:instrument=option|side=buy|dte=0', 'settings:max_trades_day', 'settings:max_daily_loss']);
    const sg = ctx.suggestions[0];
    expect(sg).toMatchObject({ kind: 'no_segment', label: 'No option buys on expiry day' });
    expect(sg.why).toMatch(/^Your history: option buys on expiry day · 12 expiries · 3 profitable · −₹18,420/);
    expect((await call(u, 'POST', '/desk/rules', { kind: sg.kind, params: sg.params, source: 'suggested', suggestion: sg.key })).statusCode).toBe(201);
    expect((await call(u, 'POST', '/desk/rules', { kind: sg.kind, params: sg.params, source: 'suggested', suggestion: sg.key })).statusCode).toBe(409);
    const dl = ctx.suggestions[2];
    expect((await call(u, 'POST', '/desk/rules/dismiss', { kind: dl.kind, params: dl.params, suggestion: dl.key })).statusCode).toBe(200);
    const again = (await call(u, 'GET', '/desk/context')).json();
    expect(again.suggestions.map((s: any) => s.key)).toEqual(['settings:max_trades_day']);
    expect(again.rules.map((r: any) => r.label)).toEqual(['No option buys on expiry day']);
    expect((await call(u, 'POST', '/desk/rules', { kind: 'max_trades_day', params: { n: 0 } })).statusCode).toBe(400);
    expect((await call(u, 'POST', '/desk/rules', { kind: 'no_segment', params: { dims: { colour: 'red' } } })).statusCode).toBe(400);
  });

  it('a line is checked and stored; the browser\'s check() on the same context gives the same result', async () => {
    const u = await trader();
    await call(u, 'POST', '/desk/rules', { kind: 'no_segment', params: { dims: { instrument: 'option', side: 'buy', dte: '0' } } });
    const bad = await call(u, 'POST', `/desk/plans/${today()}/lines`, { text: 'NIFTY CE buy 120' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.map((e: any) => e.field)).toEqual(expect.arrayContaining(['strike', 'size']));
    const res = await call(u, 'POST', `/desk/plans/${today()}/lines`, { text: 'NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot' });
    expect(res.statusCode).toBe(201);
    const line = res.json().line;
    expect(line.check_result.chips[0]).toMatchObject({ kind: 'rule', level: 'block', text: 'Breaks your rule: "No option buys on expiry day"' });
    expect(line.check_result.chips.some((c: any) => c.kind === 'history' && c.level === 'caution' && c.text.startsWith('Your history: option buys on expiry day · 12 expiries'))).toBe(true);
    expect(line.check_result).toMatchObject({ check_version: '1.0', profile_version: 3, qty: 65 });
    expect(line.check_result.loss_at_sl).toBeGreaterThan(30 * 65);              // with charges
    for (const c of line.check_result.chips) expect(isAdvice(c.text), c.text).toBe(false);
    // the browser: the same function on GET /desk/context
    const ctx = (await call(u, 'GET', '/desk/context')).json();
    const browser = checkDay(ctx.lines.map((l: any) => ({ parsed: l.parsed, removed: l.decision === 'removed' })), ctx.context);
    expect(browser[0]).toEqual(ctx.lines[0].check_result);
    expect((await x.t.admin.query('select chip_key from insight_events where line_id = $1 order by id', [line.id])).rows.map((r) => r.chip_key)[0]).toMatch(/^rule:/);
    // a new profile version (a report changed): the day's lines are checked again when the Desk opens
    await x.t.admin.query('update trader_profiles set active_version = 4 where user_id = $1', [u]);
    await x.t.admin.query('update trader_patterns set profile_version = 4 where user_id = $1', [u]);
    expect((await call(u, 'GET', '/desk/context')).json().lines[0].check_result.profile_version).toBe(4);
  });

  it('rules over the day: trade count and planned loss; remove, keep with a reason, edit', async () => {
    const u = await trader();
    await call(u, 'POST', '/desk/rules', { kind: 'max_trades_day', params: { n: 1 } });
    const add = async (t: string) => (await call(u, 'POST', `/desk/plans/${today()}/lines`, { text: t })).json();
    const a = (await add('NIFTY FUT buy 25000 SL 24950 1 lot')).line;
    const b = (await add('RELIANCE buy 2500 SL 2450 qty 10')).line;
    expect(b.check_result.chips.map((c: any) => c.text)).toContain('Breaks your rule: "No more than 1 trade a day" · this is trade 2 of the day');
    expect((await call(u, 'PATCH', `/desk/lines/${b.id}/decision`, { decision: 'kept' })).json()).toMatchObject({ error: 'reason_required' });
    const kept = (await call(u, 'PATCH', `/desk/lines/${b.id}/decision`, { decision: 'kept', reason: 'Results play, small size' })).json().line;
    expect([kept.decision, kept.keep_reason]).toEqual(['kept', 'Results play, small size']);
    const after = (await call(u, 'PATCH', `/desk/lines/${a.id}/decision`, { decision: 'removed' })).json().lines;
    expect(after.find((l: any) => l.id === b.id).check_result.chips.some((c: any) => c.text.includes('trade 2 of the day'))).toBe(false);   // checked again
    const ed = (await call(u, 'PATCH', `/desk/lines/${b.id}`, { text: 'RELIANCE buy 2500 SL 2480 qty 5' })).json().line;
    expect([ed.decision, ed.parsed.qty, ed.keep_reason]).toEqual(['edited', 5, null]);
    expect((await call(u, 'PATCH', `/desk/lines/${b.id}`, { text: 'RELIANCE buy' })).statusCode).toBe(400);
    const other = await trader();
    expect((await call(other, 'PATCH', `/desk/lines/${b.id}/decision`, { decision: 'removed' })).statusCode).toBe(404);
    expect((await call(other, 'GET', '/desk/context')).json().lines).toEqual([]);
    const rule = (await call(u, 'GET', '/desk/context')).json().rules[0];
    expect((await call(u, 'PATCH', `/desk/rules/${rule.id}`, { params: { n: 5 } })).json().rule.label).toBe('No more than 5 trades a day');
    expect((await call(other, 'PATCH', `/desk/rules/${rule.id}`, { active: false })).statusCode).toBe(404);
  });

  it('checklist: four default items, saved per day', async () => {
    const u = await trader();
    const def = (await call(u, 'GET', '/desk/context')).json().checklist;
    expect(def).toHaveLength(4);
    const items = def.map((i: any, k: number) => ({ ...i, done: k < 2 }));
    expect((await call(u, 'PUT', `/desk/checklist/${today()}`, { items })).statusCode).toBe(200);
    expect((await call(u, 'GET', '/desk/context')).json().checklist).toEqual(items);
    expect((await call(u, 'PUT', '/desk/checklist/2020-01-01', { items })).statusCode).toBe(400);
  });

  it('check time: p95 of saving a checked line stays under 150 ms', async () => {
    const u = await trader();
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      await call(u, 'POST', `/desk/plans/${today()}/lines`, { text: `NIFTY ${24000 + i * 50} CE buy ${100 + i} SL ${80 + i} 1 lot` });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
  });
});
