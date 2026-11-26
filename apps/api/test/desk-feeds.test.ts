/**
 * @file  apps/api/test/desk-feeds.test.ts
 * @area  Tests
 * @what  Desk PR 2 on a real database: headlines (dedupe by link and by title within 6 h, 7-day retention, failing feed -> "unavailable"), events (create/update/hide/show with history, manual rows never overwritten), generated open/holiday/expiry rows, the expiry + lot-size copy from Market IQ, the calendar check alert, GET /desk/today and the admin events endpoints.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import type { NewsItem, NewsProvider } from '@pnl-lens/shared/providers/news';
import type { EventItem, EventsProvider } from '@pnl-lens/shared/providers/events';
import { syncHeadlines, syncEvents, syncGenerated, copyExpiries, checkCalendar, applyEvents, type DeskSyncDeps } from '../src/lib/desk-sync.js';
import { testApp, as, type TestApp } from './helpers.js';

const ok = await testDbAvailable();
const NOW = new Date('2026-11-25T03:00:00Z');                 // Wed 25 Nov 2026, 08:30 IST
const news = (items: NewsItem[] | Error): NewsProvider => ({ name: 'test', fetch: async () => { if (items instanceof Error) throw items; return items; } });
const events = (items: EventItem[]): EventsProvider => ({ name: 'test-events', fetch: async () => items });
const MIQ = { url: 'http://marketiq.test', key: 'k'.repeat(40), access: 'owner' as const };

describe.skipIf(!ok)('desk feeds', () => {
  let x: TestApp;
  let deps: (over?: Partial<DeskSyncDeps>) => DeskSyncDeps;
  const rows = async (sql: string, p: unknown[] = []) => (await x.t.admin.query(sql, p)).rows;
  beforeAll(async () => {
    x = await testApp('t_api_desk_feeds');
    deps = (over = {}) => ({ pool: x.app.deps.pool, news: null, events: null, marketIq: { url: null, key: null, access: 'owner' }, ...over });
    process.env.DESK_TODAY_CACHE_MS = '0';
  });
  afterAll(async () => { delete process.env.DESK_TODAY_CACHE_MS; await x?.close(); });
  afterEach(() => { delete process.env.NEWS_PROVIDER; });

  it('headlines: stored once per link and per title within 6 hours; 7-day retention; nothing but the headline', async () => {
    const h = (title: string, url: string, minsAgo: number): NewsItem => ({ title, source: 'Wire', url, publishedAt: new Date(NOW.getTime() - minsAgo * 60_000), category: 'markets' });
    await x.t.admin.query(`insert into desk_headlines (provider, title, title_key, source, url, published_at) values ('test', 'Ancient', 'ancient', 'Wire', 'https://n.example/old', $1)`,
      [new Date(NOW.getTime() - 8 * 864e5)]);
    const r = await syncHeadlines(deps({ news: news([
      h('Rupee opens flat', 'https://n.example/1', 30), h('Rupee opens flat', 'https://n.example/1', 30),          // same link
      h('RUPEE opens flat!', 'https://other.example/9', 90),                                                       // same story, other feed, 1 h apart
      h('Rupee opens flat', 'https://n.example/2', 60 * 8),                                                         // same title 7.5 h earlier: a new story
      h('Bad link', 'ftp://n.example/x', 5),
    ]) }), NOW);
    expect(r).toEqual({ count: 2, error: null });
    expect((await rows(`select url from desk_headlines order by url`)).map((z) => z.url)).toEqual(['https://n.example/1', 'https://n.example/2']);
    const cols = (await rows(`select column_name from information_schema.columns where table_name = 'desk_headlines'`)).map((z) => z.column_name);
    expect(cols).not.toContain('body');
    expect(cols).not.toContain('summary');
    expect(await rows(`select feed, provider, last_count, last_error from desk_feed_status where feed = 'headlines'`)).toEqual([{ feed: 'headlines', provider: 'test', last_count: 2, last_error: null }]);
  });

  it('a failing feed keeps the last good time and the Desk says "unavailable"', async () => {
    const before = (await rows(`select last_ok_at from desk_feed_status where feed = 'headlines'`))[0].last_ok_at;
    const r = await syncHeadlines(deps({ news: news(new Error('HTTP 503')) }), new Date(NOW.getTime() + 3600e3));
    expect(r.error).toBe('HTTP 503');
    expect((await rows(`select last_ok_at, last_error from desk_feed_status where feed = 'headlines'`))[0]).toEqual({ last_ok_at: before, last_error: 'HTTP 503' });
    const u = await makeUser(x.t);
    process.env.NEWS_PROVIDER = 'fake';
    const t = (await x.app.inject({ method: 'GET', url: '/api/v1/desk/today', headers: await as(u) })).json();
    expect(t.headlines.state).toBe('unavailable');                                       // last good fetch is hours old (test clock)
    delete process.env.NEWS_PROVIDER;
    const off = (await x.app.inject({ method: 'GET', url: '/api/v1/desk/today', headers: await as(u) })).json();
    expect(off.headlines).toMatchObject({ state: 'off', items: [] });
  });

  it('events: created, updated, hidden when gone and shown again, with history; manual rows never overwritten', async () => {
    const e = (id: string, title: string, at = '10:00'): EventItem => ({ sourceId: id, day: '2026-11-26', at, title, impact: 'high', category: 'macro' });
    const p = x.app.deps.pool;
    expect(await applyEvents(p, 'prov', [e('a', 'CPI data'), e('b', 'GDP data')], '2026-11-25', '2026-12-09')).toBe(2);
    expect(await applyEvents(p, 'prov', [e('a', 'CPI data'), e('b', 'GDP data')], '2026-11-25', '2026-12-09')).toBe(0);     // nothing changed
    expect(await applyEvents(p, 'prov', [e('a', 'CPI data', '10:30')], '2026-11-25', '2026-12-09')).toBe(2);               // a moved, b gone
    const [a, b] = await rows(`select id, to_char(at, 'HH24:MI') as at, hidden from desk_events where source = 'prov' order by source_id`);
    expect([a.at, a.hidden, b.hidden]).toEqual(['10:30', false, true]);
    await applyEvents(p, 'prov', [e('a', 'CPI data', '10:30'), e('b', 'GDP data')], '2026-11-25', '2026-12-09');
    expect((await rows(`select change from desk_event_history where event_id = $1 order by id`, [b.id])).map((z) => z.change)).toEqual(['created', 'hidden', 'shown']);
    await x.t.admin.query(`update desk_events set manual = true, title = 'CPI data (moved by staff)' where id = $1`, [a.id]);
    await applyEvents(p, 'prov', [e('a', 'CPI data', '11:00')], '2026-11-25', '2026-12-09');
    expect((await rows(`select title, to_char(at, 'HH24:MI') as at, hidden from desk_events where id = $1`, [a.id]))[0]).toEqual({ title: 'CPI data (moved by staff)', at: '10:30', hidden: false });
    expect((await syncEvents(deps({ events: events([e('c', 'Fed minutes', '23:30')]) }), NOW)).count).toBe(1);
  });

  it('generated rows: market open/close, the holiday, expiries from the expiry calendar', async () => {
    await x.t.admin.query(`insert into expiry_calendar (underlying, exchange, expiry, kind) values ('NIFTY', 'NSE', '2026-12-01', 'weekly'), ('NIFTY', 'NSE', '2026-11-24', 'monthly')`);
    const r = await syncGenerated(deps(), new Date('2026-11-23T03:00:00Z'));
    expect(r.error).toBeNull();
    const g = await rows(`select day::text as day, to_char(at, 'HH24:MI') as at, title, impact from desk_events where source = 'generated' and day in ('2026-11-23', '2026-11-24', '2026-12-01') order by day, at nulls first, title`);
    expect(g).toEqual([
      { day: '2026-11-23', at: '09:15', title: 'Market open', impact: 'info' }, { day: '2026-11-23', at: '15:30', title: 'Market close', impact: 'info' },
      { day: '2026-11-24', at: null, title: 'Market holiday: Prakash Gurpurb Sri Guru Nanak Dev', impact: 'info' },
      { day: '2026-11-24', at: '15:30', title: 'Nifty monthly expiry', impact: 'expiry' },
      { day: '2026-12-01', at: '09:15', title: 'Market open', impact: 'info' }, { day: '2026-12-01', at: '15:30', title: 'Market close', impact: 'info' },
      { day: '2026-12-01', at: '15:30', title: 'Nifty weekly expiry', impact: 'expiry' },
    ]);
  });

  it('expiries and lot sizes from Market IQ: upcoming replaced, past kept, lot change opens a new row; an empty answer changes nothing', async () => {
    const ref = (lot: number, expiries = [{ exchange: 'NSE', underlying: 'NIFTY', expiry: '2026-12-01', kind: 'weekly' as const }, { exchange: 'NSE', underlying: 'NIFTY', expiry: '2026-12-29', kind: 'monthly' as const }]) =>
      async () => ({ as_of: '2026-11-25', expiries, futures: [{ exchange: 'NSE', underlying: 'NIFTY', instrument: 'FUTIDX', expiry: '2026-12-29', lot_size: lot }] });
    await x.t.admin.query(`insert into expiry_calendar (underlying, exchange, expiry, kind) values ('NIFTY', 'NSE', '2026-12-08', 'weekly'), ('NIFTY', 'NSE', '2025-09-30', 'monthly')`);
    expect(await copyExpiries(deps({ marketIq: MIQ }), NOW, ref(65))).toEqual({ count: 2, error: null });
    expect((await rows(`select expiry::text as e from expiry_calendar where underlying = 'NIFTY' order by expiry`)).map((z) => z.e))
      .toEqual(['2025-09-30', '2026-11-24', '2026-12-01', '2026-12-29']);                // 8 Dec (moved) dropped; the past kept
    await copyExpiries(deps({ marketIq: MIQ }), new Date('2026-12-02T03:00:00Z'), ref(75));
    expect(await rows(`select lot_size, valid_from::text as f, valid_to::text as t from instrument_master where symbol = 'NIFTY FUT 2026-12-29' order by valid_from`))
      .toEqual([{ lot_size: 65, f: '2026-11-25', t: '2026-12-01' }, { lot_size: 75, f: '2026-12-02', t: null }]);
    const empty = await copyExpiries(deps({ marketIq: MIQ }), NOW, ref(65, []));
    expect(empty.error).toMatch(/no expiries/);
    expect((await rows(`select count(*)::int as n from expiry_calendar`))[0].n).toBe(4);
    expect((await copyExpiries(deps(), NOW)).error).toBeNull();                         // Market IQ not configured: skipped
  });

  it('calendar check: a missing day and a missing rate raise one admin alert', async () => {
    expect((await checkCalendar(deps(), NOW)).problems).toEqual([]);
    await x.t.admin.query(`delete from market_calendar where day = '2026-12-03' and segment = 'equity' and exchange = 'NSE'`);
    await x.t.admin.query(`delete from charge_rates where segment = 'currency_opt'`);
    const r = await checkCalendar(deps({ marketIq: MIQ }), NOW);
    expect(r.problems).toEqual(['Market calendar has no NSE equity row for 2026-12-03', 'No charge rates in force for currency_opt']);
    const [e] = await rows(`select message, context from error_events where route = 'desk-sync'`);
    expect(e.message).toBe('Desk calendar check: 2 problems');
  });

  it('GET /desk/today: sign-in required; today\'s events in time order; headlines since the last close only, newest first, at most 6', async () => {
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/desk/today', headers: await as() })).statusCode).toBe(401);
    const now = new Date(), day = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
    await applyEvents(x.app.deps.pool, 'today-test', [
      { sourceId: 't2', day, at: '14:00', title: 'Results: sample company', impact: 'medium', category: 'results' },
      { sourceId: 't1', day, at: '10:00', title: 'Sample policy decision', impact: 'high', category: 'policy' },
    ], day, day);
    await x.t.admin.query('delete from desk_headlines');
    for (let i = 0; i < 8; i++) {
      await x.t.admin.query(`insert into desk_headlines (provider, title, title_key, source, url, published_at) values ('test', $1, $1, 'Wire', $2, $3)`,
        [`fresh ${i}`, `https://n.example/f${i}`, new Date(now.getTime() - (i + 1) * 60_000)]);
    }
    await x.t.admin.query(`insert into desk_headlines (provider, title, title_key, source, url, published_at) values ('test', 'stale', 'stale', 'Wire', 'https://n.example/s', $1)`, [new Date(now.getTime() - 6 * 864e5)]);
    await x.t.admin.query(`update desk_feed_status set last_ok_at = now() where feed = 'headlines'`);
    process.env.NEWS_PROVIDER = 'fake';
    const t = (await x.app.inject({ method: 'GET', url: '/api/v1/desk/today', headers: await as(await makeUser(x.t)) })).json();
    expect(t.date).toBe(day);
    const mine = t.events.filter((e: any) => e.title.startsWith('Sample') || e.title.startsWith('Results'));
    expect(mine.map((e: any) => e.at)).toEqual(['10:00', '14:00']);
    expect(t.headlines.state).toBe('ok');
    expect(t.headlines.items.map((h: any) => h.title)).toEqual(['fresh 0', 'fresh 1', 'fresh 2', 'fresh 3', 'fresh 4', 'fresh 5']);
    expect(Object.keys(t.headlines.items[0]).sort()).toEqual(['category', 'publishedAt', 'source', 'title', 'url']);
  });

  it('admin: owner/admin add, edit and hide events (audited, history), run a feed now; others refused', async () => {
    const admin = await makeUser(x.t, { role: 'admin' }), support = await makeUser(x.t, { role: 'support' }), user = await makeUser(x.t);
    const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const body = { day, at: '11:00', title: 'Budget speech', impact: 'high', category: 'policy' };
    const post = async (who: string, url: string, payload: object, method: 'POST' | 'PATCH' = 'POST') => x.app.inject({ method, url: `/api/v1${url}`, headers: await as(who), payload });
    expect((await post(support, '/admin/desk/events', body)).statusCode).toBe(403);
    const add = await post(admin, '/admin/desk/events', body);
    expect(add.statusCode).toBe(201);
    const id = add.json().event.id;
    const seen = async () => (await x.app.inject({ method: 'GET', url: '/api/v1/desk/today', headers: await as(user) })).json().events.map((e: any) => e.title);
    expect(await seen()).toContain('Budget speech');
    expect((await post(admin, `/admin/desk/events/${id}`, { title: 'Union Budget speech' }, 'PATCH')).json().event).toMatchObject({ title: 'Union Budget speech', manual: true });
    expect((await post(admin, `/admin/desk/events/${id}`, { hidden: true }, 'PATCH')).statusCode).toBe(200);
    expect(await seen()).not.toContain('Union Budget speech');
    expect((await rows(`select change from desk_event_history where event_id = $1 order by id`, [id])).map((z) => z.change)).toEqual(['created', 'updated', 'hidden']);
    const list = (await x.app.inject({ method: 'GET', url: '/api/v1/admin/desk/events', headers: await as(admin) })).json();
    expect(list.events.find((e: any) => e.id === id)).toMatchObject({ hidden: true, source: 'manual' });
    expect(list.providers).toEqual({ news: 'off', events: 'off', marketIq: false });
    const run = await post(admin, '/admin/desk/sync', { job: 'generated' });
    expect(run.json()).toMatchObject({ job: 'generated', error: null });
    expect((await post(support, '/admin/desk/sync', { job: 'generated' })).statusCode).toBe(403);
    expect((await rows(`select action from audit_log where action like 'desk_event%' or action = 'desk_sync_run' order by id`)).map((z) => z.action))
      .toEqual(['desk_event_added', 'desk_event_edited', 'desk_event_edited', 'desk_sync_run']);
  });
});
