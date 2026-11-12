/**
 * @file  packages/db/test/db/plan-snapshots.test.ts
 * @area  Tests
 * @what  Plan snapshots (0026): app may save and read but not change; one per report and day; the check-up picks the newest plan made before a report; closing the account removes plans and reminders.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { savePlanSnapshot, planToCheck } from '../../src/queries/plan-snapshots.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('plan snapshots (0026)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_plan_snapshots'); });
  afterAll(async () => { await t?.close(); });
  const report = async (user: string, createdAt: string, title: string) =>
    (await t.admin.query(`insert into reports (user_id, title, file_names, file_hashes, expires_at, created_at) values ($1, $2, '{a.csv}', '{h}', 'infinity', $3) returning id`, [user, title, createdAt])).rows[0].id as string;
  const plan = (on: string, tag: string) => ({ generatedAt: on, checkupOn: on, dos: [{ id: tag }], donts: [] });

  it('the app saves and reads snapshots but cannot change or delete them; one per report and day', async () => {
    const u = await makeUser(t), r = await report(u, '2026-09-01T10:00:00Z', 'Sep');
    await savePlanSnapshot(t.app, u, r, plan('2026-09-02', 'first'));
    await savePlanSnapshot(t.app, u, r, plan('2026-09-02', 'second'));
    const rows = (await t.admin.query('select plan from plan_snapshots where user_id = $1', [u])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].plan.dos[0].id).toBe('first');
    await expectPgError(asRole(t, 'lens_app', `update plan_snapshots set plan = '{}'`), '42501');
    await expectPgError(asRole(t, 'lens_app', `delete from plan_snapshots`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `select * from plan_snapshots`), '42501');
  });

  it('a report checks the newest plan made before it, never its own', async () => {
    const u = await makeUser(t);
    const sep = await report(u, '2026-09-01T10:00:00Z', 'Sep'), oct = await report(u, '2026-10-05T10:00:00Z', 'Oct'), nov = await report(u, '2026-11-06T10:00:00Z', 'Nov');
    expect(await planToCheck(t.app, u, oct, new Date('2026-10-05T10:00:00Z'))).toBeNull();
    await savePlanSnapshot(t.app, u, sep, plan('2026-09-03', 'from-sep'));
    await savePlanSnapshot(t.app, u, oct, plan('2026-10-06', 'from-oct'));
    const forOct = await planToCheck(t.app, u, oct, new Date('2026-10-05T10:00:00Z'));
    expect(forOct).toMatchObject({ reportId: sep, generatedOn: '2026-09-03', reportName: 'Sep' });   // a user-given title
    expect(forOct!.plan.dos[0].id).toBe('from-sep');
    const forNov = await planToCheck(t.app, u, nov, new Date('2026-11-06T10:00:00Z'));
    expect(forNov).toMatchObject({ reportId: oct, generatedOn: '2026-10-06' });
    expect(await planToCheck(t.app, await makeUser(t), nov, new Date('2026-11-06T10:00:00Z'))).toBeNull();   // another user's plans never count
  });

  it('closing the account removes the plans and the check-up reminder', async () => {
    const u = await makeUser(t), r = await report(u, '2026-09-01T10:00:00Z', 'Sep');
    await savePlanSnapshot(t.app, u, r, plan('2026-09-02', 'x'));
    await t.admin.query(`insert into plan_reminders (user_id, report_id, remind_on) values ($1, $2, '2030-01-01')`, [u, r]);
    await t.admin.query('select delete_account($1)', [u]);
    expect((await t.admin.query('select count(*)::int n from plan_snapshots where user_id = $1', [u])).rows[0].n).toBe(0);
    expect((await t.admin.query('select count(*)::int n from plan_reminders where user_id = $1', [u])).rows[0].n).toBe(0);
  });
});
