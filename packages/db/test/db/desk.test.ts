/**
 * @file  packages/db/test/db/desk.test.ts
 * @area  Tests
 * @what  Desk reference data (0033): seeded rate sets (1 Apr 2026 for every segment and exchange plus the earlier F&O STT), default brokerage plans, calendar and 2026 NSE holidays; grants (app edits reference rows, never deletes rates; worker read-only); desk settings per user, cleared on account deletion, in the data export; events and headlines (0034): events are never deleted, their history is append-only, the worker has no access; Trade Check plans and rules (0036): a kept line needs a reason, the app never deletes, export and account deletion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('desk reference data (0033)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_desk'); });
  afterAll(async () => { await t?.close(); });
  const q = async (sql: string, p: unknown[] = []) => (await t.admin.query(sql, p)).rows;

  it('seeds: a rate set for every segment and exchange from 1 Apr 2026, the earlier F&O STT, one default brokerage plan per segment', async () => {
    const sets = await q(`select segment, exchange from charge_rates where effective_from = '2026-04-01'`);
    expect(sets).toHaveLength(16);
    const opt = await q(`select effective_from::text f, stt_sell::float8 s from charge_rates where segment = 'options' and exchange = 'NSE' order by effective_from`);
    expect(opt).toEqual([{ f: '2024-10-01', s: 0.001 }, { f: '2026-04-01', s: 0.0015 }]);
    const defaults = await q(`select segment from brokerage_plans where is_default`);
    expect(defaults).toHaveLength(8);
  });

  it('calendar: weekdays only, 2026 NSE holidays, MCX late close in winter', async () => {
    expect(await q(`select count(*)::int n from market_calendar where extract(isodow from day) > 5`)).toEqual([{ n: 0 }]);
    const [h] = await q(`select is_holiday, note from market_calendar where day = '2026-11-24' and segment = 'equity' and exchange = 'NSE'`);
    expect(h).toMatchObject({ is_holiday: true });
    const mcx = await q(`select day::text d, close::text c from market_calendar where segment = 'commodity' and day in ('2026-07-01', '2026-12-01') order by day`);
    expect(mcx).toEqual([{ d: '2026-07-01', c: '23:30:00' }, { d: '2026-12-01', c: '23:55:00' }]);
  });

  it('grants: the app adds rates but never deletes them; the worker only reads', async () => {
    await asRole(t, 'lens_app', `insert into market_calendar (day, segment, exchange, is_holiday) values ('2027-06-01', 'equity', 'NSE', true) on conflict do nothing`);
    await expectPgError(asRole(t, 'lens_app', `delete from charge_rates`), '42501');
    await expectPgError(asRole(t, 'lens_app', `delete from brokerage_plans`), '42501');
    expect((await asRole(t, 'lens_worker', `select count(*)::int n from charge_rates`))[0].n).toBeGreaterThan(0);
    await expectPgError(asRole(t, 'lens_worker', `update charge_rates set gst = 0`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `select * from desk_settings`), '42501');
  });

  it('settings: one row per user; in the data export; gone when the account is deleted', async () => {
    const u = await makeUser(t);
    await asRole(t, 'lens_app', `insert into desk_settings (user_id, risk_per_trade, max_trades_day) values ($1, 3000, 3)`, [u]);
    await expectPgError(asRole(t, 'lens_app', `insert into desk_settings (user_id) values ($1)`, [u]), '23505');
    const req = (await q(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u]))[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.desk_settings).toMatchObject({ max_trades_day: 3 });
    await q('select delete_account($1)', [u]);
    expect(await q('select count(*)::int n from desk_settings where user_id = $1', [u])).toEqual([{ n: 0 }]);
  });

  it('0034: events are hidden, never deleted; history is append-only; headlines expire; the worker has no access', async () => {
    const [e] = await asRole(t, 'lens_app', `insert into desk_events (day, title, impact, source, source_id) values ('2026-11-26', 'Test event', 'high', 'test', 'x1') returning id`);
    await asRole(t, 'lens_app', `insert into desk_event_history (event_id, change) values ($1, 'created')`, [e.id]);
    await asRole(t, 'lens_app', `update desk_events set hidden = true where id = $1`, [e.id]);
    await expectPgError(asRole(t, 'lens_app', `delete from desk_events where id = $1`, [e.id]), '42501');
    await expectPgError(asRole(t, 'lens_app', `update desk_event_history set change = 'updated'`), '42501');
    await expectPgError(asRole(t, 'lens_app', `delete from desk_event_history`), '42501');
    await expectPgError(asRole(t, 'lens_app', `insert into desk_events (day, title, impact, source, source_id) values ('2026-11-26', 'Bad', 'urgent', 'test', 'x2')`), '23514');
    await expectPgError(asRole(t, 'lens_app', `insert into desk_headlines (provider, title, title_key, source, url, published_at) values ('t', 'T', 't', 'S', 'javascript:alert(1)', now())`), '23514');
    await asRole(t, 'lens_app', `insert into desk_headlines (provider, title, title_key, source, url, published_at) values ('t', 'T', 't', 'S', 'https://n.example/1', now())`);
    await asRole(t, 'lens_app', `delete from desk_headlines where provider = 't'`);
    await expectPgError(asRole(t, 'lens_worker', `select * from desk_events`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `select * from desk_headlines`), '42501');
  });

  it('0036: a kept line needs a reason; the app never deletes; in the export; gone when the account is closed', async () => {
    const u = await makeUser(t);
    const [r] = await asRole(t, 'lens_app', `insert into trader_rules (user_id, kind, params, source) values ($1, 'max_trades_day', '{"n":3}', 'manual') returning id`, [u]);
    await expectPgError(asRole(t, 'lens_app', `insert into trader_rules (user_id, kind, params, source) values ($1, 'anything', '{}', 'manual')`, [u]), '23514');
    const [p] = await asRole(t, 'lens_app', `insert into trade_plans (user_id, plan_date) values ($1, '2026-11-25') returning id`, [u]);
    const [l] = await asRole(t, 'lens_app', `insert into trade_plan_lines (plan_id, user_id, position, raw_text, parsed, features, check_result, check_version)
                                             values ($1, $2, 1, 'NIFTY 24300 CE buy 120 1 lot', '{}', '{}', '{"chips":[]}', '1.0') returning id`, [p.id, u]);
    await expectPgError(asRole(t, 'lens_app', `update trade_plan_lines set decision = 'kept' where id = $1`, [l.id]), '23514');
    await asRole(t, 'lens_app', `update trade_plan_lines set decision = 'kept', keep_reason = 'Small size' where id = $1`, [l.id]);
    await asRole(t, 'lens_app', `insert into insight_events (user_id, line_id, chip_key) values ($1, $2, 'rule:1')`, [u, l.id]);
    await asRole(t, 'lens_app', `insert into plan_checklist (user_id, plan_date, items) values ($1, '2026-11-25', '[{"text":"a","done":true}]')`, [u]);
    for (const tbl of ['trader_rules', 'trade_plans', 'trade_plan_lines', 'plan_checklist', 'insight_events'])
      await expectPgError(asRole(t, 'lens_app', `delete from ${tbl}`), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'select * from trade_plan_lines'), '42501');
    const req = (await q(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u]))[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.trade_check_rules).toMatchObject([{ kind: 'max_trades_day', params: { n: 3 } }]);
    expect(row.d.trade_plans[0]).toMatchObject({ date: '2026-11-25', lines: [{ text: 'NIFTY 24300 CE buy 120 1 lot', decision: 'kept', keep_reason: 'Small size' }], checklist: [{ text: 'a', done: true }] });
    expect(r.id).toBeTruthy();
    await q('select delete_account($1)', [u]);
    for (const tbl of ['trader_rules', 'trade_plans', 'trade_plan_lines', 'plan_checklist', 'insight_events'])
      expect(await q(`select count(*)::int n from ${tbl} where user_id = $1`, [u]), tbl).toEqual([{ n: 0 }]);
  });
});
