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
    for (const name of ['social_click', 'ig_section_view', 'ig_card_play', 'ig_card_click', 'ig_follow_click']) {
      expect((await post({ name, props: { site: 'IN' } })).statusCode).toBe(204);
      expect(await rows(name), name).toEqual([{ user_id: null, props: { site: 'IN' } }]);
    }
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

  it('journey events from signed-in users are stored (REQ-2)', async () => {
    const u = await makeUser(x.t);
    for (const name of ['journey_bar_view', 'journey_step_click', 'journey_next_action_click']) expect((await post({ name, props: { plan: 'single' } }, await as(u))).statusCode).toBe(204);
    for (const name of ['journey_bar_view', 'journey_step_click', 'journey_next_action_click']) expect(await rows(name)).toEqual([{ user_id: u, props: { plan: 'single' } }]);
  });

  it('the admin Product tab shows the landing and journey numbers', async () => {
    const owner = await makeUser(x.t, { role: 'owner' });
    const r = await x.app.inject({ method: 'GET', url: '/api/v1/admin/metrics?tab=product', headers: await as(owner) });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.landing).toMatchObject({ pricing_views: 1, d50: 1 });
    expect(d.journey).toMatchObject({ views: 1, step_clicks: 1, action_clicks: 1, upgrades: 0 });
    expect(Object.keys(d.journey)).toEqual(expect.arrayContaining(['single_first', 'single_upgraded', 'with_report', 'returned_45d']));
  });
});
