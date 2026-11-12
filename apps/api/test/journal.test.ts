/**
 * @file  apps/api/test/journal.test.ts
 * @area  Tests
 * @what  Journal API: save, list, update, empty removes, delete; validation (emotion, tags, sizes); private to each user; signed-out 401.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('journal api', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_journal'); });
  afterAll(async () => { await x?.close(); });
  const put = async (by: string | undefined, payload: object) => x.app.inject({ method: 'PUT', url: '/api/v1/me/journal', headers: await as(by), payload });
  const list = async (by: string) => (await x.app.inject({ method: 'GET', url: '/api/v1/me/journal', headers: await as(by) })).json().notes;

  it('save, update, list, empty removes, delete', async () => {
    const u = await makeUser(x.t), key = 'BANKNIFTY24OCT52000PE|2025-01-06|2025-01-06|9|75|1275225|1785300|510075';
    const r = await put(u, { tradeKey: key, setup: 'Breakout', tags: ['plan'], emotion: 'calm', note: 'clean entry' });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toMatchObject({ tradeKey: key, setup: 'Breakout', tags: ['plan'], emotion: 'calm' });
    await put(u, { tradeKey: key, setup: 'Breakout', tags: ['plan', 'a+'], emotion: 'confident', note: null });
    expect(await list(u)).toEqual([expect.objectContaining({ tags: ['plan', 'a+'], emotion: 'confident', note: null })]);
    expect((await put(u, { tradeKey: key, setup: null, tags: [], emotion: null, note: '' })).json().note).toBeNull();
    expect(await list(u)).toEqual([]);
    await put(u, { tradeKey: key, setup: 'X' });
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/me/journal?key=${encodeURIComponent(key)}`, headers: await as(u) })).json()).toEqual({ deleted: true });
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/me/journal?key=${encodeURIComponent(key)}`, headers: await as(u) })).statusCode).toBe(404);
    expect((await x.t.admin.query(`select count(*)::int n from events where user_id = $1 and name = 'journal_saved'`, [u])).rows[0].n).toBeGreaterThan(0);
  });

  it('validation and privacy', async () => {
    const u = await makeUser(x.t), other = await makeUser(x.t);
    for (const bad of [{ tradeKey: 'k' }, { tradeKey: 'K|1', emotion: 'angry' }, { tradeKey: 'K|1', tags: Array(9).fill('t') }, { tradeKey: 'K|1', note: 'x'.repeat(1001) }, { tradeKey: 'K|1', setup: 'x'.repeat(61) }]) {
      expect((await put(u, bad)).statusCode).toBe(400);
    }
    await put(u, { tradeKey: 'K|1', setup: 'Mine' });
    expect(await list(other)).toEqual([]);
    expect((await x.app.inject({ method: 'DELETE', url: '/api/v1/me/journal?key=K%7C1', headers: await as(other) })).statusCode).toBe(404);
    expect((await put(undefined, { tradeKey: 'K|1', setup: 'x' })).statusCode).toBe(401);
  });
});
