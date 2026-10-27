/**
 * @file  apps/api/test/uploads.test.ts
 * @area  Tests
 * @what  Uploads and reports on real Postgres: consent, type/size/plan/D11 limits, encryption at rest, queueing, status, save (credits), "+" lock, rename, delete, lifetime trades.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { storeAnalysisResult, setAnalysisStatus } from '@pnl-lens/db';
import { testDbAvailable, makeUser, givePlan, golden } from '@pnl-lens/db/testing';
import { decryptFile } from '@pnl-lens/shared/file-crypto';
import { testApp, as, multipart, KEK, type TestApp, type Part } from './helpers.js';

const ok = await testDbAvailable();
const FIX = path.resolve(__dirname, '../../../packages/engine/test/fixtures');
const fixture = (name: string, as = name): Part => ({ name: 'files', filename: as, content: fs.readFileSync(path.join(FIX, name)) });
const consent: Part = { name: 'consent', value: 'true' };

describe.skipIf(!ok)('uploads and reports', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_uploads'); });
  afterAll(async () => { await x?.close(); });

  const upload = async (userId: string, parts: Part[]) => {
    const m = multipart(parts);
    return x.app.inject({ method: 'POST', url: '/api/v1/analyses', payload: m.payload, headers: { ...m.headers, ...(await as(userId)) } });
  };
  /** What the worker will do in Phase 5: store the engine output for a queued analysis. */
  const finish = async (analysisId: string, fingerprints?: Record<string, string>) => {
    const files = (await x.t.admin.query('select file_id from analysis_files where analysis_id = $1 order by position', [analysisId])).rows;
    await storeAnalysisResult(x.t.worker, {
      analysisId, engineVersion: 'test', report: golden('zerodha_tradebook_csv'),
      fileFingerprints: fingerprints ?? Object.fromEntries(files.map((f) => [f.file_id, `fp-${f.file_id}`])),
    });
  };

  it('accepts statements with consent: encrypted at rest, rows + access log + consent written, job queued', async () => {
    const u = await makeUser(x.t);
    const r = await upload(u, [consent, { name: 'research', value: 'true' }, fixture('zerodha_tradebook.csv'), fixture('groww_pnl.pdf')]);
    expect(r.statusCode).toBe(202);
    const { analysisId, status } = r.json();
    expect(status).toBe('queued');
    expect(x.queue.jobs).toContain(analysisId);

    const files = (await x.t.admin.query(`select f.* from analysis_files af join statement_files f on f.id = af.file_id where af.analysis_id = $1 order by af.position`, [analysisId])).rows;
    expect(files.map((f) => [f.original_name, f.detected_kind])).toEqual([['zerodha_tradebook.csv', 'sheet'], ['groww_pnl.pdf', 'pdf']]);
    for (const f of files) {
      const stored = x.storage.objects.get(f.storage_key)!;
      const plain = fs.readFileSync(path.join(FIX, f.original_name));
      expect(f.storage_key).not.toContain(f.original_name);
      expect(stored.includes(plain.subarray(0, 32))).toBe(false);                       // not plaintext
      expect(decryptFile(stored, f.iv, f.wrapped_dek, KEK).equals(plain)).toBe(true);    // the worker can read it
      expect(f.sha256).toBe(crypto.createHash('sha256').update(plain).digest('hex'));
    }
    const log = (await x.t.admin.query(`select action, actor_kind, ip from file_access_log where owner_user_id = $1`, [u])).rows;
    expect(log).toHaveLength(2);
    expect(log.every((l) => l.action === 'write' && l.actor_kind === 'user')).toBe(true);
    const consents = (await x.t.admin.query('select purpose, granted from consents where user_id = $1 order by id', [u])).rows;
    expect(consents).toEqual([{ purpose: 'processing', granted: true }, { purpose: 'research', granted: true }]);
  });

  it('status then preview, the summary numbers the upload screen shows', async () => {
    const u = await makeUser(x.t);
    const { analysisId } = (await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json();
    const h = await as(u);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${analysisId}`, headers: h })).json()).toMatchObject({ status: 'queued', preview: null });
    await finish(analysisId);
    const g = golden('zerodha_tradebook_csv');
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${analysisId}`, headers: h })).json()).toMatchObject({
      status: 'ready', preview: { positions: g.m.n, from: g.m.from, to: g.m.to, currency: g.m.currency, net: g.m.net, leaks: g.leaks.length, rules: g.rules.length, source: g.m.source,
        charges: g.m.charges, insightCount: g.leaks.length + (g.strengths || []).length },
    });
    // the free preview names only the 2 biggest insights (credits spec rule 9)
    const pv = (await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${analysisId}`, headers: h })).json().preview;
    expect(pv.insights).toHaveLength(Math.min(2, g.leaks.length + (g.strengths || []).length));
    expect(pv.insights[0]).toBe([...g.leaks].sort((a: any, b: any) => Math.abs(b.impact) - Math.abs(a.impact))[0].title);
    const other = await makeUser(x.t);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${analysisId}`, headers: await as(other) })).statusCode).toBe(404);
  });

  it('a failed file shows the engine\'s own message, or the upload screen\'s text', async () => {
    const u = await makeUser(x.t), h = await as(u);
    const a = (await upload(u, [consent, fixture('zerodha_tradebook.pdf')])).json().analysisId;
    await setAnalysisStatus(x.t.worker, a, 'failed', 'read_error', 'This PDF has no readable text (it may be a scan). Download the Excel/CSV or a text PDF from your broker.');
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${a}`, headers: h })).json()).toMatchObject({ status: 'failed', error: 'read_error', message: expect.stringMatching(/^This PDF has no readable text/) });
    const b = (await upload(u, [consent, fixture('open_only.xlsx')])).json().analysisId;
    await setAnalysisStatus(x.t.worker, b, 'failed', 'no_closed_trades');
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/analyses/${b}`, headers: h })).json().message).toMatch(/^No closed trades found in this file\./);
  });

  it('refuses: no consent, no files, wrong extension, wrong real type, more than 3 files, over 10 MB', async () => {
    const u = await makeUser(x.t);
    expect((await upload(u, [fixture('zerodha_tradebook.csv')])).json().error).toBe('consent_required');
    expect((await upload(u, [consent])).json().error).toBe('no_files');
    expect((await upload(u, [consent, { name: 'files', filename: 'virus.exe', content: Buffer.from('MZ') }])).json().error).toBe('bad_extension');
    const fake = await upload(u, [consent, { name: 'files', filename: 'statement.csv', content: Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0]) }]);
    expect(fake.statusCode).toBe(415);
    expect(fake.json()).toMatchObject({ error: 'bad_file_type', message: expect.stringContaining('statement.csv') });
    const four = await upload(u, [consent, ...['a', 'b', 'c', 'd'].map((n) => fixture('zerodha_tradebook.csv', `${n}.csv`))]);
    expect(four.statusCode).toBe(400);
    expect(four.json().error).toBe('too_many_files');
    const big = await upload(u, [consent, { name: 'files', filename: 'big.csv', content: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41) }]);
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe('file_too_large');
    expect(x.storage.objects.size).toBeGreaterThan(0);
    expect((await x.t.admin.query('select count(*)::int as n from analyses where user_id = $1', [u])).rows[0].n).toBe(0);   // nothing half-created
  });

  it('plan limit: statements per report follow the active plan', async () => {
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { files: 2 });
    const r = await upload(u, [consent, fixture('zerodha_tradebook.csv', 'a.csv'), fixture('dhan_tradebook.csv', 'b.csv'), fixture('ibkr_tradebook.csv', 'c.csv')]);
    expect(r.json()).toEqual({ error: 'too_many_files', message: 'Your plan allows up to 2 broker statements per report.' });
  });

  it('D11: 3 running at once and 20 a day per user', async () => {
    const u = await makeUser(x.t);
    for (let i = 0; i < 3; i++) expect((await upload(u, [consent, fixture('zerodha_tradebook.csv')])).statusCode).toBe(202);
    expect((await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json().error).toBe('too_many_running');
    await x.t.admin.query(`update analyses set status = 'failed', error_code = 'x' where user_id = $1`, [u]);
    await x.t.admin.query(`insert into analyses (user_id, file_count, status, error_code) select $1, 1, 'failed', 'x' from generate_series(1, 17)`, [u]);
    expect((await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json().error).toBe('daily_limit');
  });

  it('save: no plan -> 402; with a plan -> report, credit spent; listed with MON-YY; get, rename, delete, then 410', async () => {
    const u = await makeUser(x.t), h = await as(u);
    const a = (await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json().analysisId;
    await finish(a);
    const noPlan = await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: a } });
    expect(noPlan.statusCode).toBe(402);
    expect(noPlan.json()).toEqual({ error: 'no_plan', message: 'No reports left. Choose a plan to continue.' });

    await givePlan(x.t, u, { reports: 2 });
    const saved = await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: a, title: 'March' } });
    expect(saved.statusCode).toBe(201);
    const id = saved.json().id;
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: h })).json()).toMatchObject({ credits: 1, reportsLeft: 1 });
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: a } })).json().error).toBe('already_claimed');

    const list = (await x.app.inject({ method: 'GET', url: '/api/v1/reports', headers: h })).json().reports;
    expect(list[0]).toMatchObject({ id, title: 'March', monthLabel: expect.stringMatching(/^[A-Z]{3}-\d{2}$/), expiresAt: null, purged: false, fileNames: ['zerodha_tradebook.csv'] });

    const one = await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: h });
    expect(one.json().report.m.n).toBe(golden('zerodha_tradebook_csv').m.n);
    expect(one.json().history).toHaveLength(1);

    expect((await x.app.inject({ method: 'PATCH', url: `/api/v1/reports/${id}`, headers: h, payload: { title: 'Q1' } })).json()).toEqual({ ok: true, title: 'Q1' });
    const stranger = await as(await makeUser(x.t));
    expect((await x.app.inject({ method: 'PATCH', url: `/api/v1/reports/${id}`, headers: stranger, payload: { title: 'x' } })).statusCode).toBe(404);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: stranger })).statusCode).toBe(404);
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${id}`, headers: stranger })).statusCode).toBe(404);

    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${id}`, headers: h })).json()).toEqual({ deleted: true });
    const gone = await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: h });
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error).toBe('expired');
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${id}`, headers: h })).statusCode).toBe(404);
  });

  it('lifetime: every live report\'s trades and currency, own reports only, deleted ones left out', async () => {
    const u = await makeUser(x.t), other = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 3 }); await givePlan(x.t, other, { reports: 1 });
    const h = await as(u);
    const save = async (who: string) => {
      const m = multipart([consent, fixture('zerodha_tradebook.csv')]);
      const a = (await x.app.inject({ method: 'POST', url: '/api/v1/analyses', payload: m.payload, headers: { ...m.headers, ...(await as(who)) } })).json().analysisId;
      await finish(a);
      return (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(who), payload: { analysisId: a } })).json().id as string;
    };
    const one = await save(u), two = await save(u); await save(other);
    await x.app.inject({ method: 'PATCH', url: `/api/v1/reports/${one}`, headers: h, payload: { title: 'Q1' } });
    let l = (await x.app.inject({ method: 'GET', url: '/api/v1/me/lifetime', headers: h })).json();
    expect(l.reports.map((r: any) => r.id)).toEqual([one, two]);
    expect(l.reports[0]).toMatchObject({ title: 'Q1', currency: 'INR' });
    expect(l.reports[0].trades.length).toBe(golden('zerodha_tradebook_csv').trades.length);
    await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${two}`, headers: h });
    l = (await x.app.inject({ method: 'GET', url: '/api/v1/me/lifetime', headers: h })).json();
    expect(l.reports.map((r: any) => r.id)).toEqual([one]);
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/me/lifetime' })).statusCode).toBe(401);
  });

  it('credits spec: reports left follows grant, create, delete and the plan window; "+" refused after the window, before storing', async () => {
    const u = await makeUser(x.t), h = await as(u);
    const me = async () => (await x.app.inject({ method: 'GET', url: '/api/v1/me', headers: h })).json().reportsLeft;
    expect(await me()).toBe(0);
    const sub = await givePlan(x.t, u, { reports: 5, files: 3 });
    expect(await me()).toBe(5);
    const a = (await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json().analysisId;
    await finish(a);
    const report = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: a } })).json().id;
    expect(await me()).toBe(4);
    await x.t.admin.query(`update subscriptions set ends_at = now() - interval '1 minute' where id = $1`, [sub]);
    expect(await me()).toBe(0);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/reports/${report}`, headers: h })).statusCode).toBe(200);   // old reports still open
    const files = (await x.t.admin.query('select count(*)::int n from statement_files where user_id = $1', [u])).rows[0].n;
    const plus = await upload(u, [consent, { name: 'reportId', value: report }, fixture('dhan_tradebook.csv')]);
    expect(plus.statusCode).toBe(402);
    expect(plus.json()).toEqual({ error: 'plan_expired', message: 'Your plan has ended. Your reports are still here. Choose a plan to add statements or create new reports.' });
    expect((await x.t.admin.query('select count(*)::int n from statement_files where user_id = $1', [u])).rows[0].n).toBe(files);   // nothing stored
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${report}`, headers: h })).json()).toEqual({ deleted: true });
    expect(await me()).toBe(0);
  });

  it('"+": adds a statement to a report (spends nothing) until the plan\'s limit; refuses once the old files are purged', async () => {
    const u = await makeUser(x.t), h = await as(u);
    await givePlan(x.t, u, { files: 2, reports: 3 });
    const first = (await upload(u, [consent, fixture('zerodha_tradebook.csv')])).json().analysisId;
    await finish(first);
    const report = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: first } })).json().id;

    const plus = await upload(u, [consent, { name: 'reportId', value: report }, fixture('dhan_tradebook.csv')]);
    expect(plus.statusCode).toBe(202);
    const a2 = plus.json().analysisId;
    expect((await x.t.admin.query('select count(*)::int as n from analysis_files where analysis_id = $1', [a2])).rows[0].n).toBe(2);   // old + new
    await finish(a2);
    expect((await x.app.inject({ method: 'GET', url: `/api/v1/reports/${report}/status`, headers: h })).json()).toMatchObject({ status: 'ready', analysis: { id: a2 } });
    expect((await x.app.inject({ method: 'POST', url: `/api/v1/reports/${report}/files`, headers: h, payload: { analysisId: a2 } })).json()).toEqual({ id: report });
    expect((await x.t.admin.query('select reports_used from subscriptions where user_id = $1', [u])).rows[0].reports_used).toBe(1);

    // the plan allows 2 statements: a third upload is refused before anything is stored
    expect((await upload(u, [consent, { name: 'reportId', value: report }, fixture('ibkr_tradebook.csv')])).json().error).toBe('too_many_files');

    // after 30 days the report's files are gone, so "+" cannot re-read them
    await x.t.admin.query(`update statement_files set delete_after = now() - interval '1 second' where user_id = $1`, [u]);
    await x.t.admin.query('select purge_raw_files()');
    const expired = await upload(u, [consent, { name: 'reportId', value: report }, fixture('ibkr_tradebook.csv')]);
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error).toBe('files_expired');
  });

  it('POST /reports refuses report JSON from the browser (the old contract is gone)', async () => {
    const u = await makeUser(x.t);
    const small = await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { report: { version: 1, m: { n: 1 } }, fileNames: ['a.csv'], fileHashes: ['h'] } });
    expect(small.statusCode).toBe(400);
    const full = await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { report: golden('zerodha_tradebook_csv'), fileNames: ['a.csv'], fileHashes: ['h'] } });
    expect(full.statusCode).toBe(413);                                                // JSON bodies are capped at 64 KB
    expect((await x.t.admin.query('select count(*)::int as n from reports where user_id = $1', [u])).rows[0].n).toBe(0);
  });

  it('file tabs: a 2-file report lists each statement with its own dashboard; removing one keeps its place', async () => {
    const u = await makeUser(x.t), h = await as(u);
    await givePlan(x.t, u, { files: 2 });
    const a = (await upload(u, [consent, fixture('zerodha_tradebook.csv'), fixture('groww_pnl.csv')])).json().analysisId;
    const files = (await x.t.admin.query('select file_id, position from analysis_files where analysis_id = $1 order by position', [a])).rows;
    // what the worker stores for a 2-file analysis (per-file reports from analysing each file alone)
    await finish(a);
    await x.t.admin.query(`insert into analysis_file_reports (analysis_id, position, file_id, user_id, payload) values ($1, 0, $2, $4, $5), ($1, 1, $3, $4, null)`,
      [a, files[0].file_id, files[1].file_id, u, JSON.stringify(golden('zerodha_tradebook_csv'))]);
    const id = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: h, payload: { analysisId: a } })).json().id;
    const r = (await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: h })).json();
    expect(r.files.map((f: any) => [f.name, f.stored, !!f.report])).toEqual([['zerodha_tradebook.csv', true, true], ['groww_pnl.csv', true, false]]);
    expect(r.files[0].report.m.n).toBe(golden('zerodha_tradebook_csv').m.n);
    expect(r.places).toEqual({ total: 2, used: 2 });

    // remove the second statement: a new analysis over the first only, applied without spending a report
    const rm = await x.app.inject({ method: 'POST', url: `/api/v1/reports/${id}/files/remove`, headers: h, payload: { fileId: files[1].file_id } });
    expect(rm.statusCode).toBe(202);
    const a2 = rm.json().analysisId;
    expect(x.queue.jobs).toContain(a2);
    expect((await x.t.admin.query('select file_id from analysis_files where analysis_id = $1', [a2])).rows).toEqual([{ file_id: files[0].file_id }]);
    await finish(a2);
    expect((await x.app.inject({ method: 'POST', url: `/api/v1/reports/${id}/files`, headers: h, payload: { analysisId: a2 } })).statusCode).toBe(200);
    const after = (await x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}`, headers: h })).json();
    expect(after.files.map((f: any) => f.name)).toEqual(['zerodha_tradebook.csv']);
    expect((await x.t.admin.query('select used_fingerprints from reports where id = $1', [id])).rows[0].used_fingerprints).toHaveLength(2);
    expect((await x.app.inject({ method: 'POST', url: `/api/v1/reports/${id}/files/remove`, headers: h, payload: { fileId: files[0].file_id } })).json().error).toBe('last_file');
    expect((await x.t.admin.query('select reports_used from subscriptions where user_id = $1', [u])).rows[0].reports_used).toBe(1);
  });
});
