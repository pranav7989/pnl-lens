/**
 * @file  packages/db/test/db/plan-reminders.test.ts
 * @area  Tests
 * @what  Check-up reminders (0024): one active per user, lens_app may only cancel (not change dates or mark sent), worker has no access, claim is once-only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setReminder, activeReminder, cancelReminder, dueReminders, markReminderSent } from '../../src/queries/reminders.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('plan reminders (0024)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_plan_reminders'); });
  afterAll(async () => { await t?.close(); });

  it('one active reminder per user; set replaces, cancel ends it', async () => {
    const u = await makeUser(t);
    const a = await setReminder(t.app, u, null, '2030-01-10');
    const b = await setReminder(t.app, u, null, '2030-01-11');
    expect((await activeReminder(t.app, u))).toMatchObject({ id: b.id, remindOn: '2030-01-11' });
    expect(a.id).not.toBe(b.id);
    await expectPgError(t.admin.query(`insert into plan_reminders (user_id, remind_on) values ($1, '2030-02-01')`, [u]), '23505');
    expect(await cancelReminder(t.app, u, b.id)).toBe(true);
    expect(await cancelReminder(t.app, u, b.id)).toBe(false);
    expect(await activeReminder(t.app, u)).toBeNull();
  });

  it('lens_app cannot move a date or mark a reminder sent; lens_worker cannot read reminders or call the functions', async () => {
    const u = await makeUser(t);
    await setReminder(t.app, u, null, '2030-03-01');
    await expectPgError(asRole(t, 'lens_app', `update plan_reminders set remind_on = '2030-01-01'`), '42501');
    await expectPgError(asRole(t, 'lens_app', `update plan_reminders set sent_at = now()`), '42501');
    await expectPgError(asRole(t, 'lens_app', `delete from plan_reminders`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `select * from plan_reminders`), '42501');
    await expectPgError(asRole(t, 'lens_worker', `select * from due_plan_reminders(10)`), '42501');
  });

  it('due list holds only due, unsent, active accounts; a claim succeeds once', async () => {
    const u = await makeUser(t), blocked = await makeUser(t);
    await t.admin.query(`update users set status = 'blocked' where id = $1`, [blocked]);
    await t.admin.query(`insert into plan_reminders (user_id, remind_on) values ($1, current_date - 1), ($2, current_date - 1)`, [u, blocked]);
    const email = async (id: string) => (await t.admin.query('select email from users where id = $1', [id])).rows[0].email as string;
    const due = await dueReminders(t.app);
    expect(due.some((d) => d.remindOn.startsWith('2030'))).toBe(false);
    const blockedEmail = await email(blocked), myEmail = await email(u);
    expect(due.map((d) => d.email)).not.toContain(blockedEmail);
    const id = due.find((d) => d.email === myEmail)!.id;
    expect(await markReminderSent(t.app, id)).toBe(true);
    expect(await markReminderSent(t.app, id)).toBe(false);
    expect((await dueReminders(t.app)).some((d) => d.id === id)).toBe(false);
  });
});
