/**
 * @file  apps/api/src/lib/desk-sync.ts
 * @area  Desk
 * @what  Desk feeds on API timers: headlines every 5 min (dedupe, 7-day retention), events every 30 min 06:00–22:00 IST (manual rows never overwritten, history kept), generated open/close/holiday/expiry rows, the 07:40 copy of expiries and lot sizes from Market IQ, the 07:35 calendar check (admin alert once a day).
 */
/**
 * The worker has no internet, so these run in the api, like market-sync.ts. Nothing here can break a page: each job
 * records its result in desk_feed_status, and the Desk shows "Headlines unavailable · last updated hh:mm" when the
 * news feed is failing. Providers: NEWS_PROVIDER / EVENTS_PROVIDER = off (default) | fake (development). DESK_SYNC=off
 * stops every timer (tests).
 */
import type pg from 'pg';
import { captureErrorWith } from '@pnl-lens/shared/admin/telemetry';
import { istDate, addDays } from '@pnl-lens/shared/plan';
import { istParts } from '@pnl-lens/shared/desk/session';
import { SEGMENTS } from '@pnl-lens/shared/desk/charges';
import { cleanHeadline, newsProvider, type NewsProvider } from '@pnl-lens/shared/providers/news';
import { generatedEvents, eventsProvider, type EventItem, type EventsProvider, type CalendarRow, type ExpiryRow } from '@pnl-lens/shared/providers/events';
import { marketIqGet, type MarketIqConfig } from './market-iq.js';

export const HEADLINE_DEDUPE_HOURS = 6;
export const HEADLINE_KEEP_DAYS = 7;
export const EVENT_DAYS_AHEAD = 14;
type Feed = 'headlines' | 'events' | 'generated' | 'expiries' | 'calendar_check';

export interface DeskSyncDeps {
  pool: pg.Pool;
  news: NewsProvider | null;
  events: EventsProvider | null;
  marketIq: MarketIqConfig;
  log?: (event: string, extra?: object) => void;
}
export const deskProviders = (env: NodeJS.ProcessEnv = process.env) => ({ news: newsProvider(env.NEWS_PROVIDER), events: eventsProvider(env.EVENTS_PROVIDER) });

async function status(pool: pg.Pool, feed: Feed, provider: string | null, now: Date, error: string | null, count: number | null) {
  await pool.query(`insert into public.desk_feed_status (feed, provider, last_attempt_at, last_ok_at, last_error, last_count) values ($1, $2, $3, $4, $5, $6)
                    on conflict (feed) do update set provider = excluded.provider, last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error,
                      last_ok_at = coalesce(excluded.last_ok_at, desk_feed_status.last_ok_at), last_count = coalesce(excluded.last_count, desk_feed_status.last_count)`,
  [feed, provider, now, error ? null : now, error ? error.slice(0, 500) : null, error ? null : count]);
}
async function guarded(pool: pg.Pool, feed: Feed, provider: string | null, now: Date, run: () => Promise<number>): Promise<{ count: number; error: string | null }> {
  try {
    const count = await run();
    await status(pool, feed, provider, now, null, count);
    return { count, error: null };
  } catch (e) {
    const error = (e as Error).message || String(e);
    await status(pool, feed, provider, now, error, null).catch(() => {});
    return { count: 0, error };
  }
}

// ---------------------------------------------------------------- headlines
/** Fetch the last day's headlines; store new ones (same link, or the same title within 6 hours, = already stored); drop those older than 7 days. */
export async function syncHeadlines(d: DeskSyncDeps, now = new Date()) {
  const p = d.news;
  if (!p) return { count: 0, error: null };
  return guarded(d.pool, 'headlines', p.name, now, async () => {
    const items = (await p.fetch(new Date(now.getTime() - 24 * 3600e3), now)).map((i) => cleanHeadline(i, now)).filter((x) => x !== null);
    let added = 0;
    for (const h of items) {
      const r = await d.pool.query(`insert into public.desk_headlines (provider, title, title_key, source, url, category, published_at)
        select $1, $2, $3, $4, $5, $6, $7
         where not exists (select 1 from public.desk_headlines where title_key = $3 and title_key <> ''
                             and published_at between $7::timestamptz - make_interval(hours => $8) and $7::timestamptz + make_interval(hours => $8))
        on conflict (provider, url) do nothing`, [p.name, h.title, h.titleKey, h.source, h.url, h.category, h.publishedAt, HEADLINE_DEDUPE_HOURS]);
      added += r.rowCount ?? 0;
    }
    await d.pool.query(`delete from public.desk_headlines where published_at < $1::timestamptz - make_interval(days => $2)`, [now, HEADLINE_KEEP_DAYS]);
    return added;
  });
}

