/**
 * @file  apps/api/test/password.test.ts
 * @area  Tests
 * @what  Email + password sign-in: start → code for new emails, required password after the first code, password login, lockout, forgot, change needs a fresh sign-in, other devices signed out, no hash leaks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SignJWT } from 'jose';
import { testDbAvailable } from '@pnl-lens/db/testing';
import { testApp, ORIGIN, type TestApp } from './helpers.js';

const ok = await testDbAvailable();
const PW = 'green-lamp-27', PW2 = 'blue-river-58';

describe.skipIf(!ok)('email + password sign-in', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_password'); });
  afterAll(async () => { await x?.close(); });

  const post = (url: string, payload: unknown, cookie?: string) =>
    x.app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as any, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
  const me = (cookie: string) => x.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  const cookieOf = (r: { headers: Record<string, any> }) => String(r.headers['set-cookie']).split(';')[0];
  const lastCode = (email: string) => { const m = [...x.mail].reverse().find((e) => e.to === email)!; return m.subject.slice(0, 6); };
  /** A token for this user issued `ago` seconds in the past (an older device, or a stale session). */
  const oldToken = async (id: string, ago: number) => `lens_session=${await new SignJWT({ country: 'IN' }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
    .setIssuedAt(Math.floor(Date.now() / 1000) - ago).setExpirationTime('1d').sign(new TextEncoder().encode(process.env.SESSION_SECRET!))}`;

  async function codeSignIn(email: string) {
    const v = await post('/auth/otp/verify', { email, code: lastCode(email) });
    expect(v.statusCode).toBe(200);
    return { cookie: cookieOf(v), body: v.json() };
  }

  it('a new email gets a code; after it the account must set a password; then password sign-in works', async () => {
    const email = 'new.trader@t.local';
    const s = await post('/auth/start', { email });
    expect(s.json()).toEqual({ method: 'code', sent: true, masked: expect.stringMatching(/^n\*+@t\.local$/) });
    const { cookie, body } = await codeSignIn(email);
    expect(body).toEqual({ ok: true, needsPassword: true });
    expect((await me(cookie)).json()).toMatchObject({ hasPassword: false, needsPassword: true });

    expect((await post('/auth/password/set', { password: 'short' }, cookie)).json()).toEqual({ error: 'weak_password', message: 'Use at least 8 characters.' });
    expect((await post('/auth/password/set', { password: 'new.trader' }, cookie)).json().message).toMatch(/too easy/);
    const set = await post('/auth/password/set', { password: PW }, cookie);
    expect(set.statusCode).toBe(200);
    const m = (await me(cookieOf(set))).json();
    expect(m).toMatchObject({ hasPassword: true, needsPassword: false });
    expect(JSON.stringify(m)).not.toMatch(/scrypt|password_hash/);

    const mails = x.mail.length;
    expect((await post('/auth/start', { email: 'NEW.Trader@t.local' })).json()).toEqual({ method: 'password' });
    expect(x.mail.length).toBe(mails);                                           // no code sent
    const login = await post('/auth/password/login', { email, password: PW });
    expect(login.statusCode).toBe(200);
    expect(String(login.headers['set-cookie'])).toMatch(/lens_session=.*HttpOnly/i);
    expect((await me(cookieOf(login))).json().hasPassword).toBe(true);
    const stored = (await x.t.admin.query(`select password_hash from users where email = $1`, [email])).rows[0].password_hash;
    expect(stored).toMatch(/^scrypt\$/); expect(stored).not.toContain(PW);
  });

  it('wrong password: one generic message for wrong password and unknown email; 10 failures lock password sign-in', async () => {
    const email = 'lock.me@t.local';
    await post('/auth/start', { email }); const { cookie } = await codeSignIn(email);
    await post('/auth/password/set', { password: PW }, cookie);
    const wrong = await post('/auth/password/login', { email, password: 'not-the-one' });
    const unknown = await post('/auth/password/login', { email: 'nobody@t.local', password: 'not-the-one' });
    expect(wrong.statusCode).toBe(401); expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().message).toBe('That email and password don’t match.');
    for (let i = 0; i < 9; i++) await post('/auth/password/login', { email, password: 'not-the-one' });
    const locked = await post('/auth/password/login', { email, password: PW });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().message).toMatch(/Forgot password/);
    const audit = await x.t.admin.query(`select count(*)::int n from audit_log a join users u on u.id = a.user_id where u.email = $1 and a.action = 'password_failed'`, [email]);
    expect(audit.rows[0].n).toBe(10);
  });

  it('forgot password: same answer for unknown emails (no account created); code then new password; old password and other devices stop working', async () => {
    const email = 'forgot.me@t.local';
    await post('/auth/start', { email }); const first = await codeSignIn(email);
    await post('/auth/password/set', { password: PW }, first.cookie);
    const userId = (await x.t.admin.query('select id from users where email = $1', [email])).rows[0].id;
    await x.t.admin.query(`update users set sessions_valid_after = now() - interval '10 minutes' where id = $1`, [userId]);  // password set a while ago
    const otherDevice = await oldToken(userId, 120);                               // a phone signed in after that
    expect((await me(otherDevice)).statusCode).toBe(200);

    const unknown = await post('/auth/password/forgot', { email: 'ghost@t.local' });
    expect(unknown.json()).toEqual({ sent: true, masked: expect.any(String) });
    expect((await x.t.admin.query(`select count(*)::int n from users where email = 'ghost@t.local'`)).rows[0].n).toBe(0);

    expect((await post('/auth/password/forgot', { email })).json()).toEqual({ sent: true, masked: expect.any(String) });
    const reset = await codeSignIn(email);
    expect(reset.body.needsPassword).toBe(false);
    const changed = await post('/auth/password/set', { password: PW2 }, reset.cookie);
    expect(changed.statusCode).toBe(200);
    expect((await me(cookieOf(changed))).statusCode).toBe(200);                    // this device stays signed in
    expect((await me(otherDevice)).statusCode).toBe(401);                          // the other device is signed out
    expect((await post('/auth/password/login', { email, password: PW })).statusCode).toBe(401);
    expect((await post('/auth/password/login', { email, password: PW2 })).statusCode).toBe(200);
  });

  it('a database clock ahead of the API clock does not end the fresh session after setting a password', async () => {
    const email = 'skew@t.local';
    await post('/auth/start', { email }); const { cookie } = await codeSignIn(email);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 5000);                                          // the API clock runs 5 s behind the database
    try {
      const set = await post('/auth/password/set', { password: PW }, cookie);
      expect(set.statusCode).toBe(200);
      expect((await me(cookieOf(set))).statusCode).toBe(200);                       // the new session stays valid
    } finally { vi.useRealTimers(); }
  });

  it('changing an existing password needs a recent sign-in', async () => {
    const email = 'stale@t.local';
    await post('/auth/start', { email }); const { cookie } = await codeSignIn(email);
    await post('/auth/password/set', { password: PW }, cookie);
    const userId = (await x.t.admin.query('select id from users where email = $1', [email])).rows[0].id;
    const stale = await oldToken(userId, 3600);
    await x.t.admin.query('update users set sessions_valid_after = null where id = $1', [userId]);
    const r = await post('/auth/password/set', { password: PW2 }, stale);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('reauth_required');
    expect((await post('/auth/password/set', { password: PW2 })).statusCode).toBe(401);
  });

  it('deleting the account clears the password', async () => {
    const email = 'leaving@t.local';
    await post('/auth/start', { email }); const { cookie } = await codeSignIn(email);
    const set = await post('/auth/password/set', { password: PW }, cookie);
    expect((await post('/me/delete', { confirm: true }, cookieOf(set))).statusCode).toBe(200);
    const row = (await x.t.admin.query(`select password_hash, sessions_valid_after from users where email like 'deleted+%' order by created_at desc limit 1`)).rows[0];
    expect(row.password_hash).toBeNull(); expect(row.sessions_valid_after).not.toBeNull();
  });
});
