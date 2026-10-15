/**
 * @file  packages/db/test/db/plans.test.ts
 * @area  Tests
 * @what  Server-side plan rules: create_report_from_analysis (all refusal reasons, races), file-set lock, owner-only manual grant, webhook replay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb } from '../../src/client.js';
import { createReportFromAnalysis, addAnalysisToReport, getReport, renameReport, listReports } from '../../src/queries/reports.js';
import { adminGrantPlan, userPlans } from '../../src/queries/plans.js';
import { DbError } from '../../src/errors.js';
import { testDbAvailable, freshDb, makeUser, givePlan, readyAnalysis, asRole, type TestDb } from './harness.js';

const ok = await testDbAvailable();

const code = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { if (e instanceof DbError) return e.code; throw e; }
};

describe.skipIf(!ok)('create_report_from_analysis', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_plans'); });
  afterAll(async () => { await t?.close(); });

  it('creates a report from a ready analysis and spends one report from the plan', async () => {
    const u = await makeUser(t);
    const sub = await givePlan(t, u, { reports: 5 });
    const { analysisId } = await readyAnalysis(t, u, { files: 2, fingerprints: ['tA', 'tB'] });
    const id = await createReportFromAnalysis(t.app, u, analysisId, '  My March  ');

    const r = (await t.admin.query('select * from reports where id = $1', [id])).rows[0];
    expect(r.subscription_id).toBe(sub);
    expect(r.title).toBe('My March');
    expect(r.expires_at).toBe(Infinity);                         // D4: never expires
    expect(r.month_label).toMatch(/^[A-Z]{3}-\d{2}$/);
    const ist = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'short', year: '2-digit' }).toUpperCase().replace(' ', '-');
    expect(r.month_label).toBe(ist);
    expect(r.file_names).toEqual(['file0.csv', 'file1.csv']);
    expect([...r.used_fingerprints].sort()).toEqual(['tA', 'tB']);
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.trade_count).toBe(r.report.m.n);
    expect(r.engine_version).toBe('test-1');

    const s = (await t.admin.query('select reports_used from subscriptions where id = $1', [sub])).rows[0];
    expect(s.reports_used).toBe(1);
    expect((await t.admin.query('select balance from credits where user_id = $1', [u])).rows[0].balance).toBe(4);
    const a = (await t.admin.query('select claimed_at, report_id, payload from analyses where id = $1', [analysisId])).rows[0];
    expect(a.report_id).toBe(id);
    expect(a.claimed_at).not.toBeNull();
    expect(a.payload).toBeNull();                               // the report holds the only copy
    const audit = (await t.admin.query(`select meta from audit_log where action = 'report_created' and user_id = $1`, [u])).rows;
    expect(audit[0].meta.analysis_id).toBe(analysisId);

    const g = await getReport(t.app, u, id);
    expect((g!.report as any).m.n).toBe(r.report.m.n);
    expect((await listReports(t.app, u))[0]).toMatchObject({ id, title: 'My March', month_label: ist });
  });

  it('refuses balance-only credits without a plan (D6): no_plan', async () => {
    const u = await makeUser(t);
    await t.admin.query('update credits set balance = 5 where user_id = $1', [u]);
    const { analysisId } = await readyAnalysis(t, u);
    expect(await code(createReportFromAnalysis(t.app, u, analysisId))).toBe('no_plan');
  });

  it('plan_expired, plan_used_up and too_many_files', async () => {
    const u1 = await makeUser(t);
    await givePlan(t, u1, { days: -1 });
    expect(await code(createReportFromAnalysis(t.app, u1, (await readyAnalysis(t, u1)).analysisId))).toBe('plan_expired');

    const u2 = await makeUser(t);
    await givePlan(t, u2, { reports: 2, used: 2 });
    expect(await code(createReportFromAnalysis(t.app, u2, (await readyAnalysis(t, u2)).analysisId))).toBe('plan_used_up');

    const u3 = await makeUser(t);
    await givePlan(t, u3, { files: 2 });
    expect(await code(createReportFromAnalysis(t.app, u3, (await readyAnalysis(t, u3, { files: 3 })).analysisId))).toBe('too_many_files');
  });

  it('uses the plan that ends first', async () => {
    const u = await makeUser(t);
    const later = await givePlan(t, u, { days: 300 });
    const sooner = await givePlan(t, u, { days: 10 });
    const id = await createReportFromAnalysis(t.app, u, (await readyAnalysis(t, u)).analysisId);
    expect((await t.admin.query('select subscription_id from reports where id = $1', [id])).rows[0].subscription_id).toBe(sooner);
    expect((await userPlans(t.app, u)).find((p) => p.id === later)!.reports_used).toBe(0);
  });

  it('refuses: already claimed, another user\'s analysis, not ready, expired draft', async () => {
    const u = await makeUser(t), other = await makeUser(t);
    await givePlan(t, u); await givePlan(t, other);
    const { analysisId } = await readyAnalysis(t, u);
    expect(await code(createReportFromAnalysis(t.app, other, analysisId))).toBe('analysis_not_found');
    await createReportFromAnalysis(t.app, u, analysisId);
    expect(await code(createReportFromAnalysis(t.app, u, analysisId))).toBe('already_claimed');

    const queued = await readyAnalysis(t, u);
    await t.admin.query(`update analyses set status = 'analysing' where id = $1`, [queued.analysisId]);
    expect(await code(createReportFromAnalysis(t.app, u, queued.analysisId))).toBe('analysis_not_ready');

    const old = await readyAnalysis(t, u);
    await t.admin.query(`update analyses set expires_at = now() - interval '1 minute' where id = $1`, [old.analysisId]);
    expect(await code(createReportFromAnalysis(t.app, u, old.analysisId))).toBe('analysis_expired');
  });

  it('race: two claims for the last report in a plan — exactly one wins', async () => {
    const u = await makeUser(t);
    const sub = await givePlan(t, u, { reports: 1 });
    const a1 = await readyAnalysis(t, u), a2 = await readyAnalysis(t, u);
    const c1 = createDb({ connectionString: t.appUrl, max: 1, ssl: false }), c2 = createDb({ connectionString: t.appUrl, max: 1, ssl: false });
    try {
      const results = await Promise.all([code(createReportFromAnalysis(c1.db, u, a1.analysisId)), code(createReportFromAnalysis(c2.db, u, a2.analysisId))]);
      expect(results.sort()).toEqual(['ok', 'plan_used_up']);
      expect((await t.admin.query('select reports_used from subscriptions where id = $1', [sub])).rows[0].reports_used).toBe(1);
    } finally { await c1.db.destroy(); await c2.db.destroy(); }
  });

  it('race: the same analysis claimed twice at once — one report only', async () => {
    const u = await makeUser(t);
    const sub = await givePlan(t, u, { reports: 5 });
    const a = await readyAnalysis(t, u);
    const c1 = createDb({ connectionString: t.appUrl, max: 1, ssl: false }), c2 = createDb({ connectionString: t.appUrl, max: 1, ssl: false });
    try {
      const results = await Promise.all([code(createReportFromAnalysis(c1.db, u, a.analysisId)), code(createReportFromAnalysis(c2.db, u, a.analysisId))]);
      expect(results.sort()).toEqual(['already_claimed', 'ok']);
      expect((await t.admin.query('select reports_used from subscriptions where id = $1', [sub])).rows[0].reports_used).toBe(1);
    } finally { await c1.db.destroy(); await c2.db.destroy(); }
  });

  it('a blocked user cannot create reports', async () => {
    const u = await makeUser(t);
    await givePlan(t, u);
    const { analysisId } = await readyAnalysis(t, u);
    await t.admin.query(`update users set status = 'blocked' where id = $1`, [u]);
    expect(await code(createReportFromAnalysis(t.app, u, analysisId))).toBe('user_blocked');
  });

  it('rename is limited to the owner and to the title', async () => {
    const u = await makeUser(t), other = await makeUser(t);
    await givePlan(t, u);
    const id = await createReportFromAnalysis(t.app, u, (await readyAnalysis(t, u)).analysisId);
    expect(await renameReport(t.app, other, id, 'hack')).toBe(false);
    expect(await renameReport(t.app, u, id, 'Renamed')).toBe(true);
    expect(await renameReport(t.app, u, id, '   ')).toBe(true);
    expect((await getReport(t.app, u, id))!.title).toBeNull();
  });
});

describe.skipIf(!ok)('file-set lock (add_analysis_to_report)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_fileset'); });
  afterAll(async () => { await t?.close(); });

  it('adds statements up to the plan limit, never frees a place, and re-adding the same statement is fine', async () => {
    const u = await makeUser(t);
    const sub = await givePlan(t, u, { files: 2 });
    const first = await readyAnalysis(t, u, { files: 1, fingerprints: ['fpA'] });
    const report = await createReportFromAnalysis(t.app, u, first.analysisId);
    const fileA = first.fileIds[0];

    // "+": add B -> A + B analysed together
    const ab = await readyAnalysis(t, u, { files: 1, fingerprints: ['fpB'], existingFileIds: [fileA], targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, ab.analysisId))).toBe('ok');
    let r = (await t.admin.query('select used_fingerprints, file_names, analysis_id from reports where id = $1', [report])).rows[0];
    expect([...r.used_fingerprints].sort()).toEqual(['fpA', 'fpB']);
    expect(r.file_names).toHaveLength(2);
    expect(r.analysis_id).toBe(ab.analysisId);

    // a third, different statement is refused
    const abc = await readyAnalysis(t, u, { files: 1, fingerprints: ['fpC'], existingFileIds: [fileA], targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, abc.analysisId))).toBe('report_files_full');

    // remove B (re-analyse A alone): allowed, but B's place stays used
    const aOnly = await readyAnalysis(t, u, { files: 0, existingFileIds: [fileA], targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, aOnly.analysisId))).toBe('ok');
    r = (await t.admin.query('select used_fingerprints, file_names from reports where id = $1', [report])).rows[0];
    expect(r.file_names).toHaveLength(1);
    expect([...r.used_fingerprints].sort()).toEqual(['fpA', 'fpB']);
    const ac = await readyAnalysis(t, u, { files: 1, fingerprints: ['fpC'], existingFileIds: [fileA], targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, ac.analysisId))).toBe('report_files_full');

    // a renamed / re-saved copy of B (same trade fingerprint) comes back fine
    const bAgain = await readyAnalysis(t, u, { files: 1, fingerprints: ['fpB'], existingFileIds: [fileA], targetReportId: report });
    expect(await code(addAnalysisToReport(t.app, u, report, bAgain.analysisId))).toBe('ok');

    // none of this spent a report
    expect((await t.admin.query('select reports_used from subscriptions where id = $1', [sub])).rows[0].reports_used).toBe(1);
  });

  it('only for the report the upload targeted, and only the owner', async () => {
    const u = await makeUser(t), other = await makeUser(t);
    await givePlan(t, u); await givePlan(t, other);
    const r1 = await createReportFromAnalysis(t.app, u, (await readyAnalysis(t, u)).analysisId);
    const r2 = await createReportFromAnalysis(t.app, u, (await readyAnalysis(t, u)).analysisId);
    const forR1 = await readyAnalysis(t, u, { targetReportId: r1 });
    expect(await code(addAnalysisToReport(t.app, u, r2, forR1.analysisId))).toBe('analysis_targets_other_report');
    expect(await code(createReportFromAnalysis(t.app, u, forR1.analysisId))).toBe('analysis_targets_report');
    expect(await code(addAnalysisToReport(t.app, other, r1, forR1.analysisId))).toBe('analysis_not_found');
  });

  it('an analysis cannot read another user\'s file (composite keys)', async () => {
    const u = await makeUser(t), other = await makeUser(t);
    const mine = await readyAnalysis(t, u);
    await expect(readyAnalysis(t, other, { existingFileIds: [mine.fileIds[0]] })).rejects.toThrow(/foreign key/);
  });
});

describe.skipIf(!ok)('plan grants', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_grants'); });
  afterAll(async () => { await t?.close(); });

  it('owner-only manual grant: role checked in the DB, reason required, audited (D5)', async () => {
    const owner = await makeUser(t, { role: 'owner' }), admin = await makeUser(t, { role: 'admin' }), u = await makeUser(t);
    const g = { userId: u, plan: 'snapshot' as const, reports: 5, filesPerReport: 3, days: 92, reason: 'Support case #12' };
    expect(await code(adminGrantPlan(t.app, { ...g, actorId: admin }))).toBe('forbidden');
    expect(await code(adminGrantPlan(t.app, { ...g, actorId: owner, reason: '  ' }))).toBe('reason_required');
    expect(await code(adminGrantPlan(t.app, { ...g, actorId: owner, filesPerReport: 9 }))).toBe('invalid_plan');
    expect(await code(adminGrantPlan(t.app, { ...g, actorId: owner, userId: '00000000-0000-0000-0000-000000000999' }))).toBe('unknown_user');

    const before = (await t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [u])).rows[0].n;
    const id = await adminGrantPlan(t.app, { ...g, actorId: owner });
    const s = (await t.admin.query('select * from subscriptions where id = $1', [id])).rows[0];
    expect(s).toMatchObject({ user_id: u, plan_id: 'snapshot', reports_total: 5, files_per_report: 3, granted_by: owner, grant_reason: 'Support case #12', payment_id: null });
    expect(before).toBe(0);   // the refused attempts above wrote nothing
    const days = (await t.admin.query(`select round(extract(epoch from ends_at - now()) / 86400)::int as d from subscriptions where id = $1`, [id])).rows[0].d;
    expect(days).toBe(92);    // Snapshot: 3 months (REQ-3)
    const audit = (await t.admin.query(`select meta from audit_log where action = 'plan_granted_manual' and user_id = $1`, [u])).rows;
    expect(audit.at(-1)!.meta).toMatchObject({ actor: owner, reason: 'Support case #12', plan: 'snapshot' });
  });

  it('the webhook grant (grant_plan) stays idempotent on replay', async () => {
    const u = await makeUser(t);
    await t.admin.query(`insert into payments (user_id, gateway_order_id, amount_minor, currency, plan_id) values ($1, 'order_x', 49900, 'INR', 'snapshot')`, [u]);
    const g1 = await asRole(t, 'lens_app', `select grant_plan('order_x', 'pay_x', '{}'::jsonb, 5, 3, 92) as ok`);
    const g2 = await asRole(t, 'lens_app', `select grant_plan('order_x', 'pay_x', '{}'::jsonb, 5, 3, 92) as ok`);
    expect([g1[0].ok, g2[0].ok]).toEqual([true, false]);
    const days = (await t.admin.query(`select round(extract(epoch from ends_at - now()) / 86400)::int as d from subscriptions where user_id = $1`, [u])).rows[0].d;
    expect(days).toBe(92);    // the plan's days from PLANS decide the end date
    expect((await t.admin.query('select count(*)::int as n from subscriptions where user_id = $1', [u])).rows[0].n).toBe(1);
  });

  it('a subscription must have a source: a payment or a recorded reason', async () => {
    const u = await makeUser(t);
    await expect(t.admin.query(`insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at) values ($1, 'single', 1, 2, now() + interval '7 days')`, [u]))
      .rejects.toThrow(/subscriptions_has_source/);
  });
});
