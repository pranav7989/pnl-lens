/**
 * @file  packages/db/test/db/credits.test.ts
 * @area  Tests
 * @what  Credits spec (19 Oct 2026) acceptance checks in the database: reports left, "+" free up to the limit, failed files and deletes spend/return nothing, plan window, soonest-expiring first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createReportFromAnalysis, addAnalysisToReport, deleteReport, getReport } from '../../src/queries/reports.js';
import { DbError } from '../../src/errors.js';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, asRole, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { if (e instanceof DbError) return e.code; throw e; } };

describe.skipIf(!ok)('credits spec', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_credits_spec'); });
  afterAll(async () => { await t?.close(); });
  const left = async (u: string) => (await asRole(t, 'lens_app', `select public.user_reports_left('${u}') as n`))[0].n as number;

  it('Snapshot: 5 left → create → 4; "+" 2nd and 3rd keep 4, a 4th is refused; a failed file and a delete change nothing', async () => {
    const u = await makeUser(t);
    expect(await left(u)).toBe(0);                                                   // rule 7: new accounts start at 0
    await givePlan(t, u, { reports: 5, files: 3 });
    expect(await left(u)).toBe(5);
    const first = await readyAnalysis(t, u, { files: 1, fingerprints: ['A'] });
    const report = await createReportFromAnalysis(t.app, u, first.analysisId);
    expect(await left(u)).toBe(4);

    const ab = await readyAnalysis(t, u, { files: 1, fingerprints: ['B'], existingFileIds: first.fileIds, targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, ab.analysisId))).toBe('ok');
    const abc = await readyAnalysis(t, u, { files: 1, fingerprints: ['C'], existingFileIds: first.fileIds, targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, abc.analysisId))).toBe('ok');
    expect(await left(u)).toBe(4);
    const abcd = await readyAnalysis(t, u, { files: 1, fingerprints: ['D'], existingFileIds: first.fileIds, targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, abcd.analysisId))).toBe('report_files_full');

    const failed = await readyAnalysis(t, u, { files: 1 });
    await t.admin.query(`update analyses set status = 'failed', error_code = 'read_error' where id = $1`, [failed.analysisId]);
    expect(await code(createReportFromAnalysis(t.app, u, failed.analysisId))).toBe('analysis_not_ready');
    expect(await left(u)).toBe(4);

    expect(await deleteReport(t.app, u, report)).toBe(true);
    expect(await left(u)).toBe(4);                                                    // rule 5: no refund
  });

  it('after the window ends: 0 left, old reports still open, "+" refused', async () => {
    const u = await makeUser(t);
    const sub = await givePlan(t, u, { reports: 5, files: 3 });
    const first = await readyAnalysis(t, u, { files: 1, fingerprints: ['A'] });
    const report = await createReportFromAnalysis(t.app, u, first.analysisId);
    await t.admin.query(`update subscriptions set ends_at = now() - interval '1 minute' where id = $1`, [sub]);
    expect(await left(u)).toBe(0);                                                    // unused reports lapse
    expect((await getReport(t.app, u, report))?.id).toBe(report);                      // reports never expire
    const plus = await readyAnalysis(t, u, { files: 1, fingerprints: ['B'], existingFileIds: first.fileIds, targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, plus.analysisId))).toBe('plan_expired');
    const fresh = await readyAnalysis(t, u, { files: 1 });
    expect(await code(createReportFromAnalysis(t.app, u, fresh.analysisId))).toBe('plan_expired');
  });

  it('Single + Snapshot together: credits add up; Single (expires first) is used first and that report allows 2 statements', async () => {
    const u = await makeUser(t);
    const single = await givePlan(t, u, { reports: 1, files: 2, days: 7 });
    const snapshot = await givePlan(t, u, { reports: 5, files: 3, days: 92 });
    expect(await left(u)).toBe(6);
    const a = await readyAnalysis(t, u, { files: 1, fingerprints: ['A'] });
    const r1 = await createReportFromAnalysis(t.app, u, a.analysisId);
    expect((await getReport(t.app, u, r1))?.subscription_id).toBe(single);
    const b = await readyAnalysis(t, u, { files: 1, fingerprints: ['B'], existingFileIds: a.fileIds, targetReportId: r1 });
    expect(await code(addAnalysisToReport(t.app, u, r1, b.analysisId))).toBe('ok');
    const c = await readyAnalysis(t, u, { files: 1, fingerprints: ['C'], existingFileIds: a.fileIds, targetReportId: r1 });
    expect(await code(addAnalysisToReport(t.app, u, r1, c.analysisId))).toBe('report_files_full');   // Single: 2 statements
    const d = await readyAnalysis(t, u, { files: 1 });
    const r2 = await createReportFromAnalysis(t.app, u, d.analysisId);
    expect((await getReport(t.app, u, r2))?.subscription_id).toBe(snapshot);
    expect(await left(u)).toBe(4);
  });
});
