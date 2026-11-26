/**
 * @file  packages/db/test/db/capital.test.ts
 * @area  Tests
 * @what  Report capital (0028): set and clear by the owner only, limits enforced, app may update only that column (and title), included in "Export my data".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setReportCapital, getReport } from '../../src/queries/reports.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('report capital (0028)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_capital'); });
  afterAll(async () => { await t?.close(); });
  const report = async (u: string) => (await t.admin.query(`insert into reports (user_id, file_names, file_hashes, expires_at) values ($1, '{a.csv}', '{h}', 'infinity') returning id`, [u])).rows[0].id as string;

  it('owner sets and clears it; another user cannot', async () => {
    const u = await makeUser(t), other = await makeUser(t), r = await report(u);
    expect(await setReportCapital(t.app, u, r, 500000.456)).toBe(true);
    expect(Number((await getReport(t.app, u, r))!.capital)).toBe(500000.46);
    expect(await setReportCapital(t.app, other, r, 1)).toBe(false);
    expect(await setReportCapital(t.app, u, r, null)).toBe(true);
    expect((await getReport(t.app, u, r))!.capital).toBeNull();
  });

  it('limits and grants', async () => {
    const u = await makeUser(t), r = await report(u);
    await expectPgError(t.admin.query('update reports set capital = 0 where id = $1', [r]), '23514');
    await expectPgError(t.admin.query('update reports set capital = -5 where id = $1', [r]), '23514');
    await asRole(t, 'lens_app', 'update reports set capital = 1000 where id = $1', [r]);
    await expectPgError(asRole(t, 'lens_app', 'update reports set trade_count = 1 where id = $1', [r]), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'update reports set capital = 5 where id = $1', [r]), '42501');
  });

  it('"Export my data" includes it', async () => {
    const u = await makeUser(t), r = await report(u);
    await setReportCapital(t.app, u, r, 250000);
    const req = (await t.admin.query(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u])).rows[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.report_capital).toEqual([{ report: r, capital: 250000 }]);
    expect(row.d.journal).toEqual([]);
  });
});
