/**
 * @file  apps/api/test/events.test.ts
 * @area  Tests
 * @what  POST /events: allow-listed names only; visitors may send only the landing events (REQ-4); journey events from signed-in users (REQ-2).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, ORIGIN, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('product events', () => {
  let x: TestApp;
  beforeAll(async () => { x = await testApp('t_api_events'); });
  afterAll(async () => { await x?.close(); });
  const post = (body: object, headers: Record<string, string> = { origin: ORIGIN }) => x.app.inject({ method: 'POST', url: '/api/v1/events', headers, payload: body });
  const rows = async (name: string) => (await x.t.admin.query('select user_id, props from events where name = $1 order by id', [name])).rows;

  it('visitors: pricing_viewed and landing_scroll_depth are stored without a user; nothing else is', async () => {
    expect((await post({ name: 'pricing_viewed', props: { region: 'IN', from: 'landing' } })).statusCode).toBe(204);
    expect((await post({ name: 'landing_scroll_depth', props: { depth: 50, region: 'GLOBAL' } })).statusCode).toBe(204);
    expect((await post({ name: 'upload_started' })).statusCode).toBe(204);
    expect((await post({ name: 'journey_bar_view' })).statusCode).toBe(204);
    expect(await rows('pricing_viewed')).toEqual([{ user_id: null, props: { region: 'IN', from: 'landing' } }]);
    expect(await rows('landing_scroll_depth')).toEqual([{ user_id: null, props: { depth: 50, region: 'GLOBAL' } }]);
    expect(await rows('upload_started')).toEqual([]);
    expect(await rows('journey_bar_view')).toEqual([]);
  });

  it('signed-in users: allow-listed events with their id; unknown names ignored; other sites refused', async () => {
    const u = await makeUser(x.t);
    expect((await post({ name: 'tab_viewed', props: { tab: 'progress' } }, await as(u))).statusCode).toBe(204);
    expect((await post({ name: 'made_up_event' }, await as(u))).statusCode).toBe(204);
    expect(await rows('tab_viewed')).toEqual([{ user_id: u, props: { tab: 'progress' } }]);
    expect(await rows('made_up_event')).toEqual([]);
    expect((await post({ name: 'pricing_viewed' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
  });
});
