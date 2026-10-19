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
});
