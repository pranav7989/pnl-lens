/**
 * @file  apps/api/test/research.test.ts
 * @area  Tests
 * @what  Research dataset routes: owner only (403 for admin, support, finance, analyst, user), Build now (one at a time), download decrypts and is audited, expired → 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { encryptFile } from '@pnl-lens/shared/file-crypto';
import { testApp, as, KEK, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('research datasets (admin)', () => {
  let x: TestApp, owner: string;
  beforeAll(async () => { x = await testApp('t_api_research'); owner = await makeUser(x.t, { role: 'owner' }); });
  afterAll(async () => { await x?.close(); });
  const get = async (url: string, by: string) => x.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await as(by) });
  const post = async (url: string, by: string) => x.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: await as(by), payload: {} });

  it('only the owner: everyone else gets 403', async () => {
    for (const role of ['admin', 'support', 'finance', 'analyst'] as const) {
      const u = await makeUser(x.t, { role });
      expect((await get('/admin/research/exports', u)).statusCode).toBe(403);
      expect((await post('/admin/research/exports', u)).statusCode).toBe(403);
    }
    expect((await get('/admin/research/exports', await makeUser(x.t))).statusCode).toBe(403);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/admin/research/exports' })).statusCode).toBe(401);
  });

  it('Build now queues one build at a time and is audited', async () => {
    const r = await post('/admin/research/exports', owner);
    expect(r.statusCode).toBe(202);
    expect(x.queue.research).toContain(r.json().id);
    expect((await post('/admin/research/exports', owner)).statusCode).toBe(409);
    const list = (await get('/admin/research/exports', owner)).json();
    expect(list.exports[0]).toMatchObject({ id: r.json().id, status: 'pending', scheduled: false, downloadable: false });
    expect(typeof list.optedIn).toBe('number');
    expect((await x.t.admin.query(`select count(*)::int n from audit_log where action = 'research_export_requested'`)).rows[0].n).toBe(1);
    await x.t.admin.query(`update research_exports set status = 'failed' where id = $1`, [r.json().id]);
  });

  it('download: decrypts the ZIP, no-store, audited; expired or missing → 404', async () => {
    const zip = Buffer.from('PK fake zip for the test');
    const enc = encryptFile(zip, KEK);
    x.storage.exports.set('research/test', enc.body);
    const id = (await x.t.admin.query(`insert into research_exports (status, storage_key, enc_key_id, wrapped_dek, iv, size_bytes, subjects, reports, trades, expires_at)
      values ('ready', 'research/test', $1, $2, $3, $4, 1, 1, 10, now() + interval '90 days') returning id`, [enc.encKeyId, enc.wrappedDek, enc.iv, zip.length])).rows[0].id;
    const d = await get(`/admin/research/exports/${id}/download`, owner);
    expect(d.statusCode).toBe(200);
    expect(d.rawPayload.equals(zip)).toBe(true);
    expect(d.headers['cache-control']).toBe('no-store');
    expect(d.headers['content-disposition']).toMatch(/pnl-lens-research-\d{4}-\d{2}-\d{2}\.zip/);
    expect((await x.t.admin.query(`select count(*)::int n from audit_log where action = 'research_export_downloaded'`)).rows[0].n).toBe(1);
    expect((await get(`/admin/research/exports/${id}/download`, await makeUser(x.t, { role: 'admin' }))).statusCode).toBe(403);

    await x.t.admin.query(`update research_exports set expires_at = now() - interval '1 minute' where id = $1`, [id]);
    expect((await get(`/admin/research/exports/${id}/download`, owner)).statusCode).toBe(404);
    expect((await get('/admin/research/exports/00000000-0000-0000-0000-000000000000/download', owner)).statusCode).toBe(404);
  });

  it('lookup: owner only; a subject or report code (with its dataset) resolves to the account; reasons required; audited', async () => {
    const lookup = async (by: string, payload: object) => x.app.inject({ method: 'POST', url: '/api/v1/admin/research/lookup', headers: await as(by), payload });
    const u = await makeUser(x.t);
    const email = (await x.t.admin.query('select email from users where id = $1', [u])).rows[0].email;
    const report = (await x.t.admin.query(`insert into reports (user_id, title, file_names, file_hashes, expires_at) values ($1, 'Q3', '{a.csv}', '{h}', 'infinity') returning id`, [u])).rows[0].id;
    const exp = (await x.t.admin.query(`insert into research_exports (status) values ('failed') returning id`)).rows[0].id;
    await x.t.admin.query(`insert into research_export_reports values ($1, $2, $3)`, [exp, 'ab'.repeat(12), report]);
    const subject = (await x.t.admin.query(`select encode(hmac(convert_to($1::text, 'UTF8'), k.key, 'sha256'), 'hex') s from research.pseudonym_key k`, [u])).rows[0].s;

    for (const role of ['admin', 'support'] as const) expect((await lookup(await makeUser(x.t, { role }), { code: subject, reason: 'test' })).statusCode).toBe(403);
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/admin/research/lookup', headers: await as(), payload: { code: subject, reason: 'x' } })).statusCode).toBe(401);
    expect((await lookup(owner, { code: subject, reason: '' })).json().error).toBe('reason_required');
    expect((await lookup(owner, { code: 'ab'.repeat(12), reason: 'ticket 4' })).json().error).toBe('export_required');
    expect((await lookup(owner, { code: 'nope', reason: 'ticket 4' })).json().error).toBe('invalid_code');

    const s = await lookup(owner, { code: subject, reason: 'ticket 4' });
    expect(s.json()).toEqual({ kind: 'subject', user: { id: u, email, status: 'active' }, report: null });
    const r = await lookup(owner, { code: 'ab'.repeat(12), exportId: exp, reason: 'consent withdrawal' });
    expect(r.json()).toMatchObject({ kind: 'report', user: { id: u, email }, report: { id: report, name: 'Q3', deleted: false } });
    expect((await lookup(owner, { code: 'c'.repeat(64), reason: 'ticket 4' })).statusCode).toBe(404);
    expect((await x.t.admin.query(`select count(*)::int n from audit_log where action = 'research_lookup' and user_id = $1`, [owner])).rows[0].n).toBe(3);
  });
});
