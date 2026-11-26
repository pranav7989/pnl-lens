/**
 * @file  packages/db/test/db/founding.test.ts
 * @area  Tests
 * @what  Founding trader numbers (0032): given once and in order, on a paid plan or a manual grant marked founding, never to staff or test accounts, never past 1000, no gaps after a rolled-back grant; reset only before the first paid order; in the data export; app roles cannot touch the counter.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminGrantPlan, adminSetTestAccount } from '../../src/queries/plans.js';
import { DbError } from '../../src/errors.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, runScript, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { if (e instanceof DbError) return e.code; throw e; } };

describe.skipIf(!ok)('founding traders (0032)', () => {
  let t: TestDb; let owner: string;
  beforeAll(async () => { t = await freshDb('t_founding'); owner = await makeUser(t, { role: 'owner' }); });
  afterAll(async () => { await t?.close(); });
  const no = async (u: string) => (await t.admin.query('select founding_no from users where id = $1', [u])).rows[0].founding_no as number | null;
  const grant = (u: string, founding?: boolean) => adminGrantPlan(t.app, { actorId: owner, userId: u, plan: 'snapshot', reports: 5, filesPerReport: 3, days: 30, reason: 'tester', founding });
  let order = 0;
  const pay = async (u: string) => {
    const id = `order_f${++order}`;
    await t.admin.query(`insert into payments (user_id, gateway_order_id, amount_minor, currency, plan_id) values ($1, $2, 49900, 'INR', 'snapshot')`, [u, id]);
    await asRole(t, 'lens_app', `select public.grant_plan($1, $2, '{}'::jsonb, 5, 3, 30)`, [id, `pay_${id}`]);
  };

  it('a manual grant gives a number only when marked founding; once; never to staff or test accounts', async () => {
    const a = await makeUser(t), b = await makeUser(t), staff = await makeUser(t, { role: 'admin' }), tester = await makeUser(t);
    await grant(a);
    expect(await no(a)).toBeNull();
    await grant(a, true);
    expect(await no(a)).toBe(1);
    await grant(a, true);
    expect(await no(a)).toBe(1);                                   // never a second number
    await grant(staff, true);
    expect(await no(staff)).toBeNull();
    await adminSetTestAccount(t.app, owner, tester, true);
    await grant(tester, true);
    expect(await no(tester)).toBeNull();
    await grant(b, true);
    expect(await no(b)).toBe(2);                                   // in order, staff and tester skipped no number
    const audit = (await t.admin.query(`select meta from audit_log where action = 'founding_no_assigned' order by id`)).rows.map((r) => r.meta.no);
    expect(audit).toEqual([1, 2]);
  });

  it('only the owner marks test accounts; audited', async () => {
    const u = await makeUser(t), admin = await makeUser(t, { role: 'admin' });
    expect(await code(adminSetTestAccount(t.app, admin, u, true))).toBe('forbidden');
    await adminSetTestAccount(t.app, owner, u, true);
    expect((await t.admin.query('select is_test from users where id = $1', [u])).rows[0].is_test).toBe(true);
    expect((await t.admin.query(`select meta from audit_log where action = 'test_account_set' and user_id = $1`, [u])).rows[0].meta).toMatchObject({ actor: owner, is_test: true });
  });

  it('a rolled-back grant leaves no gap', async () => {
    const u = await makeUser(t), v = await makeUser(t);
    await t.admin.query('begin');
    try {
      await t.admin.query(`select public.admin_grant_plan($1, $2, 'snapshot', 5, 3, 30, 'tester', true)`, [owner, u]);
      expect((await t.admin.query('select founding_no from users where id = $1', [u])).rows[0].founding_no).toBe(3);
    } finally { await t.admin.query('rollback'); }
    expect(await no(u)).toBeNull();
    await grant(v, true);
    expect(await no(v)).toBe(3);
  });

  it('reset clears numbers and restarts at 1, but only before the first paid order', async () => {
    expect(runScript('reset-founding.mjs', t.name)).toMatch(/founding numbers given: 3 .*dry run/s);   // without --yes nothing changes
    expect((await t.admin.query('select count(*)::int as n from users where founding_no is not null')).rows[0].n).toBe(3);
    expect((await t.admin.query('select public.reset_founding_numbers() as n')).rows[0].n).toBe(3);
    const u = await makeUser(t);
    await grant(u, true);
    expect(await no(u)).toBe(1);
    await t.admin.query('select public.reset_founding_numbers()');
  });

  it('a paid plan always gives a number (first plan only); then reset is refused', async () => {
    const u = await makeUser(t), w = await makeUser(t);
    await grant(u);                                                // an earlier manual grant that did not count
    await pay(u);
    expect(await no(u)).toBe(1);
    await pay(u);
    expect(await no(u)).toBe(1);
    await pay(w);
    expect(await no(w)).toBe(2);
    await expectPgError(t.admin.query('select public.reset_founding_numbers()'), 'P0001');
    expect(await no(u)).toBe(1);
  });

  it('never past 1000', async () => {
    await t.admin.query('update founding_counter set last = 999');
    const a = await makeUser(t), b = await makeUser(t);
    await pay(a); await pay(b);
    expect(await no(a)).toBe(1000);
    expect(await no(b)).toBeNull();
    expect((await t.admin.query('select last from founding_counter')).rows[0].last).toBe(1000);
  });

  it('"Export my data" includes the number', async () => {
    const u = await makeUser(t);
    await t.admin.query('update founding_counter set last = 500');            // the test before used up the numbers
    await grant(u, true);
    expect(await no(u)).toBe(501);
    const req = (await t.admin.query(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u])).rows[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.founding_trader).toBe(await no(u));
    expect(row.d.report_capital).toEqual([]);
  });

  it('app roles cannot assign, reset or touch the counter', async () => {
    const u = await makeUser(t);
    for (const role of ['lens_app', 'lens_worker']) {
      await expectPgError(asRole(t, role, 'select public.assign_founding_no($1)', [u]), '42501');
      await expectPgError(asRole(t, role, 'select public.reset_founding_numbers()'), '42501');
      await expectPgError(asRole(t, role, 'update founding_counter set last = 0'), '42501');
    }
    await expectPgError(asRole(t, 'lens_app', `update users set founding_no = 5 where id = $1`, [u]), '42501');
    await expectPgError(asRole(t, 'lens_app', `update users set is_test = true where id = $1`, [u]), '42501');
    await expectPgError(asRole(t, 'lens_app', `insert into users (email, country, founding_no) values ('x@t.local', 'IN', 7)`), '42501');
    await asRole(t, 'lens_app', `update users set weekly_digest = true where id = $1`, [u]);   // other columns unaffected
  });
});
