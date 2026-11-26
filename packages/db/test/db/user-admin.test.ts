/**
 * @file  packages/db/test/db/user-admin.test.ts
 * @area  Tests
 * @what  User management functions (0022): who may restrict or delete whom, sessions end on restrict, delete anonymises, audit rows; research_invites grants.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminSetUserStatus, adminDeleteUser } from '../../src/queries/users-admin.js';
import { DbError } from '../../src/errors.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { if (e instanceof DbError) return e.code; throw e; } };

describe.skipIf(!ok)('user management (0022)', () => {
  let t: TestDb; let owner: string, owner2: string, admin: string, admin2: string;
  beforeAll(async () => {
    t = await freshDb('t_user_admin');
    owner = await makeUser(t, { role: 'owner' }); owner2 = await makeUser(t, { role: 'owner' });
    admin = await makeUser(t, { role: 'admin' }); admin2 = await makeUser(t, { role: 'admin' });
  });
  afterAll(async () => { await t?.close(); });
  const row = async (id: string) => (await t.admin.query('select status, restricted_reason, restricted_by, sessions_valid_after, email from users where id = $1', [id])).rows[0];

  it('only owner and admin may restrict; nobody restricts themselves or an owner; admins not other admins', async () => {
    const u = await makeUser(t);
    for (const role of ['support', 'finance', 'analyst'] as const) expect(await code(adminSetUserStatus(t.app, await makeUser(t, { role }), u, 'blocked', 'spam'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, await makeUser(t), u, 'blocked', 'spam'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, admin, admin, 'blocked', 'self'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, admin, owner, 'blocked', 'nope'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, admin, admin2, 'blocked', 'nope'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, owner, owner2, 'blocked', 'nope'))).toBe('forbidden');
    expect(await code(adminSetUserStatus(t.app, admin, u, 'blocked', ''))).toBe('reason_required');
  });

  it('restrict blocks the account, ends its sessions and is audited; unrestrict restores it', async () => {
    const u = await makeUser(t);
    await adminSetUserStatus(t.app, admin, u, 'blocked', 'Chargeback abuse');
    const r = await row(u);
    expect(r).toMatchObject({ status: 'blocked', restricted_reason: 'Chargeback abuse', restricted_by: admin });
    expect(r.sessions_valid_after).not.toBeNull();
    await adminSetUserStatus(t.app, owner, u, 'active', null);
    expect(await row(u)).toMatchObject({ status: 'active', restricted_reason: null });
    const audit = (await t.admin.query(`select action, meta->>'by' as by from audit_log where user_id = $1 order by id`, [u])).rows;
    expect(audit).toEqual([{ action: 'user_restricted', by: admin }, { action: 'user_unrestricted', by: owner }]);
  });

  it('delete: owner only, with a reason; anonymises the account and records who and why', async () => {
    const u = await makeUser(t);
    expect(await code(adminDeleteUser(t.app, admin, u, 'requested by email'))).toBe('forbidden');
    expect(await code(adminDeleteUser(t.app, owner, owner2, 'nope'))).toBe('forbidden');
    expect(await code(adminDeleteUser(t.app, owner, owner, 'nope'))).toBe('forbidden');
    expect(await code(adminDeleteUser(t.app, owner, u, ''))).toBe('reason_required');
    await adminDeleteUser(t.app, owner, u, 'Requested by email on 19 Oct');
    const r = await row(u);
    expect(r.status).toBe('deleted'); expect(r.email).toMatch(/^deleted\+.*@deleted\.invalid$/);
    const audit = (await t.admin.query(`select action, meta from audit_log where user_id = $1 order by id`, [u])).rows.map((a) => a.action);
    expect(audit).toEqual(['user_deleted_by_admin', 'account_deleted']);
    expect(await code(adminDeleteUser(t.app, owner, u, 'again'))).toBe('not_found');
  });

  it('research_invites: the app may create and answer invites but not change who they are for', async () => {
    const u = await makeUser(t);
    await asRole(t, 'lens_app', `insert into research_invites (user_id, sent_by, token_sha256) values ('${u}', '${owner}', repeat('a', 64))`);
    await asRole(t, 'lens_app', `update research_invites set answered_at = now(), answer = true where user_id = '${u}'`);
    await expectPgError(asRole(t, 'lens_app', `update research_invites set user_id = '${owner}'`), '42501');
    await expectPgError(asRole(t, 'lens_app', `delete from research_invites`), '42501');
  });
});
