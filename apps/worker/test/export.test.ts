/**
 * @file  apps/worker/test/export.test.ts
 * @area  Tests
 * @what  "Export my data" on a real database: complete archive (JSON + original statements), encrypted at rest, access logged, expires after 7 days.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testDbAvailable, freshDb, makeUser, givePlan, asRole, expectPgError, type TestDb } from '@pnl-lens/db/testing';
import { createReportFromAnalysis, requestData } from '@pnl-lens/db';
import { decryptFile } from '@pnl-lens/shared/file-crypto';
import { processAnalysis } from '../src/pipeline.js';
import { processExport, sweepExports } from '../src/export.js';
import { buildZip } from '../src/zip.js';
import { harness, uploadFiles, fixture, KEK, type Harness } from './helpers.js';

const ok = await testDbAvailable();
/** Reads the archive with Python's zipfile (an independent, standard reader that honours the UTF-8 name flag). */
const PY = `import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
if len(sys.argv) > 2: sys.stdout.buffer.write(z.read(sys.argv[2]))
else: sys.stdout.write("\\n".join(z.namelist()) + "\\n")`;
const unzip = (zip: Buffer, member?: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-zip-')), p = path.join(dir, 'a.zip'), py = path.join(dir, 'read.py');
  fs.writeFileSync(p, zip); fs.writeFileSync(py, PY);
  const r = spawnSync('python3', ['-I', py, p, ...(member ? [member] : [])], { maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout as Buffer;
};

describe('zip writer', () => {
  it('produces an archive standard tools can read (UTF-8 names, deflate)', () => {
    const z = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'statements/₹ report.csv', data: Buffer.from('x,y\n1,2\n'.repeat(1000)) }]);
    expect(unzip(z).toString().trim().split('\n')).toEqual(['a.txt', 'statements/₹ report.csv']);
    expect(unzip(z, 'a.txt').toString()).toBe('hello');
  });
});

describe.skipIf(!ok)('export my data', () => {
  let t: TestDb, h: Harness, exports: Map<string, Buffer>;
  beforeAll(async () => {
    t = await freshDb('t_worker_export');
    h = harness(t);
    exports = new Map();
    h.deps.storage = { ...h.deps.storage, putExport: async (k, b) => { exports.set(k, b); }, deleteExport: async (k) => { exports.delete(k); } };
  });
  afterAll(async () => { await t?.close(); });
  const deps = () => ({ db: t.worker, storage: h.deps.storage, keks: h.deps.keks, currentKek: KEK });

  it('builds a complete, encrypted archive: all data as JSON plus the original statements still stored', async () => {
    const u = await makeUser(t);
    await givePlan(t, u);
    const { analysisId } = await uploadFiles(t, h, u, [fixture('zerodha_tradebook.csv'), fixture('groww_pnl.csv')]);
    await processAnalysis(h.deps, analysisId);
    const report = await createReportFromAnalysis(t.app, u, analysisId, 'March');
    await t.admin.query(`insert into consents (user_id, purpose, granted, policy_version, text_sha256) values ($1, 'processing', true, '2026-10', repeat('a', 64))`, [u]);
    const req = await requestData(t.app, u, 'export');

    expect(await processExport(deps(), req.id, 'job-x')).toBe('done');
    const row = (await t.admin.query('select * from data_requests where id = $1', [req.id])).rows[0];
    expect(row.status).toBe('done');
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400e3);
    const stored = exports.get(row.result_key)!;
    expect(stored.includes(Buffer.from('pnl-lens-data.json'))).toBe(false);          // encrypted at rest
    const zip = decryptFile(stored, row.iv, row.wrapped_dek, KEK);
    expect(Number(row.size_bytes)).toBe(zip.length);

    expect(unzip(zip).toString().trim().split('\n')).toEqual(['README.txt', 'pnl-lens-data.json', 'statements/groww_pnl.csv', 'statements/zerodha_tradebook.csv']);
    expect(unzip(zip, 'statements/zerodha_tradebook.csv').equals(fixture('zerodha_tradebook.csv').bytes)).toBe(true);
    const data = JSON.parse(unzip(zip, 'pnl-lens-data.json').toString());
    expect(data.format).toBe('pnl-lens-export/1');
    expect(data.account.email).toMatch(/@t\.local$/);
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0]).toMatchObject({ id: report, title: 'March', positions: 101 });
    expect(data.reports[0].trades).toHaveLength(101);
    expect(data.reports[0].metrics.n).toBe(101);
    expect(data.statements).toHaveLength(2);
    expect(data.consents).toEqual([expect.objectContaining({ purpose: 'processing', granted: true })]);
    expect(data.plans[0]).toMatchObject({ plan: 'snapshot', source: 'granted by PnL Lens' });
    const text = JSON.stringify(data);
    for (const secret of ['wrapped_dek', 'code_hash', 'storage_key', 'raw_payload', 'enc_key_id']) expect(text).not.toContain(secret);

    const log = (await t.admin.query(`select action from file_access_log where reason = 'data_export' and owner_user_id = $1 order by id`, [u])).rows.map((r) => r.action);
    expect(log).toEqual(['read', 'decrypt', 'read', 'decrypt']);
    expect(await processExport(deps(), req.id)).toBe('skipped');                      // idempotent

    // 7 days later the archive and its key are removed; the request stays as a record
    await t.admin.query(`update data_requests set expires_at = now() - interval '1 minute' where id = $1`, [req.id]);
    expect(await sweepExports(t.worker, h.deps.storage)).toBe(1);
    expect(exports.size).toBe(0);
    expect((await t.admin.query('select status, result_key, wrapped_dek from data_requests where id = $1', [req.id])).rows[0]).toEqual({ status: 'done', result_key: null, wrapped_dek: null });
  });

  it('export_user_data only works for an export in progress, and only for the worker', async () => {
    const u = await makeUser(t);
    const pending = await requestData(t.app, u, 'export');
    await expectPgError(asRole(t, 'lens_worker', 'select export_user_data($1)', [pending.id]), 'P0001');    // not processing yet
    const del = await requestData(t.app, u, 'delete');
    await t.admin.query(`update data_requests set status = 'processing' where id = $1`, [del.id]);
    await expectPgError(asRole(t, 'lens_worker', 'select export_user_data($1)', [del.id]), 'P0001');
    await expectPgError(asRole(t, 'lens_app', 'select export_user_data($1)', [pending.id]), '42501');
  });
});
