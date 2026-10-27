/**
 * @file  packages/db/test/db/research-links.test.ts
 * @area  Tests
 * @what  Research links (0025): worker may insert but not read report links; research_lookup is owner-only, needs a reason, needs the dataset for report codes, audits every lookup, shows deleted accounts as deleted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('research links (0025)', () => {
  let t: TestDb; let owner: string, user: string, report: string, exp: string, subject: string;
  const code = 'a1b2c3d4e5f6a1b2c3d4e5f6';
  beforeAll(async () => {
    t = await freshDb('t_research_links');
    owner = await makeUser(t, { role: 'owner' }); user = await makeUser(t);
    report = (await t.admin.query(`insert into reports (user_id, title, file_names, file_hashes, expires_at) values ($1, 'Q3 review', '{a.csv}', '{h}', 'infinity') returning id`, [user])).rows[0].id;
    exp = (await t.admin.query(`insert into research_exports (status) values ('ready') returning id`)).rows[0].id;
    await asRole(t, 'lens_worker', `insert into research_export_reports (export_id, report, report_id) values ($1, $2, $3)`, [exp, code, report]);
    subject = (await t.admin.query(`select encode(hmac(convert_to($1::text, 'UTF8'), k.key, 'sha256'), 'hex') s from research.pseudonym_key k`, [user])).rows[0].s;
  });
  afterAll(async () => { await t?.close(); });
  const lookup = (actor: string, c: string, e: string | null, reason = 'support ticket') =>
    asRole(t, 'lens_app', 'select * from research_lookup($1, $2, $3, $4)', [actor, c, e, reason]);
  const audits = async () => (await t.admin.query(`select count(*)::int n from audit_log where action = 'research_lookup'`)).rows[0].n as number;

  it('links: the worker may insert but not read; the app has no access; codes must be 24 hex', async () => {
    await expectPgError(asRole(t, 'lens_worker', 'select * from research_export_reports'), '42501');
    await expectPgError(asRole(t, 'lens_app', 'select * from research_export_reports'), '42501');
    await expectPgError(asRole(t, 'lens_app', `insert into research_export_reports values ($1, $2, $3)`, [exp, 'b'.repeat(24), report]), '42501');
    await expectPgError(t.admin.query(`insert into research_export_reports values ($1, 'NOT-HEX', $2)`, [exp, report]), '23514');
  });

  it('only an active owner may look up; a reason is required; a report code needs its dataset', async () => {
    for (const role of ['admin', 'support', 'finance', 'analyst', 'user'] as const) await expectPgError(lookup(await makeUser(t, { role }), subject, null), '42501');
    expect((await expectPgError(lookup(owner, subject, null, ' x '), 'P0001')).message).toBe('reason_required');
    expect((await expectPgError(lookup(owner, code, null), 'P0001')).message).toBe('export_required');
    expect((await expectPgError(lookup(owner, 'xyz', null), 'P0001')).message).toBe('invalid_code');
  });

  it('subject and report codes resolve to the account and report; every lookup is audited, found or not', async () => {
    const before = await audits();
    expect(await lookup(owner, subject.toUpperCase(), null)).toEqual([expect.objectContaining({ kind: 'subject', user_id: user, user_status: 'active', report_id: null })]);
    expect(await lookup(owner, code, exp)).toEqual([expect.objectContaining({ kind: 'report', user_id: user, report_id: report, report_name: 'Q3 review', report_deleted: false })]);
    expect(await lookup(owner, 'f'.repeat(64), null)).toEqual([]);
    expect(await lookup(owner, code, owner)).toEqual([]);              // wrong dataset id
    expect(await audits()).toBe(before + 4);
    const last = (await t.admin.query(`select user_id, meta from audit_log where action = 'research_lookup' order by id desc limit 1`)).rows[0];
    expect(last).toMatchObject({ user_id: owner, meta: { kind: 'report', reason: 'support ticket', found: null } });
  });

  it('a deleted account resolves as deleted (anonymised email), never hidden', async () => {
    await t.admin.query('select delete_account($1)', [user]);
    const [r] = await lookup(owner, code, exp);
    expect(r).toMatchObject({ user_id: user, user_status: 'deleted' });
  });
});
