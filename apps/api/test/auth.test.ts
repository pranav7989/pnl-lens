/**
 * @file  apps/api/test/auth.test.ts
 * @area  Tests
 * @what  Sign-in (email code), session cookie, /me, /plans, CSRF origin check, consents, export and account deletion, health/ready — on real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan } from '@pnl-lens/db/testing';
import { testApp, as, ORIGIN, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('auth, me and privacy routes', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_auth'); });
  afterAll(async () => { await x?.close(); });
  const post = (url: string, payload: unknown, headers: Record<string, string> = { origin: ORIGIN }) => x.app.inject({ method: 'POST', url, payload: payload as any, headers });

  it('email code: request -> mail -> verify sets a secure httpOnly session cookie that /me accepts', async () => {
    const email = `u${Date.now()}@t.local`;
    const r1 = await post('/api/v1/auth/otp/request', { email });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ sent: true, masked: expect.stringMatching(/^u\*+@t\.local$/) });
    const code = x.mail.at(-1)!.subject.slice(0, 6);
    expect(code).toMatch(/^\d{6}$/);

    expect((await post('/api/v1/auth/otp/verify', { email, code: code === '000000' ? '111111' : '000000' })).json())
      .toEqual({ error: 'invalid_code', message: 'That code is wrong or has expired.' });
    const r2 = await post('/api/v1/auth/otp/verify', { email, code });
    expect(r2.statusCode).toBe(200);
    const set = String(r2.headers['set-cookie']);
    expect(set).toMatch(/lens_session=/); expect(set).toMatch(/HttpOnly/i); expect(set).toMatch(/Secure/i); expect(set).toMatch(/SameSite=Lax/i);
    const cookie = set.split(';')[0];
    const me = await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { id: expect.any(String) }, credits: 0 });
    // a used code cannot be used again
    expect((await post('/api/v1/auth/otp/verify', { email, code })).statusCode).toBe(401);
  });

  it('keeps the old validation messages and rate limits', async () => {
    expect((await post('/api/v1/auth/otp/request', { email: 'nope' })).json()).toEqual({ error: 'invalid_email', message: 'Enter a valid email address.' });
    expect((await post('/api/v1/auth/otp/request', {})).json()).toEqual({ error: 'invalid_email', message: 'Enter a valid email address.' });
    expect((await post('/api/v1/auth/otp/verify', { email: 'a@b.co', code: '12' })).json()).toEqual({ error: 'invalid_input', message: 'Enter the 6-digit code from the email.' });
    const email = `rl${Date.now()}@t.local`;
    for (let i = 0; i < 5; i++) expect((await post('/api/v1/auth/otp/request', { email })).statusCode).toBe(200);
    expect((await post('/api/v1/auth/otp/request', { email })).json()).toEqual({ error: 'rate_limited', message: 'Too many codes requested. Try again in an hour.' });
  });

  it('five wrong codes lock the code', async () => {
    const email = `wr${Date.now()}@t.local`;
    await post('/api/v1/auth/otp/request', { email });
    const real = x.mail.at(-1)!.subject.slice(0, 6), wrong = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 4; i++) await post('/api/v1/auth/otp/verify', { email, code: wrong });
    expect((await post('/api/v1/auth/otp/verify', { email, code: wrong })).json().message).toBe('Too many wrong attempts. Request a new code.');
    expect((await post('/api/v1/auth/otp/verify', { email, code: real })).statusCode).toBe(401);
  });

  it('a blocked user cannot sign in', async () => {
    const email = `bl${Date.now()}@t.local`;
    const id = await makeUser(x.t, { email });
    await x.t.admin.query(`update users set status = 'blocked' where id = $1`, [id]);
    expect((await post('/api/v1/auth/otp/request', { email })).json()).toMatchObject({ sent: true });   // does not reveal
    expect(x.mail.filter((m) => m.to === email)).toHaveLength(0);
  });

  it('protected routes need a session: 401 with the old body', async () => {
    const r = await x.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'unauthenticated', message: 'Sign in to continue.' });
    const forged = await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: 'lens_session=eyJhbGciOiJIUzI1NiJ9.e30.x' } });
    expect(forged.statusCode).toBe(401);
  });

  it('CSRF: a state-changing request from another site (or with no Origin) is refused', async () => {
    const u = await makeUser(x.t);
    const h = await as(u);
    const evil = await x.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: { ...h, origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toBe('csrf');
    const none = await x.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: { cookie: h.cookie } });
    expect(none.statusCode).toBe(403);
    const viaReferer = await x.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: { cookie: h.cookie, referer: `${ORIGIN}/dashboard` } });
    expect(viaReferer.statusCode).toBe(202);
  });

  it('GET /plans: server-side prices by country, and my plans when signed in', async () => {
    const anon = await x.app.inject({ method: 'GET', url: '/api/v1/plans', headers: { 'cf-ipcountry': 'IN' } });
    expect(anon.json().plans.map((p: any) => p.price.currency)).toEqual(['INR', 'INR', 'INR', 'INR']);
    expect(anon.json().mine).toBeNull();
    const us = await x.app.inject({ method: 'GET', url: '/api/v1/plans', headers: { 'cf-ipcountry': 'US' } });
    expect(us.json().plans[0].price.currency).toBe('USD');
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 5 });
    const mine = await x.app.inject({ method: 'GET', url: '/api/v1/plans', headers: await as(u) });
    expect(mine.json().mine).toHaveLength(1);
    expect(mine.json().mine[0]).toMatchObject({ reportsTotal: 5, reportsUsed: 0, active: true });
  });

  it('research consent: off by default, opt in, withdraw (append-only)', async () => {
    const u = await makeUser(x.t);
    const h = await as(u);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/me/consents', headers: h })).json()).toMatchObject({ processing: false, research: false });
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/me/consents', headers: h, payload: { purpose: 'research', granted: true } })).json()).toEqual({ processing: false, research: true });
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/me/consents', headers: h, payload: { purpose: 'research', granted: false } })).json()).toEqual({ processing: false, research: false });
    const rows = (await x.t.admin.query('select ip_hash from consents where user_id = $1', [u])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);                                  // HMAC, never the raw IP
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/me/consents', headers: h, payload: { purpose: 'processing', granted: false } })).statusCode).toBe(400);
  });

  it('export request is accepted once; account deletion needs confirmation, then removes data and the cookie', async () => {
    const u = await makeUser(x.t);
    const h = await as(u);
    const e1 = await x.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: h });
    const e2 = await x.app.inject({ method: 'POST', url: '/api/v1/me/export', headers: h });
    expect(e1.statusCode).toBe(202);
    expect(e2.json().request.id).toBe(e1.json().request.id);

    expect((await x.app.inject({ method: 'POST', url: '/api/v1/me/delete', headers: h, payload: {} })).json().error).toBe('confirm_required');
    const del = await x.app.inject({ method: 'DELETE', url: '/api/v1/me', headers: h, payload: { confirm: true } });
    expect(del.statusCode).toBe(200);
    expect(String(del.headers['set-cookie'])).toMatch(/lens_session=;/);
    expect((await x.t.admin.query('select status, email from users where id = $1', [u])).rows[0]).toMatchObject({ status: 'deleted', email: `deleted+${u}@deleted.invalid` });
  });

  it('health and readiness (DB role checked)', async () => {
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/health' })).json()).toEqual({ ok: true });
    const r = await x.app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(r.json().checks).toMatchObject({ db: 'ok', storage: 'ok', redis: 'not_configured' });
  });

  it('logout clears the cookie', async () => {
    const r = await post('/api/v1/auth/logout', {});
    expect(r.json()).toEqual({ ok: true });
    expect(String(r.headers['set-cookie'])).toMatch(/lens_session=;/);
  });
});
