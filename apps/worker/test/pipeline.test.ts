/**
 * @file  apps/worker/test/pipeline.test.ts
 * @area  Tests
 * @what  Every golden case through the real pipeline (encrypted storage → engine child → DB): stored report equals the parity output; failures cost no credit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, givePlan, type TestDb } from '@pnl-lens/db/testing';
import { createReportFromAnalysis, getReport, isDbError } from '@pnl-lens/db';
import { processAnalysis } from '../src/pipeline.js';
import { harness, uploadFiles, goldenCases, fixture, type Harness } from './helpers.js';

const ok = await testDbAvailable();
const CASES = goldenCases();

describe.skipIf(!ok)('pipeline: every golden case', () => {
  let t: TestDb, h: Harness, user = '';
  beforeAll(async () => {
    t = await freshDb('t_worker_pipeline');
    h = harness(t);
    user = await makeUser(t);
    await givePlan(t, user, { reports: 100 });
  });
  afterAll(async () => { await t?.close(); });

  it('covers all 22 golden cases (17 single files, 3 combined, 2 currency overrides)', () => {
    expect(CASES).toHaveLength(22);
    expect(CASES.filter((c) => c.files.length > 1)).toHaveLength(3);
    expect(CASES.filter((c) => c.currency)).toHaveLength(2);
  });

  for (const c of CASES) {
    it(c.id, async () => {
      const { analysisId, fileIds } = await uploadFiles(t, h, user, c.files.map((f) => fixture(f)), { currency: c.currency });
      const before = (await t.admin.query('select sum(reports_used)::int as used from subscriptions where user_id = $1', [user])).rows[0].used;
      const outcome = await processAnalysis(h.deps, analysisId, `job-${c.id}`);
      const a = (await t.admin.query('select status, error_code, payload, engine_version from analyses where id = $1', [analysisId])).rows[0];

      // every file was read and decrypted by the worker, and logged
      const log = (await t.admin.query(`select file_id, action, actor_kind, job_id from file_access_log where file_id = any($1) and actor_kind = 'worker' order by id`, [fileIds])).rows;
      expect(log.map((l) => l.action)).toEqual(fileIds.flatMap(() => ['read', 'decrypt']));
      expect(log.every((l) => l.job_id === `job-${c.id}`)).toBe(true);

      if (!c.report) {
        // no closed trades: failed for good, nothing spent, cannot be saved
        expect(outcome).toBe('failed');
        expect(a).toMatchObject({ status: 'failed', error_code: 'no_closed_trades' });
        await expect(createReportFromAnalysis(t.app, user, analysisId)).rejects.toSatisfy((e) => isDbError(e, 'analysis_not_ready'));
        expect((await t.admin.query('select sum(reports_used)::int as used from subscriptions where user_id = $1', [user])).rows[0].used).toBe(before);
        expect((await t.admin.query(`select outcome from parse_runs where analysis_id = $1`, [analysisId])).rows).toEqual([{ outcome: 'no_trades' }]);
        return;
      }

      expect(outcome).toBe('ready');
      expect(a.status).toBe('ready');
      expect(a.engine_version).toBe(h.deps.engineVersion);
      // byte-identical to the parity output (generatedAt is the only normalised field, as in golden.test.ts)
      const run = h.lastRun.result!;
      expect(run.ok).toBe(true);
      const produced = (run as any).report;
      expect(JSON.stringify({ ...produced, generatedAt: '<normalised>' })).toBe(JSON.stringify(c.report));
      // and what the DB holds equals it too
      expect({ ...a.payload, generatedAt: '<normalised>' }).toEqual(c.report);

      const counts = (await t.admin.query(`select
          (select count(*)::int from trades where analysis_id = $1) as trades,
          (select n from report_metrics where analysis_id = $1) as n,
          (select count(*)::int from parse_runs where analysis_id = $1) as runs,
          (select count(*)::int from fills where analysis_id = $1) as fills,
          (select count(*)::int from statement_files where id = any($2) and fingerprint is not null) as fps`, [analysisId, fileIds])).rows[0];
      expect(counts.trades).toBe(c.report.m.n);
      expect(counts.n).toBe(c.report.m.n);
      expect(counts.runs).toBe(c.files.length);
      expect(counts.fps).toBe(c.files.length);
      if (c.report.m.source === 'tradebook' && c.files.length === 1 && !c.id.includes('pdf') && !c.id.includes('docx')) expect(counts.fills).toBeGreaterThan(0);

      // saving it spends exactly one report and serves the same JSON
      const id = await createReportFromAnalysis(t.app, user, analysisId);
      expect({ ...((await getReport(t.app, user, id))!.report as any), generatedAt: '<normalised>' }).toEqual(c.report);
      expect((await t.admin.query('select sum(reports_used)::int as used from subscriptions where user_id = $1', [user])).rows[0].used).toBe(before + 1);
    });
  }
});

describe.skipIf(!ok)('pipeline: failures, idempotency and the file-set fingerprint', () => {
  let t: TestDb, h: Harness, user = '';
  beforeAll(async () => {
    t = await freshDb('t_worker_failures');
    h = harness(t);
    user = await makeUser(t);
    await givePlan(t, user, { reports: 10, files: 2 });
  });
  afterAll(async () => { await t?.close(); });

  it('an unreadable file fails with the engine\'s own message; nothing is spent', async () => {
    const { analysisId } = await uploadFiles(t, h, user, [{ name: 'broken.pdf', bytes: Buffer.from('%PDF-1.4\nthis is not really a pdf') }]);
    expect(await processAnalysis(h.deps, analysisId)).toBe('failed');
    const a = (await t.admin.query('select status, error_code, error_message from analyses where id = $1', [analysisId])).rows[0];
    expect(a).toMatchObject({ status: 'failed', error_code: 'read_error' });
    expect(a.error_message.length).toBeGreaterThan(5);
    expect((await t.admin.query(`select outcome, error_code from parse_runs where analysis_id = $1`, [analysisId])).rows).toEqual([{ outcome: 'error', error_code: 'read_error' }]);
    expect((await t.admin.query('select reports_used from subscriptions where user_id = $1', [user])).rows[0].reports_used).toBe(0);
  });

  it('a re-delivered job does nothing (idempotent): no duplicate rows', async () => {
    const { analysisId } = await uploadFiles(t, h, user, [fixture('zerodha_tradebook.csv')]);
    expect(await processAnalysis(h.deps, analysisId)).toBe('ready');
    const count = async () => (await t.admin.query(`select (select count(*) from trades where analysis_id = $1) + (select count(*) from fills where analysis_id = $1) + (select count(*) from parse_runs where analysis_id = $1) as n`, [analysisId])).rows[0].n;
    const n = await count();
    expect(await processAnalysis(h.deps, analysisId)).toBe('skipped');
    expect(await count()).toBe(n);
  });

  it('a storage outage throws (so BullMQ retries) and leaves the job retryable', async () => {
    const { analysisId } = await uploadFiles(t, h, user, [fixture('dhan_tradebook.csv')]);
    const key = (await t.admin.query('select f.storage_key from analysis_files af join statement_files f on f.id = af.file_id where af.analysis_id = $1', [analysisId])).rows[0].storage_key;
    const saved = h.objects.get(key)!;
    h.objects.delete(key);
    await expect(processAnalysis(h.deps, analysisId)).rejects.toThrow(/NoSuchKey/);
    expect((await t.admin.query('select status from analyses where id = $1', [analysisId])).rows[0].status).toBe('parsing');
    h.objects.set(key, saved);                                           // storage back: the retry succeeds
    expect(await processAnalysis(h.deps, analysisId)).toBe('ready');
    expect((await t.admin.query('select attempts from analyses where id = $1', [analysisId])).rows[0].attempts).toBe(2);
  });

  it('files purged after 30 days: the job fails with a clear message', async () => {
    const { analysisId } = await uploadFiles(t, h, user, [fixture('ibkr_tradebook.csv')]);
    await t.admin.query(`update statement_files set delete_after = now() - interval '1 second' where id in (select file_id from analysis_files where analysis_id = $1)`, [analysisId]);
    await t.admin.query('select purge_raw_files()');
    expect(await processAnalysis(h.deps, analysisId)).toBe('failed');
    expect((await t.admin.query('select error_code from analyses where id = $1', [analysisId])).rows[0].error_code).toBe('files_expired');
  });

  it('the same statement gets the same fingerprint (renamed, or as PDF vs Word); a different one does not', async () => {
    const fp = async (files: { name: string; bytes: Buffer }[]) => {
      const { analysisId, fileIds } = await uploadFiles(t, h, user, files);
      await processAnalysis(h.deps, analysisId);
      return (await t.admin.query('select fingerprint from statement_files where id = any($1) order by created_at', [fileIds])).rows.map((r) => r.fingerprint);
    };
    const [a] = await fp([fixture('zerodha_tradebook.csv')]);
    const [b] = await fp([fixture('zerodha_tradebook.csv', 'renamed copy.csv')]);
    const [pdf] = await fp([fixture('groww_pnl.pdf')]);
    const [doc] = await fp([fixture('groww_pnl.doc')]);
    const [other] = await fp([fixture('dhan_tradebook.csv')]);
    expect(b).toBe(a);
    expect(doc).toBe(pdf);
    expect(other).not.toBe(a);
  });

  it('server-side file-set lock end to end: "+" a second statement, then a third is refused', async () => {
    const first = await uploadFiles(t, h, user, [fixture('zerodha_tradebook.csv')]);
    await processAnalysis(h.deps, first.analysisId);
    const report = await createReportFromAnalysis(t.app, user, first.analysisId);
    const plus = await uploadFiles(t, h, user, [fixture('dhan_tradebook.csv')], { targetReportId: report, existingFileIds: first.fileIds });
    expect(await processAnalysis(h.deps, plus.analysisId)).toBe('ready');
    const { addAnalysisToReport } = await import('@pnl-lens/db');
    await addAnalysisToReport(t.app, user, report, plus.analysisId);
    // swap the second statement for a different one: still 3 distinct statements ever → refused (plan allows 2)
    const swap = await uploadFiles(t, h, user, [fixture('ibkr_tradebook.csv')], { targetReportId: report, existingFileIds: first.fileIds });
    expect(await processAnalysis(h.deps, swap.analysisId)).toBe('ready');
    await expect(addAnalysisToReport(t.app, user, report, swap.analysisId)).rejects.toSatisfy((e) => isDbError(e, 'report_files_full'));
  });
});
