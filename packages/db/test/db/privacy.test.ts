/**
 * @file  packages/db/test/db/privacy.test.ts
 * @area  Tests
 * @what  Rule 7 in the database: consents, 30-day file purge with key shredding, draft purge, report delete, account delete, research views.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, asRole, expectPgError, type TestDb } from './harness.js';
import { createReportFromAnalysis, deleteReport, getReport, reportTrades } from '../../src/queries/reports.js';
import { recordConsent, currentConsents, requestData, deleteAccount, purgeRawFiles, purgeDrafts, filesToSweep, markObjectDeleted } from '../../src/queries/privacy.js';

const ok = await testDbAvailable();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const consent = (userId: string, purpose: 'processing' | 'research', granted: boolean) =>
  ({ userId, purpose, granted, policyVersion: '2026-10', textSha256: sha(purpose), ipHash: 'h', userAgent: 'test' });

describe.skipIf(!ok)('privacy and retention', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_privacy'); });
  afterAll(async () => { await t?.close(); });

  it('consents are append-only; the latest row wins; research is off by default', async () => {
    const u = await makeUser(t);
    expect(await currentConsents(t.app, u)).toEqual({ processing: false, research: false });
    await recordConsent(t.app, consent(u, 'processing', true));
    expect(await currentConsents(t.app, u)).toEqual({ processing: true, research: false });
    await recordConsent(t.app, consent(u, 'research', true));
    await recordConsent(t.app, consent(u, 'research', false));
    expect(await currentConsents(t.app, u)).toEqual({ processing: true, research: false });
    expect((await t.admin.query('select count(*)::int as n from consents where user_id = $1', [u])).rows[0].n).toBe(3);
  });

  it('one open data request of each kind per user', async () => {
    const u = await makeUser(t);
    const a = await requestData(t.app, u, 'export');
    const b = await requestData(t.app, u, 'export');
    expect(b.id).toBe(a.id);
    expect((await requestData(t.app, u, 'delete')).id).not.toBe(a.id);
  });

  it('purge_raw_files shreds files after 30 days (D3) but never touches reports or trades (D4)', async () => {
    const u = await makeUser(t);
    await givePlan(t, u);
    const { analysisId, fileIds } = await readyAnalysis(t, u);
    const report = await createReportFromAnalysis(t.app, u, analysisId);
    expect(await purgeRawFiles(t.worker)).toBe(0);                          // not due yet
    await t.admin.query(`update statement_files set delete_after = now() - interval '1 second' where id = $1`, [fileIds[0]]);
    expect(await purgeRawFiles(t.worker)).toBe(1);

    const f = (await t.admin.query('select status, wrapped_dek, iv, purged_at from statement_files where id = $1', [fileIds[0]])).rows[0];
    expect(f).toMatchObject({ status: 'purged', wrapped_dek: null, iv: null });
    const log = (await t.admin.query(`select actor_kind, action, reason from file_access_log where file_id = $1 order by id`, [fileIds[0]])).rows;
    expect(log.map((l) => l.action)).toEqual(['write', 'delete']);
    expect(log[1]).toMatchObject({ actor_kind: 'system', reason: 'retention_30d' });

    // the worker removes the (unreadable) object, then marks it
    const sweep = await filesToSweep(t.worker);
    expect(sweep.map((s) => s.id)).toContain(fileIds[0]);
    await markObjectDeleted(t.worker, fileIds[0]);
    expect((await filesToSweep(t.worker)).map((s) => s.id)).not.toContain(fileIds[0]);

    expect((await getReport(t.app, u, report))!.report).not.toBeNull();
    expect((await reportTrades(t.app, u, report)).length).toBeGreaterThan(0);
    // the old 0003 purge is a no-op for v2 reports (expires_at = infinity)
    expect((await asRole(t, 'lens_app', 'select purge_expired_reports() as n'))[0].n).toBe(0);
  });

  it('purge_drafts removes unsaved analyses after 24 h with their rows, and shreds files nobody uses', async () => {
    const u = await makeUser(t);
    await givePlan(t, u);
    const draft = await readyAnalysis(t, u);
    const kept = await readyAnalysis(t, u);
    await createReportFromAnalysis(t.app, u, kept.analysisId);
    await t.admin.query(`update analyses set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = any($1)`, [[draft.analysisId, kept.analysisId]]);
    await t.admin.query(`update statement_files set created_at = now() - interval '2 days' where id = any($1)`, [[...draft.fileIds, ...kept.fileIds]]);

    expect(await purgeDrafts(t.worker)).toBe(1);
    expect((await t.admin.query('select count(*)::int as n from analyses where id = $1', [draft.analysisId])).rows[0].n).toBe(0);
    expect((await t.admin.query('select count(*)::int as n from trades where analysis_id = $1', [draft.analysisId])).rows[0].n).toBe(0);
    expect((await t.admin.query('select status from statement_files where id = $1', [draft.fileIds[0]])).rows[0].status).toBe('purged');
    expect((await t.admin.query('select status from statement_files where id = $1', [kept.fileIds[0]])).rows[0].status).toBe('stored');
  });

  it('delete_report_v2 removes the payload, trades, metrics and shreds the files; idempotent; owner only', async () => {
    const u = await makeUser(t), other = await makeUser(t);
    await givePlan(t, u);
    const { analysisId, fileIds } = await readyAnalysis(t, u);
    const report = await createReportFromAnalysis(t.app, u, analysisId);
    expect(await deleteReport(t.app, other, report)).toBe(false);
    expect(await deleteReport(t.app, u, report)).toBe(true);
    expect(await deleteReport(t.app, u, report)).toBe(false);

    const r = (await t.admin.query('select report, file_names, purged_at, analysis_id from reports where id = $1', [report])).rows[0];
    expect(r).toMatchObject({ report: null, file_names: ['[deleted]'], analysis_id: null });
    expect(r.purged_at).not.toBeNull();
    for (const table of ['trades', 'report_metrics', 'report_traits']) {
      expect((await t.admin.query(`select count(*)::int as n from ${table} where analysis_id = $1`, [analysisId])).rows[0].n, table).toBe(0);
    }
    expect((await t.admin.query('select status, wrapped_dek from statement_files where id = $1', [fileIds[0]])).rows[0]).toEqual({ status: 'deleted', wrapped_dek: null });
  });

  it('delete_account removes the user\'s data, anonymises the row, keeps payments and consent proof; the email can sign up again', async () => {
    const email = `${crypto.randomUUID()}@t.local`;
    const u = await makeUser(t, { email });
    await givePlan(t, u);
    const { analysisId, fileIds } = await readyAnalysis(t, u);
    const report = await createReportFromAnalysis(t.app, u, analysisId);
    await readyAnalysis(t, u);                                               // an unsaved draft too
    await recordConsent(t.app, consent(u, 'processing', true));
    await t.admin.query(`insert into payments (user_id, gateway_order_id, amount_minor, currency, plan_id, status) values ($1, $2, 100, 'INR', 'single', 'paid')`, [u, `o_${u}`]);
    await t.admin.query(`insert into otp_codes (user_id, channel, destination, code_hash, purpose, expires_at) values ($1, 'email', $2, 'x', 'login', now())`, [u, email]);

    expect(await deleteAccount(t.app, u)).toBe(true);
    expect(await deleteAccount(t.app, u)).toBe(false);

    const user = (await t.admin.query('select email, name, google_sub, status, role from users where id = $1', [u])).rows[0];
    expect(user).toMatchObject({ email: `deleted+${u}@deleted.invalid`, name: null, google_sub: null, status: 'deleted', role: 'user' });
    expect((await t.admin.query('select purged_at from reports where id = $1', [report])).rows[0].purged_at).not.toBeNull();
    expect((await t.admin.query('select count(*)::int as n from analyses where user_id = $1', [u])).rows[0].n).toBe(0);
    expect((await t.admin.query('select count(*)::int as n from trades where user_id = $1', [u])).rows[0].n).toBe(0);
    expect((await t.admin.query(`select count(*)::int as n from statement_files where user_id = $1 and (status = 'stored' or original_name <> '[deleted]')`, [u])).rows[0].n).toBe(0);
    expect((await t.admin.query('select ip_hash, user_agent from consents where user_id = $1', [u])).rows).toEqual([{ ip_hash: null, user_agent: null }]);
    expect((await t.admin.query('select count(*)::int as n from payments where user_id = $1', [u])).rows[0].n).toBe(1);
    expect((await t.admin.query('select count(*)::int as n from otp_codes where user_id = $1', [u])).rows[0].n).toBe(0);
    expect((await t.admin.query('select bool_and(ends_at <= now()) as ended from subscriptions where user_id = $1', [u])).rows[0].ended).toBe(true);
    expect(fileIds).toHaveLength(1);

    const again = await makeUser(t, { email });
    expect(again).not.toBe(u);
  });

  it('research views: consenting, active users only, pseudonymised, no identifiers', async () => {
    const yes = await makeUser(t), no = await makeUser(t), withdrew = await makeUser(t);
    for (const u of [yes, no, withdrew]) {
      await givePlan(t, u);
      await createReportFromAnalysis(t.app, u, (await readyAnalysis(t, u)).analysisId);
    }
    await recordConsent(t.app, consent(yes, 'research', true));
    await recordConsent(t.app, consent(withdrew, 'research', true));
    await recordConsent(t.app, consent(withdrew, 'research', false));

    const subjects = await asRole(t, 'lens_research', 'select * from research.subjects');
    expect(subjects).toHaveLength(1);
    expect(subjects[0].subject).toMatch(/^[0-9a-f]{64}$/);
    expect(subjects[0].subject).not.toContain(yes.replace(/-/g, ''));
    const again = await asRole(t, 'lens_research', 'select subject from research.subjects');
    expect(again[0].subject).toBe(subjects[0].subject);                         // stable

    const trades = await asRole(t, 'lens_research', 'select * from research.trades');
    expect(trades.length).toBeGreaterThan(0);
    expect(new Set(trades.map((r) => r.subject))).toEqual(new Set([subjects[0].subject]));
    for (const col of ['user_id', 'email', 'source_file_id', 'source_row', 'analysis_id']) expect(Object.keys(trades[0])).not.toContain(col);
    const metrics = await asRole(t, 'lens_research', 'select extra from research.report_metrics');
    expect(Object.keys(metrics[0].extra)).not.toContain('clientId');

    await t.admin.query(`update users set status = 'blocked' where id = $1`, [yes]);
    expect(await asRole(t, 'lens_research', 'select * from research.subjects')).toHaveLength(0);
    await expectPgError(asRole(t, 'lens_app', 'select * from research.trades'), '42501');
  });
});
