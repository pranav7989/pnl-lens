/**
 * @file  packages/db/test/db/digest.test.ts
 * @area  Tests
 * @what  Weekly summary (0029): opt-in off by default, the app may switch it, one send per user and week, closing the account turns it off and clears the sends.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('weekly summary (0029)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_digest'); });
  afterAll(async () => { await t?.close(); });

  it('off by default; the app may switch it; one send per user and week; the worker has no access', async () => {
    const u = await makeUser(t);
    expect((await t.admin.query('select weekly_digest from users where id = $1', [u])).rows[0].weekly_digest).toBe(false);
    await asRole(t, 'lens_app', 'update users set weekly_digest = true where id = $1', [u]);
    await asRole(t, 'lens_app', `insert into digest_sends (user_id, week_start) values ($1, '2026-10-26')`, [u]);
    await expectPgError(asRole(t, 'lens_app', `insert into digest_sends (user_id, week_start) values ($1, '2026-10-26')`, [u]), '23505');
    await expectPgError(asRole(t, 'lens_app', 'delete from digest_sends'), '42501');
    await expectPgError(asRole(t, 'lens_worker', 'select * from digest_sends'), '42501');
  });

  it('closing the account turns it off and clears the sends', async () => {
    const u = await makeUser(t);
    await t.admin.query('update users set weekly_digest = true where id = $1', [u]);
    await t.admin.query(`insert into digest_sends (user_id, week_start) values ($1, '2026-10-26')`, [u]);
    await t.admin.query('select delete_account($1)', [u]);
    expect((await t.admin.query('select weekly_digest from users where id = $1', [u])).rows[0].weekly_digest).toBe(false);
    expect((await t.admin.query('select count(*)::int n from digest_sends where user_id = $1', [u])).rows[0].n).toBe(0);
  });
});
