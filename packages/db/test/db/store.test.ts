/**
 * @file  packages/db/test/db/store.test.ts
 * @area  Tests
 * @what  Worker store step on a real database: every golden report stored as payload + trades + metrics + traits in one transaction, idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, givePlan, fakeFile, golden, goldenIds, type TestDb } from './harness.js';
import { createUpload, storeAnalysisResult, setAnalysisStatus, loadJob, analysisCounts, getAnalysis } from '../../src/queries/analyses.js';
import { createReportFromAnalysis, getReport, reportTrades, progressHistory } from '../../src/queries/reports.js';

const ok = await testDbAvailable();
const withReport = goldenIds();

describe.skipIf(!ok)('worker store step', () => {
  let t: TestDb, user = '';
  beforeAll(async () => {
    t = await freshDb('t_store');
    user = await makeUser(t);
    await givePlan(t, user, { reports: 100 });
  });
  afterAll(async () => { await t?.close(); });

  for (const id of withReport) {
    it(`stores ${id}: rows agree with the payload, and a claimed report renders the same JSON`, async () => {
      const report = golden(id);
      const up = await createUpload(t.app, { userId: user, files: [fakeFile(`${id}.csv`)] });
      await setAnalysisStatus(t.worker, up.analysisId, 'parsing');
      await setAnalysisStatus(t.worker, up.analysisId, 'analysing');
      expect(await storeAnalysisResult(t.worker, { analysisId: up.analysisId, engineVersion: 'golden', report, fileFingerprints: { [up.fileIds[0]]: 'tfp' } })).toBe(true);
      expect(await storeAnalysisResult(t.worker, { analysisId: up.analysisId, engineVersion: 'golden', report })).toBe(false);   // re-delivered job

      const a = (await t.admin.query('select status, payload, attempts, started_at, finished_at from analyses where id = $1', [up.analysisId])).rows[0];
      expect(a.status).toBe('ready');
      expect(a.attempts).toBe(1);
      expect(a.payload).toEqual(JSON.parse(JSON.stringify(report)));
      const counts = (await t.admin.query(`select (select count(*)::int from trades where analysis_id = $1) as trades,
        (select n from report_metrics where analysis_id = $1) as n,
        (select count(*)::int from report_traits where analysis_id = $1) as traits,
        (select sum(pnl) from trades where analysis_id = $1) as pnl`, [up.analysisId])).rows[0];
      expect(counts.trades).toBe(report.m.n);
      expect(counts.n).toBe(report.m.n);
      expect(counts.traits).toBe(new Set([...(report.behaviour?.traits ?? []), ...(report.behaviour?.more ?? [])].map((x) => x.id)).size);
      expect(Number(counts.pnl)).toBeCloseTo(report.trades.reduce((s, x) => s + x.pnl, 0), 4);

      const rid = await createReportFromAnalysis(t.app, user, up.analysisId);
      expect((await getReport(t.app, user, rid))!.report).toEqual(JSON.parse(JSON.stringify(report)));
      const rows = await reportTrades(t.app, user, rid);
      expect(rows).toHaveLength(report.trades.length);
      expect(rows[0].symbol).toBe(report.trades[0].symbol);
      if (report.trades[0].exitDate) expect(rows[0].exit_date).toBe(report.trades[0].exitDate);   // dates stay 'YYYY-MM-DD'
    });
  }

  it('a failed job keeps its error code and a late retry cannot undo ready', async () => {
    const up = await createUpload(t.app, { userId: user, files: [fakeFile()] });
    await setAnalysisStatus(t.worker, up.analysisId, 'failed', 'no_closed_trades');
    expect((await getAnalysis(t.app, user, up.analysisId))).toMatchObject({ status: 'failed', error_code: 'no_closed_trades' });

    const done = await createUpload(t.app, { userId: user, files: [fakeFile()] });
    await storeAnalysisResult(t.worker, { analysisId: done.analysisId, engineVersion: 'golden', report: golden(withReport[0]) });
    await setAnalysisStatus(t.worker, done.analysisId, 'parsing');
    expect((await getAnalysis(t.app, user, done.analysisId))!.status).toBe('ready');
  });

  it('loadJob returns files in upload order with their wrapped keys; D11 counters', async () => {
    const u = await makeUser(t);
    const up = await createUpload(t.app, { userId: u, files: [fakeFile('a.csv'), fakeFile('b.xlsx'), fakeFile('c.pdf')] });
    const job = await loadJob(t.worker, up.analysisId);
    expect(job!.files.map((f) => f.original_name)).toEqual(['a.csv', 'b.xlsx', 'c.pdf']);
    expect(job!.files.every((f) => Buffer.isBuffer(f.wrapped_dek))).toBe(true);
    expect(await analysisCounts(t.app, u)).toEqual({ today: 1, running: 1 });
  });

  it('progress history lists each report\'s score in order', async () => {
    const h = await progressHistory(t.app, user);
    expect(h.length).toBe(withReport.length);
    expect(h.some((x) => x.progress_score !== null)).toBe(true);
  });

  it('an upload is refused at the DB for a 4th file, a bad extension or a file over 10 MB', async () => {
    await expect(createUpload(t.app, { userId: user, files: [fakeFile(), fakeFile(), fakeFile(), fakeFile()] })).rejects.toThrow(/file_count/);
    await expect(createUpload(t.app, { userId: user, files: [fakeFile('x.exe')] })).rejects.toThrow(/ext/);
    await expect(createUpload(t.app, { userId: user, files: [{ ...fakeFile(), sizeBytes: 10 * 1024 * 1024 + 1 }] })).rejects.toThrow(/size_bytes/);
  });
});
