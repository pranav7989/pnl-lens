/**
 * @file  apps/api/test/desk.test.ts
 * @area  Tests
 * @what  Desk API on the real seeded rates (migration 0033): public config and calculator (spec B2.6 golden to the paisa, rate set by date, position size), the trader's settings, owner/admin editing of rates, brokerage plans and the calendar (permission + audit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { paise } from '@pnl-lens/shared/desk/charges';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('desk', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_desk'); });
  afterAll(async () => { await x?.close(); });
  const calc = async (body: object) => x.app.inject({ method: 'POST', url: '/api/v1/desk/calc', headers: await as(), payload: body });

  it('config is public: rates in force, brokerage plans, the calendar of the day', async () => {
    const r = await x.app.inject({ method: 'GET', url: '/api/v1/desk/config?date=2026-11-24' });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.rates.find((z: any) => z.segment === 'options' && z.exchange === 'NSE')).toMatchObject({ effective_from: '2026-04-01', stt_sell: 0.0015, exch_txn: 0.0003553 });
    expect(j.rates).toHaveLength(16);                                         // 8 segments x 2 exchanges in force
    expect(j.brokerage.filter((p: any) => p.is_default)).toHaveLength(8);
    expect(j.calendar.find((c: any) => c.segment === 'equity' && c.exchange === 'NSE')).toMatchObject({ is_holiday: true, note: 'Prakash Gurpurb Sri Guru Nanak Dev' });
    const work = (await x.app.inject({ method: 'GET', url: '/api/v1/desk/config?date=2026-11-25' })).json();
    expect(work.calendar.find((c: any) => c.segment === 'equity' && c.exchange === 'NSE')).toMatchObject({ is_holiday: false, pre_open: '09:00', open: '09:15', close: '15:30' });
    expect(work.calendar.find((c: any) => c.segment === 'commodity').close).toBe('23:55');
  });

  it('calculator: the spec B2.6 golden example on the seeded rates, to the paisa', async () => {
    const r = await calc({ segment: 'options', exchange: 'NSE', buy: 120, sell: 170, qty: 65, date: '2026-11-24', slippagePerUnit: 1.6,
      size: { side: 'buy', entry: 120, stopLoss: 90, riskBudget: 3000, lotSize: 65 } });
    expect(r.statusCode).toBe(200);
    const { charges: c, size, brokerage } = r.json();
    expect(brokerage).toBe('Discount broker');
    expect([c.turnover, c.brokerage, c.stt, c.exchTxn, c.gst, c.sebi, c.stamp, c.total].map(paise)).toEqual([18850, 40, 17, 6.7, 8.41, 0.02, 0.23, 72.36]);
    expect([c.pointsToBreakeven, c.netPnl].map(paise)).toEqual([1.11, 3177.64]);
    expect([c.withSlippage.slippage, c.withSlippage.realCost, c.withSlippage.pointsToBreakeven, c.withSlippage.netPnl].map(paise)).toEqual([104, 176.36, 2.71, 3073.64]);
    expect(size.maxQty).toBe(65);
    expect(Math.round(size.lossAtStop)).toBe(2012);
  });

  it('the rate set in force on the trade date is used (STT change on 1 Apr 2026)', async () => {
    const before = (await calc({ segment: 'options', exchange: 'NSE', buy: 120, sell: 170, qty: 65, date: '2026-03-31' })).json();
    const after = (await calc({ segment: 'options', exchange: 'NSE', buy: 120, sell: 170, qty: 65, date: '2026-04-01' })).json();
    expect(before.rates.effective_from).toBe('2024-10-01');
    expect(before.charges.stt).toBe(Math.round(0.001 * 170 * 65));            // 11
    expect(after.charges.stt).toBe(17);
    expect((await calc({ segment: 'options', exchange: 'MCX', buy: 1, sell: 2, qty: 1 })).statusCode).toBe(404);
    expect((await calc({ segment: 'options', exchange: 'NSE', buy: 1, sell: 2, qty: 0 })).statusCode).toBe(400);
  });

  it('settings: defaults, save, read back; sign-in required', async () => {
    const u = await makeUser(x.t);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/desk/settings', headers: await as() })).statusCode).toBe(401);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/desk/settings', headers: await as(u) })).json()).toMatchObject({ risk_per_trade: null, adherence_target: 80, default_exchange: 'NSE' });
    const body = { risk_per_trade: 3000, max_daily_loss: 6000, max_trades_day: 3, brokerage_plan: 'Discount broker', default_exchange: 'NSE', avg_slippage_override: 1.6, adherence_target: 80 };
    expect((await x.app.inject({ method: 'PUT', url: '/api/v1/desk/settings', headers: await as(u), payload: body })).statusCode).toBe(200);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/desk/settings', headers: await as(u) })).json()).toMatchObject(body);
    expect((await x.app.inject({ method: 'PUT', url: '/api/v1/desk/settings', headers: await as(u), payload: { ...body, brokerage_plan: 'Nope' } })).statusCode).toBe(400);
    const other = await makeUser(x.t);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/desk/settings', headers: await as(other) })).json().risk_per_trade).toBeNull();   // per user
  });

  it('admin: only owner/admin edit reference data; every change is audited; rates are added, never overwritten', async () => {
    const owner = await makeUser(x.t, { role: 'owner' }), admin = await makeUser(x.t, { role: 'admin' }), support = await makeUser(x.t, { role: 'support' });
    const rate = { segment: 'options', exchange: 'NSE', effective_from: '2027-04-01', stt_buy: 0, stt_sell: 0.002, stt_exercise: 0.002, exch_txn: 0.0003553,
      sebi_per_crore: 10, stamp_buy: 0.00003, gst: 0.18, ipft_per_crore: 0, stt_round_rupee: true, source_note: 'Test circular 2027' };
    const post = async (who: string, url: string, payload: object) => x.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: await as(who), payload });
    expect((await post(support, '/admin/charge-rates', rate)).statusCode).toBe(403);
    expect((await post(admin, '/admin/charge-rates', rate)).statusCode).toBe(201);
    expect((await post(owner, '/admin/charge-rates', rate)).statusCode).toBe(409);
    expect((await calc({ segment: 'options', exchange: 'NSE', buy: 120, sell: 170, qty: 65, date: '2027-04-02' })).json().charges.stt).toBe(Math.round(0.002 * 170 * 65));
    expect((await calc({ segment: 'options', exchange: 'NSE', buy: 120, sell: 170, qty: 65, date: '2026-11-24' })).json().charges.stt).toBe(17);   // history kept
    expect((await post(owner, '/admin/brokerage-plans', { name: 'Full service', segment: 'options', flat_per_order: 50, pct: null, cap_per_order: null, is_default: true })).statusCode).toBe(200);
    const plans = (await x.app.inject({ method: 'GET', url: '/api/v1/desk/config' })).json().brokerage.filter((p: any) => p.segment === 'options');
    expect(plans.filter((p: any) => p.is_default).map((p: any) => p.name)).toEqual(['Full service']);
    expect((await post(owner, '/admin/market-calendar', { day: '2026-12-31', segment: 'equity', exchange: 'NSE', is_holiday: true, pre_open: null, open: null, close: null, note: 'Test closure' })).statusCode).toBe(200);
    const cal = (await x.app.inject({ method: 'GET', url: '/api/v1/admin/market-calendar?month=2026-12', headers: await as(owner) })).json().days;
    expect(cal.find((d: any) => d.day === '2026-12-31' && d.segment === 'equity' && d.exchange === 'NSE')).toMatchObject({ is_holiday: true, note: 'Test closure' });
    const actions = (await x.t.admin.query(`select action from audit_log where action like 'desk_%' order by id`)).rows.map((r) => r.action);
    expect(actions).toEqual(['desk_charge_rates_added', 'desk_brokerage_plan_saved', 'desk_market_calendar_set']);
  });
});
