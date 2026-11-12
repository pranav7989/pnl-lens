/**
 * @file  apps/api/test/market-iq.test.ts
 * @area  Tests
 * @what  Market IQ access on the server: the flag (off/owner/paid), staff, India only, an open plan window; the status call sends the internal key and reports an unreachable service as 503.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, cookieFor, ORIGIN, type TestApp } from './helpers.js';
import { marketIqAccess, marketIqConfig } from '../src/lib/market-iq.js';

describe('marketIqAccess (pure rule)', () => {
  const r = (flag: 'off' | 'owner' | 'paid', role: string, country: string | null, plan: boolean) => marketIqAccess({ flag, role, country, hasActivePlan: plan });
  it('off hides it from everyone, staff included', () => {
    expect(r('off', 'owner', 'IN', true)).toBe('hidden');
  });
  it('owner: only owner and admin', () => {
    expect(r('owner', 'owner', 'US', false)).toBe('ok');
    expect(r('owner', 'admin', null, false)).toBe('ok');
    expect(r('owner', 'user', 'IN', true)).toBe('hidden');
    expect(r('owner', 'support', 'IN', true)).toBe('hidden');
  });
  it('paid: India users with an open plan; without a plan an upgrade, outside India hidden', () => {
    expect(r('paid', 'user', 'IN', true)).toBe('ok');
    expect(r('paid', 'user', 'IN', false)).toBe('no_plan');
    expect(r('paid', 'user', 'US', true)).toBe('hidden');
    expect(r('paid', 'user', null, true)).toBe('hidden');
  });
  it('config: unknown or missing flag means owner', () => {
    expect(marketIqConfig({}).access).toBe('owner');
    expect(marketIqConfig({ MARKET_IQ_ACCESS: 'PAID', MARKETIQ_URL: 'http://m:8000/', MARKETIQ_INTERNAL_KEY: 'k' })).toEqual({ access: 'paid', url: 'http://m:8000', key: 'k' });
    expect(marketIqConfig({ MARKET_IQ_ACCESS: 'everyone' }).access).toBe('owner');
  });
});

const dbOk = await testDbAvailable();

describe.skipIf(!dbOk)('market-iq routes', () => {
  let x: TestApp; let svc: http.Server; let seenKey: string | undefined; let svcUrl = '';
  const KEY = 'k'.repeat(40);                                       // fake shared key for the fake service
  beforeAll(async () => {
    x = await testApp('t_api_market_iq');
    svc = http.createServer((req, res) => {
      seenKey = req.headers['x-internal-key'] as string | undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ token: { state: 'ok' }, market: { session: 'open' } }));
    });
    await new Promise<void>((done) => svc.listen(0, '127.0.0.1', done));
    svcUrl = `http://127.0.0.1:${(svc.address() as AddressInfo).port}`;
  });
  afterAll(async () => { svc?.close(); await x?.close(); });
  const setFlag = (access: 'off' | 'owner' | 'paid', url = svcUrl) => { x.app.deps.config.marketIq = { url, key: KEY, access }; };
  const get = async (path: string, userId?: string, country: string | null = 'IN') =>
    x.app.inject({ method: 'GET', url: `/api/v1/market-iq/${path}`, headers: userId ? { origin: ORIGIN, cookie: await cookieFor(userId, country) } : await as() });
  const plan = (u: string, endsInDays = 30) => x.t.admin.query(
    `insert into subscriptions (user_id, plan_id, reports_total, files_per_report, starts_at, ends_at, grant_reason)
     values ($1, 'snapshot', 5, 3, now() - interval '1 day', now() + make_interval(days => $2), 'test')`, [u, endsInDays]);

  it('needs sign-in', async () => {
    setFlag('owner');
    expect((await get('access')).statusCode).toBe(401);
    expect((await get('status')).statusCode).toBe(401);
  });

  it('flag owner: the owner sees it and the status comes from the service with the key; a paid user does not', async () => {
    setFlag('owner');
    const owner = await makeUser(x.t, { role: 'owner' }), paid = await makeUser(x.t);
    await plan(paid);
    expect((await get('access', owner)).json()).toEqual({ access: true, reason: 'ok' });
    const s = await get('status', owner);
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ fresh: true, token: { state: 'ok' } });
    expect(seenKey).toBe(KEY);
    expect((await get('access', paid)).json()).toEqual({ access: false, reason: 'hidden' });
    expect((await get('status', paid)).statusCode).toBe(404);
  });

  it('flag paid: India + open plan → ok; no plan → upgrade (403); expired plan → upgrade; outside India → hidden', async () => {
    setFlag('paid');
    const withPlan = await makeUser(x.t), noPlan = await makeUser(x.t), expired = await makeUser(x.t), abroad = await makeUser(x.t);
    await plan(withPlan); await plan(expired, -1);
    await x.t.admin.query(`update users set country = 'US' where id = $1`, [abroad]); await plan(abroad);
    expect((await get('access', withPlan)).json()).toEqual({ access: true, reason: 'ok' });
    expect((await get('status', withPlan)).statusCode).toBe(200);
    expect((await get('access', noPlan)).json()).toEqual({ access: false, reason: 'no_plan' });
    expect((await get('status', noPlan)).json().error).toBe('plan_required');
    expect((await get('access', expired)).json().reason).toBe('no_plan');
    expect((await get('access', abroad)).json()).toEqual({ access: false, reason: 'hidden' });
  });

  it('flag off hides it from the owner too; an unreachable service is a 503, never a crash', async () => {
    const owner = await makeUser(x.t, { role: 'owner' });
    setFlag('off');
    expect((await get('access', owner)).json().access).toBe(false);
    setFlag('owner', 'http://127.0.0.1:9');                          // nothing listens on port 9
    const r = await get('status', owner);
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe('unavailable');
  });
});
