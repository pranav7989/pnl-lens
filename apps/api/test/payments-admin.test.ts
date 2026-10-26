/**
 * @file  apps/api/test/payments-admin.test.ts
 * @area  Tests
 * @what  Payments (off mode, Checkout verify, webhook signature, replay idempotency, legacy path) and admin RBAC (tabs, roles, audit, owner-only grant).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, ORIGIN, type TestApp } from './helpers.js';
import { PLANS, planDays } from '@pnl-lens/shared/pricing';

const ok = await testDbAvailable();
const WH = 'whsec_test_secret', KEY = 'rzp_key_secret_test';
const sign = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex');

describe.skipIf(!ok)('payments', () => {
  let x: TestApp;
  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WH; process.env.RAZORPAY_KEY_SECRET = KEY;
    x = await testApp('t_api_payments');
  });
  afterAll(async () => { delete process.env.RAZORPAY_WEBHOOK_SECRET; delete process.env.RAZORPAY_KEY_SECRET; await x?.close(); });

  const order = async (userId: string, planId = 'snapshot') => {
    const id = `order_${crypto.randomUUID().slice(0, 12)}`;
    await x.t.admin.query(`insert into payments (user_id, gateway_order_id, amount_minor, currency, plan_id) values ($1, $2, 49900, 'INR', $3)`, [userId, id, planId]);
    return id;
  };
  const webhook = (body: object, url = '/api/v1/payments/webhook', secret = WH) => {
    const raw = JSON.stringify(body);
    return x.app.inject({ method: 'POST', url, payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(secret, raw) } });
  };
  const captured = (orderId: string) => ({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${orderId}`, order_id: orderId } } } });

  it('a purchase started from the journey records upgrade_from_journey once (REQ-2)', async () => {
    const u = await makeUser(x.t);
    const id = await order(u, 'snapshot');
    const body = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_${id}`, order_id: id, notes: { plan: 'snapshot', user: u, source: 'journey' } } } } };
    expect((await webhook(body)).statusCode).toBe(200);
    expect((await webhook(body)).statusCode).toBe(200);                 // replay: no second plan, no second event
    const ev = (await x.t.admin.query(`select user_id, props from events where name = 'upgrade_from_journey' and user_id = $1`, [u])).rows;
    expect(ev).toEqual([{ user_id: u, props: { plan: 'snapshot' } }]);
    const plain = await makeUser(x.t), id2 = await order(plain, 'snapshot');
    expect((await webhook(captured(id2))).statusCode).toBe(200);
    expect((await x.t.admin.query(`select count(*)::int as n from events where name = 'upgrade_from_journey' and user_id = $1`, [plain])).rows[0].n).toBe(0);
  });

  it('config says off; ordering while off gives the old 503', async () => {
    const cfg = await x.app.inject({ method: 'GET', url: '/api/v1/payments/config', headers: { 'cf-ipcountry': 'IN' } });
    expect(cfg.json()).toMatchObject({ mode: 'off', support: 'support@pnllens.com' });
    expect(cfg.json().plans).toHaveLength(4);
    const u = await makeUser(x.t);
    const r = await x.app.inject({ method: 'POST', url: '/api/v1/payments/order', headers: await as(u), payload: { planId: 'snapshot' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe('payments_off');
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/payments/order', headers: await as(u), payload: { planId: 'gold' } })).json().error).toBe('bad_plan');
  });

  it('webhook: bad signature 401; valid capture grants the plan from PLANS; a replay changes nothing', async () => {
    const u = await makeUser(x.t);
    const id = await order(u);
    expect((await webhook(captured(id), undefined, 'wrong-secret')).statusCode).toBe(401);
    const r1 = await webhook(captured(id));
    expect([r1.statusCode, r1.body]).toEqual([200, 'ok']);
    const r2 = await webhook(captured(id));
    expect(r2.statusCode).toBe(200);
    const subs = (await x.t.admin.query('select plan_id, reports_total, files_per_report from subscriptions where user_id = $1', [u])).rows;
    expect(subs).toEqual([{ plan_id: 'snapshot', reports_total: 5, files_per_report: 3 }]);
    expect((await x.t.admin.query('select balance from credits where user_id = $1', [u])).rows[0].balance).toBe(5);
    expect((await x.t.admin.query('select status from payments where gateway_order_id = $1', [id])).rows[0].status).toBe('paid');
  });

  it('the old webhook URL (/api/payments/webhook) still works, so the Razorpay dashboard needs no change', async () => {
    const u = await makeUser(x.t);
    const id = await order(u, 'single');
    expect((await webhook(captured(id), '/api/payments/webhook')).statusCode).toBe(200);
    expect((await x.t.admin.query('select plan_id from subscriptions where user_id = $1', [u])).rows).toEqual([{ plan_id: 'single' }]);
  });

  it('payment.failed marks the payment failed; the browser cannot grant a plan', async () => {
    const u = await makeUser(x.t);
    const id = await order(u);
    await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: id } } } });
    expect((await x.t.admin.query('select status from payments where gateway_order_id = $1', [id])).rows[0].status).toBe('failed');
    // Checkout verify only marks "authorized"; no plan without the webhook
    const id2 = await order(u);
    const v = await x.app.inject({ method: 'POST', url: '/api/v1/payments/verify', headers: await as(u),
      payload: { razorpay_order_id: id2, razorpay_payment_id: 'pay_2', razorpay_signature: sign(KEY, `${id2}|pay_2`) } });
    expect(v.json()).toMatchObject({ ok: true });
    expect((await x.t.admin.query('select status from payments where gateway_order_id = $1', [id2])).rows[0].status).toBe('authorized');
    expect((await x.t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [u])).rows[0].n).toBe(0);
    const bad = await x.app.inject({ method: 'POST', url: '/api/v1/payments/verify', headers: await as(u), payload: { razorpay_order_id: id2, razorpay_payment_id: 'pay_2', razorpay_signature: 'nope' } });
    expect(bad.json().error).toBe('bad_signature');
  });
});

describe.skipIf(!ok)('admin (RBAC)', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_admin'); });
  afterAll(async () => { await x?.close(); });
  const get = async (url: string, userId?: string) => x.app.inject({ method: 'GET', url, headers: await as(userId) });

  it('401 without a session, 403 for customers, per-tab permissions for staff', async () => {
    expect((await get('/api/v1/admin/metrics?tab=users')).statusCode).toBe(401);
    const user = await makeUser(x.t), finance = await makeUser(x.t, { role: 'finance' }), support = await makeUser(x.t, { role: 'support' }), analyst = await makeUser(x.t, { role: 'analyst' });
    expect((await get('/api/v1/admin/metrics?tab=users', user)).json()).toEqual({ error: 'forbidden' });
    expect((await get('/api/v1/admin/metrics?tab=finance', finance)).statusCode).toBe(200);
    expect((await get('/api/v1/admin/metrics?tab=users', finance)).statusCode).toBe(403);
    expect((await get('/api/v1/admin/metrics?tab=finance', support)).statusCode).toBe(403);
    expect((await get('/api/v1/admin/metrics?tab=errors', support)).statusCode).toBe(200);
    const a = (await get('/api/v1/admin/metrics?tab=users', analyst)).json();
    expect(a.recent).toEqual([]);                                                      // analysts see no personal data
    expect((await get('/api/v1/admin/metrics?tab=nope', analyst)).json().error).toBe('bad_tab');
  });

  it('every admin read of user data is audited', async () => {
    const support = await makeUser(x.t, { role: 'support' });
    const email = `look${Date.now()}@t.local`;
    await makeUser(x.t, { email });
    expect((await get(`/api/v1/admin/user?email=${email}`, support)).json().user.email).toBe(email);
    const audit = (await x.t.admin.query(`select action, meta from audit_log where user_id = $1 order by id`, [support])).rows;
    expect(audit.at(-1)).toEqual({ action: 'admin_user_lookup', meta: { email } });
  });

  it('roles: admins cannot make owners; nobody changes their own role', async () => {
    const owner = await makeUser(x.t, { role: 'owner' }), admin = await makeUser(x.t, { role: 'admin' });
    const email = `r${Date.now()}@t.local`;
    await makeUser(x.t, { email });
    const post = async (by: string, body: object) => x.app.inject({ method: 'POST', url: '/api/v1/admin/roles', headers: await as(by), payload: body });
    expect((await post(admin, { email, role: 'owner' })).statusCode).toBe(403);
    expect((await post(admin, { email, role: 'support' })).json()).toEqual({ ok: true });
    const adminEmail = (await x.t.admin.query('select email from users where id = $1', [admin])).rows[0].email;
    expect((await post(admin, { email: adminEmail, role: 'user' })).json().message).toBe('You can’t change your own role.');
    expect((await post(owner, { email, role: 'owner' })).json()).toEqual({ ok: true });
  });

  it('manual grant: owner only, reason required, plan values from PLANS, audited (D5)', async () => {
    const owner = await makeUser(x.t, { role: 'owner' }), admin = await makeUser(x.t, { role: 'admin' });
    const email = `g${Date.now()}@t.local`;
    const target = await makeUser(x.t, { email });
    const grant = async (by: string, body: object) => x.app.inject({ method: 'POST', url: '/api/v1/admin/grants', headers: await as(by), payload: body });
    expect((await grant(admin, { email, planId: 'progress', reason: 'Support case' })).statusCode).toBe(403);
    expect((await grant(owner, { email, planId: 'progress', reason: ' ' })).json().error).toBe('reason_required');
    const r = await grant(owner, { email, planId: 'progress', reason: 'Support case #7' });
    expect(r.statusCode).toBe(201);
    const s = (await x.t.admin.query('select plan_id, reports_total, files_per_report, granted_by, grant_reason from subscriptions where user_id = $1', [target])).rows;
    expect(s).toEqual([{ plan_id: 'progress', reports_total: 25, files_per_report: 3, granted_by: owner, grant_reason: 'Support case #7' }]);
    expect((await x.t.admin.query(`select count(*)::int as n from audit_log where action = 'plan_granted_manual' and user_id = $1`, [target])).rows[0].n).toBe(1);
  });

  it('grants run for each plan\'s length: 7 days, then 3, 6 and 12 calendar months from the grant (REQ-3, credits spec rule 4)', async () => {
    const owner = await makeUser(x.t, { role: 'owner' });
    for (const planId of ['single', 'snapshot', 'progress', 'discipline'] as const) {
      const days = planDays(PLANS.find((p) => p.id === planId)!);
      const email = `len-${planId}-${Date.now()}@t.local`;
      const target = await makeUser(x.t, { email });
      const r = await x.app.inject({ method: 'POST', url: '/api/v1/admin/grants', headers: await as(owner), payload: { email, planId, reason: 'Length check' } });
      expect(r.statusCode, planId).toBe(201);
      const d = (await x.t.admin.query(`select round(extract(epoch from ends_at - now()) / 86400)::int as d from subscriptions where user_id = $1`, [target])).rows[0].d;
      expect(d, planId).toBe(days);
    }
  });

  it('tickets: support updates status; unknown ticket 404', async () => {
    const support = await makeUser(x.t, { role: 'support' });
    const { rows } = await x.t.admin.query(`insert into support_tickets (email, subject) values ('a@t.local', 'Help') returning id`);
    const patch = async (body: object) => x.app.inject({ method: 'PATCH', url: '/api/v1/admin/tickets', headers: { ...(await as(support)), origin: ORIGIN }, payload: body });
    expect((await patch({ id: Number(rows[0].id), status: 'resolved' })).json()).toEqual({ ok: true });
    expect((await patch({ id: 999999, status: 'resolved' })).statusCode).toBe(404);
    expect((await patch({ id: Number(rows[0].id), status: 'bogus' })).statusCode).toBe(400);
  });
});