// ---------------------------------------------------------------- events
const EVENT_COLS = ['day', 'at', 'title', 'impact', 'category', 'country'] as const;
const snapshot = (r: any) => ({ day: r.day, at: r.at, title: r.title, impact: r.impact, category: r.category, country: r.country, hidden: r.hidden });

/**
 * Upsert one source's events for [from, to]. Rows changed by staff (manual) are never touched. A row the source no
 * longer sends for that window is hidden (cancelled, or a holiday added to the calendar), and shown again if it comes back.
 */
export async function applyEvents(pool: pg.Pool, source: string, items: EventItem[], from: string, to: string): Promise<number> {
  let changed = 0;
  const seen: string[] = [];
  for (const i of items) {
    if (i.day < from || i.day > to) continue;
    seen.push(i.sourceId);
    const row = { day: i.day, at: i.at, title: i.title.slice(0, 200), impact: i.impact, category: i.category, country: (i.country || 'IN').toUpperCase() };
    const { rows: [old] } = await pool.query(`select id, day::text as day, to_char(at, 'HH24:MI') as at, title, impact, category, country, hidden, manual
                                               from public.desk_events where source = $1 and source_id = $2`, [source, i.sourceId]);
    if (old?.manual) continue;
    if (!old) {
      const { rows: [n] } = await pool.query(`insert into public.desk_events (day, at, title, impact, category, country, source, source_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [row.day, row.at, row.title, row.impact, row.category, row.country, source, i.sourceId]);
      await pool.query(`insert into public.desk_event_history (event_id, change, after) values ($1, 'created', $2)`, [n.id, { ...row, hidden: false }]);
      changed++;
    } else if (old.hidden || EVENT_COLS.some((k) => (old[k] ?? null) !== (row[k] ?? null))) {
      await pool.query(`update public.desk_events set day = $2, at = $3, title = $4, impact = $5, category = $6, country = $7, hidden = false, updated_at = now() where id = $1`,
        [old.id, row.day, row.at, row.title, row.impact, row.category, row.country]);
      await pool.query(`insert into public.desk_event_history (event_id, change, before, after) values ($1, $2, $3, $4)`,
        [old.id, old.hidden ? 'shown' : 'updated', snapshot(old), { ...row, hidden: false }]);
      changed++;
    }
  }
  const { rows: gone } = await pool.query(`update public.desk_events set hidden = true, updated_at = now()
     where source = $1 and not manual and not hidden and day between $2 and $3 and not (source_id = any($4::text[])) returning id`, [source, from, to, seen]);
  for (const g of gone) await pool.query(`insert into public.desk_event_history (event_id, change, after) values ($1, 'hidden', '{"hidden": true}')`, [g.id]);
  return changed + gone.length;
}

/** Market open/close, holidays and expiries for today .. +14 days, from the calendars. */
export async function syncGenerated(d: DeskSyncDeps, now = new Date()) {
  const from = istDate(now), to = addDays(from, EVENT_DAYS_AHEAD);
  return guarded(d.pool, 'generated', 'generated', now, async () => {
    const { rows: cal } = await d.pool.query<CalendarRow>(`select day::text as day, segment, exchange, is_holiday, to_char(open, 'HH24:MI') as open, to_char(close, 'HH24:MI') as close, note
                                                          from public.market_calendar where day between $1 and $2`, [from, to]);
    const { rows: exp } = await d.pool.query<ExpiryRow>(`select underlying, exchange, expiry::text as expiry, kind from public.expiry_calendar where expiry between $1 and $2`, [from, to]);
    return applyEvents(d.pool, 'generated', generatedEvents(cal, exp), from, to);
  });
}

export async function syncEvents(d: DeskSyncDeps, now = new Date()) {
  const p = d.events;
  if (!p) return { count: 0, error: null };
  const from = istDate(now), to = addDays(from, EVENT_DAYS_AHEAD);
  return guarded(d.pool, 'events', p.name, now, async () => applyEvents(d.pool, p.name, await p.fetch(from, to), from, to));
}

// ---------------------------------------------------------------- expiries and lot sizes from Market IQ
interface FnoRef { as_of: string | null; expiries: { exchange: string; underlying: string; expiry: string; kind: 'weekly' | 'monthly' }[];
  futures: { exchange: string; underlying: string; instrument: string; expiry: string; lot_size: number | null }[] }

/** Copy upcoming expiries (past ones are kept as history) and the lot size of every live future (a change opens a new row). */
export async function copyExpiries(d: DeskSyncDeps, now = new Date(), fetchRef = () => marketIqGet<FnoRef>(d.marketIq, '/internal/instruments/fno', 20_000)) {
  if (!d.marketIq.url || !d.marketIq.key) return { count: 0, error: null };
  return guarded(d.pool, 'expiries', 'market-iq', now, async () => {
    const ref = await fetchRef();
    if (!ref.expiries?.length) throw new Error('Market IQ sent no expiries (instrument list not loaded yet?)');
    const today = istDate(now);
    const c = await d.pool.connect();
    try {
      await c.query('begin');
      // a future expiry the exchange moved (holiday) disappears from the contracts: drop it, keep the past
      await c.query(`delete from public.expiry_calendar where expiry >= $1 and (underlying, exchange, expiry::text) not in
                       (select u, e, x from unnest($2::text[], $3::text[], $4::text[]) as t(u, e, x))`,
      [today, ref.expiries.map((e) => e.underlying), ref.expiries.map((e) => e.exchange), ref.expiries.map((e) => e.expiry)]);
      for (const e of ref.expiries) {
        await c.query(`insert into public.expiry_calendar (underlying, exchange, expiry, kind) values ($1, $2, $3, $4)
                       on conflict (underlying, exchange, expiry) do update set kind = excluded.kind`, [e.underlying, e.exchange, e.expiry, e.kind]);
      }
      for (const f of ref.futures.filter((x) => x.lot_size)) {
        const symbol = `${f.underlying} FUT ${f.expiry}`;
        const { rows: [open] } = await c.query(`select id, lot_size from public.instrument_master where exchange = $1 and symbol = $2 and valid_to is null`, [f.exchange, symbol]);
        if (open && Number(open.lot_size) === f.lot_size) continue;
        if (open) await c.query(`update public.instrument_master set valid_to = greatest(valid_from, $2::date - 1) where id = $1`, [open.id, today]);
        await c.query(`insert into public.instrument_master (exchange, segment, symbol, underlying, instrument, expiry, lot_size, valid_from, source)
                       values ($1, 'derivatives', $2, $3, $4, $5, $6, $7, 'market-iq')
                       on conflict (exchange, symbol, valid_from) do update set lot_size = excluded.lot_size, valid_to = null`,
        [f.exchange, symbol, f.underlying, f.instrument, f.expiry, f.lot_size, today]);
      }
      await c.query(`update public.instrument_master set valid_to = expiry where valid_to is null and expiry < $1`, [today]);
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
    finally { c.release(); }
    return ref.expiries.length;
  });
}

// ---------------------------------------------------------------- calendar check
/** What would make the Desk wrong in the coming weeks: missing calendar days, a segment without charge rates, no expiries. */
export async function calendarProblems(pool: pg.Pool, now: Date, expectExpiries: boolean): Promise<string[]> {
  const today = istDate(now), out: string[] = [];
  const { rows: [cal] } = await pool.query(`select max(day)::text as last,
      array(select d::date::text from generate_series($1::date, $1::date + 13, interval '1 day') d
             where extract(isodow from d) < 6 and not exists (select 1 from public.market_calendar m where m.day = d::date and m.segment = 'equity' and m.exchange = 'NSE')) as missing
      from public.market_calendar where segment = 'equity' and exchange = 'NSE'`, [today]);
  if (cal.missing.length) out.push(`Market calendar has no NSE equity row for ${cal.missing.join(', ')}`);
  if (!cal.last || cal.last < addDays(today, 30)) out.push(`Market calendar ends on ${cal.last ?? '(empty)'}: add the next days and holidays (admin → Desk)`);
  const { rows } = await pool.query(`select distinct segment from public.charge_rates where effective_from <= $1`, [today]);
  const have = new Set(rows.map((r) => r.segment));
  const missingRates = SEGMENTS.filter((s) => !have.has(s));
  if (missingRates.length) out.push(`No charge rates in force for ${missingRates.join(', ')}`);
  if (expectExpiries) {
    const { rows: [e] } = await pool.query(`select count(*)::int as n from public.expiry_calendar where underlying = 'NIFTY' and expiry between $1 and $1::date + 10`, [today]);
    if (!e.n) out.push('No Nifty expiry in the next 10 days: is the Market IQ copy running?');
  }
  return out;
}

export async function checkCalendar(d: DeskSyncDeps, now = new Date()) {
  let found: string[] = [];
  const r = await guarded(d.pool, 'calendar_check', null, now, async () => {
    found = await calendarProblems(d.pool, now, !!(d.marketIq.url && d.marketIq.key));
    return found.length;
  });
  if (found.length) {
    await captureErrorWith(d.pool, new Error(`Desk calendar check: ${found.length} problem${found.length === 1 ? '' : 's'}`),
      { source: 'server', route: 'desk-sync', context: { problems: found } });
  }
  return { ...r, problems: found };
}

// ---------------------------------------------------------------- timers
export const JOBS = { headlines: syncHeadlines, events: syncEvents, generated: syncGenerated, expiries: copyExpiries, calendar_check: checkCalendar } as const;
export type DeskJob = keyof typeof JOBS;

/**
 * Checked every minute (IST): headlines every 5 min; events + generated every 30 min between 06:00 and 22:00 (and once at
 * start); the calendar check once a day from 07:35 and the expiry copy once a day from 07:40 (and at start when past
 * those times and not yet done today), then the generated rows again.
 */
export function startDeskSync(d: DeskSyncDeps, env: NodeJS.ProcessEnv = process.env): () => void {
  const last: Partial<Record<DeskJob, number>> = {}, daily: Partial<Record<DeskJob, string>> = {};
  let busy = false, first = true;
  const run = async (job: DeskJob, now: Date) => {
    last[job] = now.getTime();
    const r = await JOBS[job](d, now);
    if (r.error || r.count) d.log?.('desk_sync', { job, count: r.count, error: r.error?.slice(0, 200) ?? null });
  };
  const due = (job: DeskJob, now: Date, everyMin: number) => !last[job] || now.getTime() - last[job]! >= everyMin * 60_000 - 5_000;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const now = new Date(), { day, minutes } = istParts(now);
      // the expiry copy first: when both are due in the same minute (start-up after 07:40), the check must see today's copy
      if (minutes >= 7 * 60 + 40 && daily.expiries !== day) { daily.expiries = day; await run('expiries', now); await run('generated', now); }
      if (minutes >= 7 * 60 + 35 && daily.calendar_check !== day) { daily.calendar_check = day; await run('calendar_check', now); }
      if (due('headlines', now, 5)) await run('headlines', now);
      if (first || (minutes >= 6 * 60 && minutes < 22 * 60 && due('events', now, 30))) { await run('events', now); await run('generated', now); }
      first = false;
    } catch (e) { d.log?.('desk_sync_error', { error: (e as Error).message.slice(0, 200) }); }
    finally { busy = false; }
  };
  const t = setInterval(tick, Math.max(10_000, Number(env.DESK_SYNC_TICK_MS || 60_000))); t.unref();
  setTimeout(tick, 20_000).unref();
  return () => clearInterval(t);
}
