/**
 * @file  packages/db/test/db/journal.test.ts
 * @area  Tests
 * @what  Trade journal (0027): save, update, empty = removed, one per trade, app grants (no access for the worker or research), included in "Export my data" with the 30-day plans and reminders, removed when the account is closed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { saveNote, listNotes, deleteNote } from '../../src/queries/journal.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('trade journal (0027)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_journal'); });
  afterAll(async () => { await t?.close(); });

  it('save, update, list; an empty note is removed; tags are cleaned', async () => {
    const u = await makeUser(t);
    const a = await saveNote(t.app, u, { tradeKey: 'NIFTY|2025-01-02', setup: ' Breakout ', tags: ['Plan', 'plan', ' late '], emotion: 'calm', note: 'ok' });
    expect(a).toMatchObject({ setup: 'Breakout', tags: ['plan', 'late'], emotion: 'calm', note: 'ok' });
    await saveNote(t.app, u, { tradeKey: 'NIFTY|2025-01-02', setup: 'Gap fill', tags: [], emotion: null, note: null });
    expect((await listNotes(t.app, u))).toEqual([expect.objectContaining({ tradeKey: 'NIFTY|2025-01-02', setup: 'Gap fill', tags: [] })]);
    expect(await saveNote(t.app, u, { tradeKey: 'NIFTY|2025-01-02', setup: '', tags: [], emotion: null, note: '  ' })).toBeNull();
    expect(await listNotes(t.app, u)).toEqual([]);
    expect(await deleteNote(t.app, u, 'NIFTY|2025-01-02')).toBe(false);
  });

  it('grants: app reads and writes its rows; worker cannot read; bad values are refused', async () => {
    const u = await makeUser(t);
    await saveNote(t.app, u, { tradeKey: 'K|1', setup: 'A' });
    await expectPgError(asRole(t, 'lens_worker', 'select * from trade_notes'), '42501');
    await expectPgError(asRole(t, 'lens_app', `update trade_notes set user_id = gen_random_uuid()`), '42501');
    await expectPgError(t.admin.query(`insert into trade_notes (user_id, trade_key, emotion) values ($1, 'K|2', 'angry')`, [u]), '23514');
    await expectPgError(t.admin.query(`insert into trade_notes (user_id, trade_key, tags) values ($1, 'K|3', '{a,b,c,d,e,f,g,h,i}')`, [u]), '23514');
  });

  it('"Export my data" includes the journal, 30-day plans and reminders; the old base is not callable by the worker', async () => {
    const u = await makeUser(t);
    await saveNote(t.app, u, { tradeKey: 'K|9', setup: 'Breakout', note: 'mine' });
    await t.admin.query(`insert into plan_snapshots (user_id, generated_on, checkup_on, plan) values ($1, '2026-10-01', '2026-10-31', '{"dos":[]}')`, [u]);
    await t.admin.query(`insert into plan_reminders (user_id, remind_on) values ($1, '2026-10-31')`, [u]);
    const req = (await t.admin.query(`insert into data_requests (user_id, kind, status) values ($1, 'export', 'processing') returning id`, [u])).rows[0].id;
    const [row] = await asRole(t, 'lens_worker', 'select public.export_user_data($1) as d', [req]);
    expect(row.d.journal).toEqual([expect.objectContaining({ trade: 'K|9', setup: 'Breakout', note: 'mine' })]);
    expect(row.d.thirty_day_plans).toHaveLength(1);
    expect(row.d.checkup_reminders).toHaveLength(1);
    expect(row.d.account.email).toBeTruthy();                       // the 0017 base data is still there
    expect(row.d.format).toBe('pnl-lens-export/1');
    await expectPgError(asRole(t, 'lens_worker', 'select public.export_user_data_base($1)', [req]), '42501');
  });

  it('closing the account removes the journal', async () => {
    const u = await makeUser(t);
    await saveNote(t.app, u, { tradeKey: 'K|5', setup: 'A' });
    await t.admin.query('select delete_account($1)', [u]);
    expect((await t.admin.query('select count(*)::int n from trade_notes where user_id = $1', [u])).rows[0].n).toBe(0);
  });
});
