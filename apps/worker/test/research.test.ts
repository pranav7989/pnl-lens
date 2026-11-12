/**
 * @file  apps/worker/test/research.test.ts
 * @area  Tests
 * @what  Research dataset: only opted-in users, encrypted at rest, 4 CSVs + README, no emails/names/file names/internal ids, per-export report pseudonyms, links kept for the owner's audited lookup, consent withdrawal, expiry sweep, worker role limits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testDbAvailable, freshDb, makeUser, givePlan, asRole, expectPgError, type TestDb } from '@pnl-lens/db/testing';
import { createReportFromAnalysis } from '@pnl-lens/db';
import { decryptFile } from '@pnl-lens/shared/file-crypto';
import { processAnalysis } from '../src/pipeline.js';
import { buildResearchExport, sweepResearch, toCsv } from '../src/research.js';
import { harness, uploadFiles, fixture, KEK, type Harness } from './helpers.js';

const ok = await testDbAvailable();
const PY = `import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))`;
const unzip = (zip: Buffer): Record<string, string> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-research-')), p = path.join(dir, 'a.zip'), py = path.join(dir, 'read.py');
  fs.writeFileSync(p, zip); fs.writeFileSync(py, PY);
  const r = spawnSync('python3', ['-I', py, p], { maxBuffer: 100 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return JSON.parse(String(r.stdout));
};
const csvRows = (text: string) => text.trim().split('\r\n').map((l) => l.split(','));

describe('toCsv', () => {
  it('quotes commas, quotes and newlines; neutralises formula-like text but not negative numbers', () => {
    const out = toCsv([{ a: 'x,y', b: 'say "hi"', c: '=SUM(A1)', d: '-12.5', e: null, f: new Date('2026-10-01T00:00:00Z'), g: { k: 1 } }], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(out).toBe('a,b,c,d,e,f,g\r\n"x,y","say ""hi""",\'=SUM(A1),-12.5,,2026-10-01T00:00:00.000Z,"{""k"":1}"\r\n');
  });
});

describe.skipIf(!ok)('research dataset', () => {
  let t: TestDb, h: Harness, store: Map<string, Buffer>;
  const ids: Record<string, { user: string; report: string; email: string }> = {};
  beforeAll(async () => {
    t = await freshDb('t_worker_research');
    h = harness(t);
    store = new Map();
    h.deps.storage = { ...h.deps.storage, putExport: async (k, b) => { store.set(k, b); }, deleteExport: async (k) => { store.delete(k); } };
    for (const [who, research] of [['yes', true], ['no', false]] as const) {
      const user = await makeUser(t);
      await givePlan(t, user);
      const { analysisId } = await uploadFiles(t, h, user, [fixture('zerodha_tradebook.csv')]);
      await processAnalysis(h.deps, analysisId);
      const report = await createReportFromAnalysis(t.app, user, analysisId, 'March');
      await t.admin.query(`insert into consents (user_id, purpose, granted, policy_version, text_sha256) values ($1, 'research', $2, '2026-10', repeat('a', 64))`, [user, research]);
      const email = (await t.admin.query('select email from users where id = $1', [user])).rows[0].email;
      ids[who] = { user, report, email };
    }
  });
  afterAll(async () => { await t?.close(); });
  const deps = () => ({ db: t.worker, storage: h.deps.storage, currentKek: KEK });
  const open = async (id: string) => {
    const row = (await t.admin.query('select * from research_exports where id = $1', [id])).rows[0];
    return { row, files: unzip(decryptFile(store.get(row.storage_key)!, row.iv, row.wrapped_dek, KEK)) };
  };

  it('only opted-in users; encrypted at rest; 4 CSVs + README; no personal data or internal ids', async () => {
    const r = await buildResearchExport(deps());
    expect(r.status).toBe('ready');
    const { row, files } = await open(r.id);
    expect(row).toMatchObject({ status: 'ready', subjects: 1, reports: 1, requested_by: null });
    expect(row.trades).toBeGreaterThan(0);
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(89 * 86400e3);
    expect(store.get(row.storage_key)!.includes(Buffer.from('subjects.csv'))).toBe(false);   // encrypted
    expect(Object.keys(files).sort()).toEqual(['README.md', 'habits.csv', 'reports.csv', 'subjects.csv', 'trades.csv']);
    expect(csvRows(files['subjects.csv'])).toHaveLength(2);
    expect(csvRows(files['trades.csv'])).toHaveLength(row.trades + 1);
    expect(files['trades.csv'].split('\r\n')[0]).toMatch(/^subject,report,/);

    const all = Object.values(files).join('\n');
    for (const who of ['yes', 'no']) {
      expect(all).not.toContain(ids[who].user);
      expect(all).not.toContain(ids[who].report);
      expect(all).not.toContain(ids[who].email);
    }
    expect(all).not.toMatch(/zerodha_tradebook\.csv|clientId|@/);
    // the non-consenting user's trades are absent: one subject in every file
    const subjects = new Set(['reports.csv', 'trades.csv', 'habits.csv'].flatMap((f) => csvRows(files[f]).slice(1).map((c) => c[0])));
    expect(subjects.size).toBe(1);
  });

  it('a trader who opted in but has no reports is left out and not counted', async () => {
    const lonely = await makeUser(t);
    await t.admin.query(`insert into consents (user_id, purpose, granted, policy_version, text_sha256) values ($1, 'research', true, '2026-10', repeat('a', 64))`, [lonely]);
    const { row, files } = await open((await buildResearchExport(deps())).id);
    expect(row.subjects).toBe(1);
    expect(csvRows(files['subjects.csv'])).toHaveLength(2);
    expect(files['subjects.csv'].trim().split('\r\n')[1].split(',')[0]).toBe(csvRows(files['reports.csv'])[1][0]);
  });

  it('report pseudonyms line up inside one dataset but differ between datasets; subject stays the same', async () => {
    const a = await open((await buildResearchExport(deps())).id), b = await open((await buildResearchExport(deps())).id);
    const reportsA = new Set(csvRows(a.files['trades.csv']).slice(1).map((c) => c[1]));
    expect(reportsA).toEqual(new Set(csvRows(a.files['reports.csv']).slice(1).map((c) => c[1])));
    const reportsB = new Set(csvRows(b.files['trades.csv']).slice(1).map((c) => c[1]));
    expect([...reportsA][0]).not.toBe([...reportsB][0]);
    expect(csvRows(a.files['subjects.csv'])[1][0]).toBe(csvRows(b.files['subjects.csv'])[1][0]);
  });

  it('the database keeps the link from each report code to its report; the owner can trace subject and report codes back (audited)', async () => {
    const { row, files } = await open((await buildResearchExport(deps())).id);
    const codes = new Set(['reports.csv', 'trades.csv', 'habits.csv'].flatMap((f) => csvRows(files[f]).slice(1).map((c) => c[1])));
    const links = (await t.admin.query('select report, report_id from research_export_reports where export_id = $1', [row.id])).rows;
    expect(new Set(links.map((l) => l.report))).toEqual(codes);
    expect(links.map((l) => l.report_id)).toEqual([ids.yes.report]);
    const owner = await makeUser(t, { role: 'owner' });
    const subject = csvRows(files['subjects.csv'])[1][0];
    const bySubject = (await t.admin.query('select * from research_lookup($1, $2, null, $3)', [owner, subject, 'support ticket 12'])).rows;
    expect(bySubject).toEqual([expect.objectContaining({ kind: 'subject', user_id: ids.yes.user, email: ids.yes.email, report_id: null })]);
    const byReport = (await t.admin.query('select * from research_lookup($1, $2, $3, $4)', [owner, [...codes][0], row.id, 'consent withdrawal'])).rows;
    expect(byReport).toEqual([expect.objectContaining({ kind: 'report', user_id: ids.yes.user, report_id: ids.yes.report, report_name: 'March', report_deleted: false })]);
    expect((await t.admin.query(`select count(*)::int n from audit_log where action = 'research_lookup' and user_id = $1`, [owner])).rows[0].n).toBe(2);
    // the worker writes links but cannot read them back; the app cannot touch them
    await expectPgError(asRole(t, 'lens_worker', 'select * from research_export_reports'), '42501');
    await expectPgError(asRole(t, 'lens_app', 'select * from research_export_reports'), '42501');
  });

  it('a "Build now" row is built once; the schedule skips while one is pending', async () => {
    const pending = (await t.admin.query(`insert into research_exports (requested_by) values ($1) returning id`, [ids.yes.user])).rows[0].id;
    expect((await buildResearchExport(deps())).status).toBe('skipped');
    expect(await buildResearchExport(deps(), pending)).toEqual({ id: pending, status: 'ready' });
    expect((await buildResearchExport(deps(), pending)).status).toBe('skipped');
  });

  it('withdrawing consent removes the user from the next dataset', async () => {
    await t.admin.query(`insert into consents (user_id, purpose, granted, policy_version, text_sha256) values ($1, 'research', false, '2026-10', repeat('a', 64))`, [ids.yes.user]);
    const { row, files } = await open((await buildResearchExport(deps())).id);
    expect(row.subjects).toBe(0); expect(row.trades).toBe(0);
    expect(csvRows(files['trades.csv'])).toHaveLength(1);                       // header only
  });

  it('datasets older than 90 days are deleted (object and key); the row stays', async () => {
    await t.admin.query(`update research_exports set expires_at = now() - interval '1 day' where status = 'ready'`);
    const before = store.size;
    expect(await sweepResearch(t.worker, h.deps.storage)).toBeGreaterThan(0);
    expect(store.size).toBeLessThan(before);
    const left = (await t.admin.query(`select count(*)::int n from research_exports where status = 'ready' and deleted_at is null`)).rows[0].n;
    expect(left).toBe(0);
    // the links outlive the file, so a row from an old download can still be traced
    expect((await t.admin.query('select count(*)::int n from research_export_reports')).rows[0].n).toBeGreaterThan(0);
  });

  it('the worker reads only the pseudonymised views; the app can list exports but not read research data', async () => {
    await asRole(t, 'lens_worker', 'select * from research.trades limit 1');
    await expectPgError(asRole(t, 'lens_worker', 'select * from research.consenting_users'), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'select * from research.pseudonym_key'), '42501');
    await asRole(t, 'lens_app', 'select id, status from research_exports');
    await expectPgError(asRole(t, 'lens_app', 'select * from research.trades'), '42501');
    await expectPgError(asRole(t, 'lens_app', `update research_exports set status = 'ready'`), '42501');
  });
});
