/**
 * @file  apps/api/test/users-admin.test.ts
 * @area  Tests
 * @what  User management API: permissions, list + research statuses, "Request reports" rules and email, one-click consent link (single use, expiry), restrict ends sessions and sign-in, delete with typed email.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, ORIGIN, cookieFor, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('user management', () => {
  let x: TestApp, owner: string, admin: string;
  beforeAll(async () => {
    x = await testApp('t_api_users_admin');
    owner = await makeUser(x.t, { role: 'owner' }); admin = await makeUser(x.t, { role: 'admin' });
  });
  afterAll(async () => { await x?.close(); });

  const get = async (url: string, by: string) => x.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await as(by) });
  const post = async (url: string, by: string | null, payload: object = {}) =>
    x.app.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers: by ? await as(by) : { origin: ORIGIN } });
  const withReport = async (email?: string) => {
    const u = await makeUser(x.t, email ? { email } as any : {});
    await x.t.admin.query(`insert into reports (user_id, file_names, file_hashes, expires_at) values ($1, '{a.csv}', '{h}', 'infinity')`, [u]);
    return u;
  };
  const emailOf = async (u: string) => (await x.t.admin.query('select email from users where id = $1', [u])).rows[0].email as string;
  const row = async (u: string, by = owner) => (await get(`/admin/users?q=${encodeURIComponent(await emailOf(u))}`, by)).json().users[0];

  it('permissions: owner and admin list; support, finance, analyst and users cannot', async () => {
    expect((await get('/admin/users', owner)).statusCode).toBe(200);
    const a = (await get('/admin/users', admin)).json();
    expect(a.can).toEqual({ restrict: true, delete: false, invite: false });
    for (const role of ['support', 'finance', 'analyst'] as const) expect((await get('/admin/users', await makeUser(x.t, { role }))).statusCode).toBe(403);
    expect((await get('/admin/users', await makeUser(x.t))).statusCode).toBe(403);
    expect((await x.t.admin.query(`select count(*)::int n from audit_log where action = 'users_listed'`)).rows[0].n).toBeGreaterThan(0);
  });

  it('research statuses and the request rules', async () => {
    const noReports = await makeUser(x.t);
    expect(await row(noReports)).toMatchObject({ research: 'not_asked', canRequest: false, requestBlocked: 'No reports yet.', signIn: 'code' });
    const u = await withReport();
    expect(await row(u)).toMatchObject({ research: 'not_asked', canRequest: true, reports: 1 });
    expect((await row(u, admin)).canRequest).toBe(false);                                   // owner only
    expect((await post(`/admin/users/${u}/research-invite`, admin)).statusCode).toBe(403);

    const sent = await post(`/admin/users/${u}/research-invite`, owner);
    expect(sent.json()).toEqual({ sent: true });
    const mail = x.mail.at(-1)!;
    expect(mail.to).toBe(await emailOf(u));
    expect(mail.subject).toBe('Help us make PnL Lens better for traders like you');
    expect(mail.text).toMatch(/https:\/\/pnllens\.test\/research\/consent\?t=[A-Za-z0-9_-]{43}&choice=yes/);
    expect(await row(u)).toMatchObject({ research: 'asked', canRequest: false });
    expect((await post(`/admin/users/${u}/research-invite`, owner)).json()).toMatchObject({ error: 'not_allowed', message: 'Already asked; the link is still open.' });
    const stored = (await x.t.admin.query('select token_sha256 from research_invites where user_id = $1', [u])).rows[0].token_sha256;
    expect(mail.text).not.toContain(stored);                                                 // only the hash is stored
  });

  it('the email link: state, yes records consent → Included; single use; expired and invalid links', async () => {
    const u = await withReport();
    await post(`/admin/users/${u}/research-invite`, owner);
    const token = /\?t=([A-Za-z0-9_-]+)/.exec(x.mail.at(-1)!.text)![1];
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/research/invite/${token}` })).json()).toEqual({ state: 'open' });
    const yes = await post(`/research/invite/${token}`, null, { answer: 'yes' });
    expect(yes.json()).toEqual({ ok: true, answer: 'yes' });
    const c = (await x.t.admin.query(`select granted, policy_version, ip_hash from consents where user_id = $1 and purpose = 'research'`, [u])).rows;
    expect(c).toHaveLength(1); expect(c[0].granted).toBe(true); expect(c[0].policy_version).toBe('2026-10');
    expect(await row(u)).toMatchObject({ research: 'included' });
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/research/invite/${token}` })).json()).toEqual({ state: 'answered', answer: 'yes' });
    expect((await post(`/research/invite/${token}`, null, { answer: 'no' })).statusCode).toBe(409);
    expect((await post(`/research/invite/not-a-real-token-at-all-xxxxxxxx`, null, { answer: 'yes' })).statusCode).toBe(404);
    expect((await x.t.admin.query(`select count(*)::int n from audit_log where action = 'research_consent_via_email' and user_id = $1`, [u])).rows[0].n).toBe(1);

    const v = await withReport();
    await post(`/admin/users/${v}/research-invite`, owner);
    const t2 = /\?t=([A-Za-z0-9_-]+)/.exec(x.mail.at(-1)!.text)![1];
    await x.t.admin.query(`update research_invites set expires_at = now() - interval '1 minute' where user_id = $1`, [v]);
    expect((await post(`/research/invite/${t2}`, null, { answer: 'yes' })).statusCode).toBe(410);
    expect(await row(v)).toMatchObject({ research: 'not_asked', canRequest: false, requestBlocked: 'Asked less than 90 days ago.' });
  });

  it('no thanks records a refusal and blocks new requests for 6 months', async () => {
    const u = await withReport();
    await post(`/admin/users/${u}/research-invite`, owner);
    const token = /\?t=([A-Za-z0-9_-]+)/.exec(x.mail.at(-1)!.text)![1];
    expect((await post(`/research/invite/${token}`, null, { answer: 'no' })).json()).toEqual({ ok: true, answer: 'no' });
    await x.t.admin.query(`update research_invites set created_at = now() - interval '100 days' where user_id = $1`, [u]);
    expect(await row(u)).toMatchObject({ research: 'declined', canRequest: false, requestBlocked: 'Said no less than 6 months ago.' });
  });

  it('restrict signs the user out and blocks sign-in; unrestrict restores; admins cannot restrict owners', async () => {
    const u = await withReport();
    const cookie = await cookieFor(u);
    await new Promise((r) => setTimeout(r, 1100));                                     // the session predates the restriction
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await post(`/admin/users/${u}/restrict`, admin, { reason: '' })).json().error).toBe('reason_required');
    expect((await post(`/admin/users/${u}/restrict`, admin, { reason: 'Shared account' })).json()).toEqual({ ok: true });
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
    expect(await row(u)).toMatchObject({ status: 'blocked', restricted_reason: 'Shared account', canRequest: false });
    expect((await get('/admin/users?filter=restricted', owner)).json().users.map((r: any) => r.id)).toContain(u);
    expect((await post(`/admin/users/${u}/unrestrict`, owner)).json()).toEqual({ ok: true });
    expect((await row(u)).status).toBe('active');
    expect((await post(`/admin/users/${owner}/restrict`, admin, { reason: 'no' })).statusCode).toBe(403);
  });

  it('delete: owner only, typed email and a reason', async () => {
    const u = await withReport();
    const email = await emailOf(u);
    expect((await post(`/admin/users/${u}/delete`, admin, { reason: 'asked', confirmEmail: email })).statusCode).toBe(403);
    expect((await post(`/admin/users/${u}/delete`, owner, { reason: 'asked', confirmEmail: 'wrong@x.y' })).json().error).toBe('confirm_mismatch');
    expect((await post(`/admin/users/${u}/delete`, owner, { reason: '', confirmEmail: email })).json().error).toBe('reason_required');
    expect((await post(`/admin/users/${u}/delete`, owner, { reason: 'User asked by email', confirmEmail: email.toUpperCase() })).json()).toEqual({ deleted: true });
    expect((await get(`/admin/users?q=${encodeURIComponent(email)}`, owner)).json().users).toHaveLength(0);
    expect((await x.t.admin.query(`select count(*)::int n from reports where user_id = $1 and purged_at is null`, [u])).rows[0].n).toBe(0);
  });
});
