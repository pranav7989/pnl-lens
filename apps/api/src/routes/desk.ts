/**
 * @file  apps/api/src/routes/desk.ts
 * @area  API
 * @what  Desk (spec v1.0): public rates/session config and calculator, today's events and overnight headlines (signed in), the trader's Trade Check profile and watch-outs (plan + report), the trader's desk settings, and owner/admin editing of charge rates, brokerage plans, the market calendar and events, plus running a feed now (audited).
 */
/**
 * The calculator itself runs in the browser (packages/shared/src/desk/charges.ts); POST /desk/calc runs the same
 * function on the server for checks and logs. No exchange prices anywhere: the trader types every price (rule R3).
 * The Desk uses no report credits.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Perm, type Role } from '@pnl-lens/shared/admin/rbac';
import { calcCharges, positionSize, SEGMENTS, type DeskSegment, type ChargeRates, type BrokeragePlan } from '@pnl-lens/shared/desk/charges';
import { istParts, sessionState, SESSION_LABEL } from '@pnl-lens/shared/desk/session';
import { CATEGORIES, type Impact } from '@pnl-lens/shared/providers/events';
import { topPatterns, type Pattern } from '@pnl-lens/shared/profile';
import { historyLine, describe as describeSegment, period, dayLabel, TEXT } from '@pnl-lens/shared/plan/templates';
import type { App, Deps } from '../app.js';
import { JOBS, deskProviders, type DeskJob } from '../lib/desk-sync.js';
import { marketIqConfig } from '../lib/market-iq.js';
import { deskAccess } from '../lib/desk-access.js';
import { fail, ok, requireUser, sessionUser } from '../lib/http.js';

const SEGMENT = z.enum(SEGMENTS as [DeskSegment, ...DeskSegment[]]);
const EXCHANGE = z.enum(['NSE', 'BSE', 'MCX']);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RATE_COLS = 'segment, exchange, effective_from::text as effective_from, stt_buy, stt_sell, stt_exercise, exch_txn, sebi_per_crore, stamp_buy, gst, ipft_per_crore, stt_round_rupee, source_note';
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** numeric columns come back from pg as strings */
function toRates(r: Record<string, unknown>): ChargeRates & { segment: string; exchange: string; effective_from: string; source_note: string | null } {
  return { segment: String(r.segment), exchange: String(r.exchange), effective_from: String(r.effective_from), source_note: (r.source_note as string) ?? null,
    stt_buy: Number(r.stt_buy), stt_sell: Number(r.stt_sell), stt_exercise: Number(r.stt_exercise), exch_txn: Number(r.exch_txn),
    sebi_per_crore: Number(r.sebi_per_crore), stamp_buy: Number(r.stamp_buy), gst: Number(r.gst), ipft_per_crore: Number(r.ipft_per_crore), stt_round_rupee: !!r.stt_round_rupee };
}

export async function deskRoutes(app: App, deps: Deps) {
  const q = (text: string, values: unknown[] = []) => deps.pool.query(text, values);

  /** Rate sets in force on a day: one per segment + exchange (the newest effective_from on or before the day). */
  async function ratesOn(day: string) {
    const { rows } = await q(`select distinct on (segment, exchange) ${RATE_COLS} from public.charge_rates
                              where effective_from <= $1::date order by segment, exchange, effective_from desc`, [day]);
    return rows.map(toRates);
  }
  async function plans() {
    const { rows } = await q('select id, name, segment, flat_per_order, pct, cap_per_order, is_default from public.brokerage_plans order by name, segment');
    return rows.map((r) => ({ id: r.id, name: r.name, segment: r.segment, flat_per_order: n(r.flat_per_order), pct: n(r.pct), cap_per_order: n(r.cap_per_order), is_default: r.is_default }));
  }
  async function calendar(day: string) {
    const { rows } = await q(`select segment, exchange, is_holiday, to_char(pre_open, 'HH24:MI') as pre_open, to_char(open, 'HH24:MI') as open,
                                     to_char(close, 'HH24:MI') as close, note from public.market_calendar where day = $1::date order by segment, exchange`, [day]);
    return rows;
  }

  /** Public: everything the browser needs to run the calculator and show the session line. */
  app.get('/desk/config', { schema: { tags: ['desk'], summary: 'Rates in force, brokerage plans, today\'s calendar and session (public)', querystring: z.object({ date: DAY.optional() }) } }, async (req, reply) => {
    const now = istParts(new Date());
    const day = req.query.date ?? now.day;
    const [rates, brokerage, cal] = await Promise.all([ratesOn(day), plans(), calendar(day)]);
    const eq = cal.find((c) => c.segment === 'equity' && c.exchange === 'NSE') ?? null;
    const state = day === now.day ? sessionState(eq, now.minutes) : null;
    reply.header('Cache-Control', 'public, max-age=60');
    return ok(reply, {
      date: day, label: now.day === day ? now.label : day, time: `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`,
      session: state ? { state, label: SESSION_LABEL[state], note: eq?.note ?? null } : null,
      calendar: cal, rates, brokerage,
    });
  });

  /** Public, rate-limited: the server copy of the calculator (same function as the browser). */
  app.post('/desk/calc', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['desk'], summary: 'Charges, breakeven, net and position size (public)', body: z.object({
      segment: SEGMENT, exchange: EXCHANGE, buy: z.number().nonnegative(), sell: z.number().nonnegative(), qty: z.number().positive().max(1e8),
      date: DAY.optional(), brokerage: z.string().max(80).optional(), slippagePerUnit: z.number().nonnegative().nullable().optional(),
      size: z.object({ side: z.enum(['buy', 'sell']), entry: z.number().positive(), stopLoss: z.number().positive(), riskBudget: z.number().positive(), lotSize: z.number().int().positive().nullable().optional() }).optional(),
    }) },
  }, async (req, reply) => {
    const b = req.body;
    const day = b.date ?? istParts(new Date()).day;
    const rate = (await ratesOn(day)).find((r) => r.segment === b.segment && r.exchange === b.exchange);
    if (!rate) return fail(reply, 404, 'no_rates', `No charge rates for ${b.segment} on ${b.exchange} for ${day}.`);
    const plan = (await plans()).find((p) => p.segment === b.segment && (b.brokerage ? p.name === b.brokerage : p.is_default));
    if (!plan) return fail(reply, 404, 'no_brokerage_plan', 'Unknown brokerage plan.');
    const brokerage: BrokeragePlan = plan;
    const charges = calcCharges({ segment: b.segment, buy: b.buy, sell: b.sell, qty: b.qty, rates: rate, brokerage, slippagePerUnit: b.slippagePerUnit ?? null });
    const size = b.size ? positionSize({ segment: b.segment, ...b.size, rates: rate, brokerage, slippagePerUnit: b.slippagePerUnit ?? null }) : null;
    return ok(reply, { rates: { effective_from: rate.effective_from, source_note: rate.source_note }, brokerage: plan.name, charges, size });
  });

  // ---------------------------------------------------------------- today: events and overnight headlines (signed in)
  const HEADLINES_MAX = 6, HEADLINES_STALE_MIN = 15;
  let todayCache: { day: string; at: number; data: unknown } | null = null;     // nothing personal in it: shared by all users for 60 s
  async function today(now: Date) {
    const p = istParts(now);
    const cal = await calendar(p.day);
    const eq = cal.find((c) => c.segment === 'equity' && c.exchange === 'NSE') ?? null;
    const state = sessionState(eq, p.minutes);
    const { rows: events } = await q(`select id, to_char(at, 'HH24:MI') as at, title, impact, category, country from public.desk_events
                                       where day = $1 and not hidden order by at nulls first, id`, [p.day]);
    // overnight = since the last NSE equity close before now
    const { rows: [prev] } = await q(`select ((day + close) at time zone 'Asia/Kolkata') as t from public.market_calendar
                                       where segment = 'equity' and exchange = 'NSE' and not is_holiday and close is not null
                                         and ((day + close) at time zone 'Asia/Kolkata') <= $1 order by day desc limit 1`, [now]);
    const since: Date = prev?.t ?? new Date(now.getTime() - 18 * 3600e3);
    const provider = deskProviders().news;
    const { rows: items } = await q(`select title, source, url, category, published_at from public.desk_headlines
                                      where published_at > $1 and published_at <= $2 order by published_at desc limit $3`, [since, now, HEADLINES_MAX]);
    const { rows: [feed] } = await q(`select last_ok_at from public.desk_feed_status where feed = 'headlines'`);
    const lastOk: Date | null = feed?.last_ok_at ?? null;
    const headlineState = !provider ? 'off' : !lastOk || now.getTime() - lastOk.getTime() > HEADLINES_STALE_MIN * 60_000 ? 'unavailable' : 'ok';
    return {
      date: p.day, label: p.label, time: `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`,
      session: { state, label: SESSION_LABEL[state], note: eq?.note ?? null },
      events: events.map((e) => ({ id: e.id, at: e.at, title: e.title, impact: e.impact as Impact, category: e.category, country: e.country })),
      headlines: { state: headlineState, since: since.toISOString(), lastUpdated: lastOk?.toISOString() ?? null,
        items: headlineState === 'off' ? [] : items.map((h) => ({ title: h.title, source: h.source, url: h.url, category: h.category, publishedAt: (h.published_at as Date).toISOString() })) },
    };
  }

  app.get('/desk/today', { schema: { tags: ['desk'], security: [{ session: [] }], summary: 'Today: session, scheduled events and overnight headlines (signed in)' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const now = new Date(), day = istParts(now).day;
    const ttl = Number(process.env.DESK_TODAY_CACHE_MS ?? 60_000);
    if (!todayCache || todayCache.day !== day || now.getTime() - todayCache.at >= ttl) todayCache = { day, at: now.getTime(), data: await today(now) };
    reply.header('Cache-Control', 'private, max-age=60');
    return ok(reply, todayCache.data);
  });

  // ---------------------------------------------------------------- Trade Check profile and watch-outs (active plan + a report)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));

  app.get('/desk/profile', { schema: { tags: ['desk'], security: [{ session: [] }], summary: 'My Trade Check profile and watch-outs (active plan and a report)' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    reply.header('Cache-Control', 'no-store');
    const access = await deskAccess(deps.pool, user.id);
    if (access !== 'ok') return ok(reply, { access, profile: null });
    const { rows: [p] } = await q(`select active_version, built_at, period_from, period_to, newest_trade, n_trades, currency, unavailable from public.trader_profiles where user_id = $1`, [user.id]);
    if (!p) return ok(reply, { access, profile: null, building: true });
    const { rows } = await q(`select segment_key, dims, n_trades, n_days, n_expiries, wins, win_days, win_rate, wr_low, wr_high, total_pnl, expectancy, expectancy_shrunk,
                                     recency, score, shown, verdict, period_from, period_to, last_trade_at
                                from public.trader_patterns where user_id = $1 and profile_version = $2 and shown and verdict <> 'neutral'`, [user.id, p.active_version]);
    const patterns: Pattern[] = rows.map((r) => ({
      segment_key: r.segment_key, dims: r.dims, n_trades: r.n_trades, n_days: r.n_days, n_expiries: r.n_expiries, wins: r.wins, win_days: r.win_days,
      win_rate: Number(r.win_rate), wr_low: Number(r.wr_low), wr_high: Number(r.wr_high), total_pnl: Number(r.total_pnl), expectancy: Number(r.expectancy),
      expectancy_low: null, expectancy_high: null, expectancy_shrunk: Number(r.expectancy_shrunk), recency: Number(r.recency), score: Number(r.score),
      shown: true, verdict: r.verdict, period_from: day(r.period_from), period_to: day(r.period_to), last_trade_at: day(r.last_trade_at),
    }));
    const now = new Date(), to = day(p.period_to);
    const watchouts = topPatterns(patterns).map((w) => ({
      kind: w.verdict, segment: w.segment_key, what: describeSegment(w.dims), text: historyLine(w, p.currency, now),
      trades: w.n_trades, days: w.n_days, period: period(w.period_from, w.period_to),
    }));
    return ok(reply, {
      access,
      profile: {
        version: p.active_version, builtAt: (p.built_at as Date).toISOString(), periodFrom: day(p.period_from), periodTo: to, trades: num(p.n_trades),
        checkedAgainst: to ? TEXT.checkedAgainst(dayLabel(to)) : null, unavailable: p.unavailable as string[],
        unlockTime: (p.unavailable as string[]).includes('time_bucket') ? TEXT.unlockTime : null,
        watchouts, nothingClear: watchouts.length ? null : TEXT.nothingClear,
      },
    });
  });

  // ---------------------------------------------------------------- the trader's settings
  const SETTINGS = z.object({
    risk_per_trade: z.number().positive().max(1e9).nullable(), max_daily_loss: z.number().positive().max(1e9).nullable(),
    max_trades_day: z.number().int().min(1).max(100).nullable(), brokerage_plan: z.string().max(80).nullable(),
    default_exchange: EXCHANGE, avg_slippage_override: z.number().nonnegative().max(1e6).nullable(), adherence_target: z.number().int().min(1).max(100),
  });
  const DEFAULTS = { risk_per_trade: null, max_daily_loss: null, max_trades_day: null, brokerage_plan: null, default_exchange: 'NSE', avg_slippage_override: null, adherence_target: 80 };

  app.get('/desk/settings', { schema: { tags: ['desk'], security: [{ session: [] }], summary: 'My desk settings' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const { rows } = await q('select risk_per_trade, max_daily_loss, max_trades_day, brokerage_plan, default_exchange, avg_slippage_override, adherence_target from public.desk_settings where user_id = $1', [user.id]);
    const r = rows[0];
    reply.header('Cache-Control', 'no-store');
    return ok(reply, r ? { ...r, risk_per_trade: n(r.risk_per_trade), max_daily_loss: n(r.max_daily_loss), avg_slippage_override: n(r.avg_slippage_override) } : DEFAULTS);
  });

  app.put('/desk/settings', { schema: { tags: ['desk'], security: [{ session: [] }], summary: 'Save my desk settings', body: SETTINGS } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const b = req.body;
    if (b.brokerage_plan && !(await plans()).some((p) => p.name === b.brokerage_plan)) return fail(reply, 400, 'bad_plan', 'Unknown brokerage plan.');
    await q(`insert into public.desk_settings (user_id, risk_per_trade, max_daily_loss, max_trades_day, brokerage_plan, default_exchange, avg_slippage_override, adherence_target, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, now())
             on conflict (user_id) do update set risk_per_trade = excluded.risk_per_trade, max_daily_loss = excluded.max_daily_loss, max_trades_day = excluded.max_trades_day,
               brokerage_plan = excluded.brokerage_plan, default_exchange = excluded.default_exchange, avg_slippage_override = excluded.avg_slippage_override,
               adherence_target = excluded.adherence_target, updated_at = now()`,
      [user.id, b.risk_per_trade, b.max_daily_loss, b.max_trades_day, b.brokerage_plan, b.default_exchange, b.avg_slippage_override, b.adherence_target]);
    return ok(reply, { ok: true });
  });

  // ---------------------------------------------------------------- owner/admin: reference data (audited)
  async function requirePerm(req: FastifyRequest, reply: FastifyReply, perm: Perm): Promise<{ id: string; role: Role } | null> {
    const u = await sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    const { rows } = await q('select role from public.users where id = $1', [u.id]);
    const role = (rows[0]?.role as Role) || 'user';
    if (!can(role, perm)) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { id: u.id, role };
  }
  const audit = (userId: string, action: string, meta: unknown) => q('insert into public.audit_log (user_id, action, meta) values ($1, $2, $3)', [userId, action, JSON.stringify(meta)]);
  const admin = { tags: ['admin'], security: [{ session: [] }] };

  app.get('/admin/charge-rates', { schema: { ...admin, summary: 'All charge rate sets (owner/admin)' } }, async (req, reply) => {
    if (!(await requirePerm(req, reply, 'desk:admin'))) return;
    const { rows } = await q(`select id, ${RATE_COLS} from public.charge_rates order by segment, exchange, effective_from desc`);
    return ok(reply, { rates: rows.map((r) => ({ id: r.id, ...toRates(r) })) });
  });

  const RATE = z.object({
    segment: SEGMENT, exchange: EXCHANGE, effective_from: DAY,
    stt_buy: z.number().min(0).max(0.05), stt_sell: z.number().min(0).max(0.05), stt_exercise: z.number().min(0).max(0.05),
    exch_txn: z.number().min(0).max(0.01), sebi_per_crore: z.number().min(0).max(1000), stamp_buy: z.number().min(0).max(0.01),
    gst: z.number().min(0).max(0.5), ipft_per_crore: z.number().min(0).max(1000), stt_round_rupee: z.boolean(), source_note: z.string().min(3).max(300),
  });
  /** A new rate set from a date (rates are never edited in place: history stays, the newest effective_from wins). */
  app.post('/admin/charge-rates', { schema: { ...admin, summary: 'Add a charge rate set from a date (owner/admin, audited)', body: RATE } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const b = req.body;
    try {
      const { rows } = await q(`insert into public.charge_rates (segment, exchange, effective_from, stt_buy, stt_sell, stt_exercise, exch_txn, sebi_per_crore, stamp_buy, gst, ipft_per_crore, stt_round_rupee, source_note, created_by)
                                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [b.segment, b.exchange, b.effective_from, b.stt_buy, b.stt_sell, b.stt_exercise, b.exch_txn, b.sebi_per_crore, b.stamp_buy, b.gst, b.ipft_per_crore, b.stt_round_rupee, b.source_note, who.id]);
      await audit(who.id, 'desk_charge_rates_added', b);
      return ok(reply, { id: rows[0].id }, 201);
    } catch (e: any) {
      if (e?.code === '23505') return fail(reply, 409, 'exists', 'A rate set for this segment, exchange and date already exists.');
      throw e;
    }
  });

  const PLAN = z.object({ name: z.string().min(2).max(80), segment: SEGMENT, flat_per_order: z.number().min(0).max(10000).nullable(),
    pct: z.number().min(0).max(0.05).nullable(), cap_per_order: z.number().min(0).max(10000).nullable(), is_default: z.boolean() });
  app.post('/admin/brokerage-plans', { schema: { ...admin, summary: 'Add or update a brokerage plan row (owner/admin, audited)', body: PLAN } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const b = req.body;
    if (b.flat_per_order == null && b.pct == null) return fail(reply, 400, 'invalid', 'Give a flat amount or a percentage.');
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      if (b.is_default) await client.query('update public.brokerage_plans set is_default = false where segment = $1', [b.segment]);
      await client.query(`insert into public.brokerage_plans (name, segment, flat_per_order, pct, cap_per_order, is_default) values ($1,$2,$3,$4,$5,$6)
                          on conflict (name, segment) do update set flat_per_order = excluded.flat_per_order, pct = excluded.pct, cap_per_order = excluded.cap_per_order, is_default = excluded.is_default`,
        [b.name, b.segment, b.flat_per_order, b.pct, b.cap_per_order, b.is_default]);
      await client.query('insert into public.audit_log (user_id, action, meta) values ($1, $2, $3)', [who.id, 'desk_brokerage_plan_saved', JSON.stringify(b)]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return ok(reply, { ok: true });
  });

  app.get('/admin/market-calendar', { schema: { ...admin, summary: 'Market calendar for a month (owner/admin)', querystring: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) } }, async (req, reply) => {
    if (!(await requirePerm(req, reply, 'desk:admin'))) return;
    const { rows } = await q(`select day::text as day, segment, exchange, is_holiday, to_char(pre_open, 'HH24:MI') as pre_open, to_char(open, 'HH24:MI') as open,
                                     to_char(close, 'HH24:MI') as close, note from public.market_calendar
                               where to_char(day, 'YYYY-MM') = $1 order by day, segment, exchange`, [req.query.month]);
    return ok(reply, { days: rows });
  });

  const TIME = z.string().regex(/^\d{2}:\d{2}$/).nullable();
  app.post('/admin/market-calendar', { schema: { ...admin, summary: 'Set one calendar day for a segment (owner/admin, audited)',
    body: z.object({ day: DAY, segment: z.enum(['equity', 'currency', 'commodity']), exchange: EXCHANGE, is_holiday: z.boolean(), pre_open: TIME, open: TIME, close: TIME, note: z.string().max(200).nullable() }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const b = req.body;
    await q(`insert into public.market_calendar (day, segment, exchange, is_holiday, pre_open, open, close, note) values ($1,$2,$3,$4,$5,$6,$7,$8)
             on conflict (day, segment, exchange) do update set is_holiday = excluded.is_holiday, pre_open = excluded.pre_open, open = excluded.open, close = excluded.close, note = excluded.note`,
      [b.day, b.segment, b.exchange, b.is_holiday, b.pre_open, b.open, b.close, b.note]);
    await audit(who.id, 'desk_market_calendar_set', b);
    return ok(reply, { ok: true });
  });

  // ---------------------------------------------------------------- owner/admin: events and feeds (audited)
  const syncDeps = () => ({ pool: deps.pool, ...deskProviders(), marketIq: marketIqConfig(), log: (event: string, extra?: object) => app.log.info({ event, ...extra }) });
  const EVENT = z.object({ day: DAY, at: TIME, title: z.string().trim().min(3).max(200), impact: z.enum(['high', 'medium', 'low', 'expiry', 'info']),
    category: z.enum(CATEGORIES as [string, ...string[]]), country: z.string().regex(/^[A-Z]{2}$/).default('IN') });
  const EVENT_COLS = `id, day::text as day, to_char(at, 'HH24:MI') as at, title, impact, category, country, source, manual, hidden, updated_at`;

  app.get('/admin/desk/events', { schema: { ...admin, summary: 'Events for a period, feed status (owner/admin)', querystring: z.object({ from: DAY.optional(), to: DAY.optional() }) } }, async (req, reply) => {
    if (!(await requirePerm(req, reply, 'desk:admin'))) return;
    const from = req.query.from ?? istParts(new Date()).day;
    const to = req.query.to ?? new Date(Date.parse(from) + 14 * 864e5).toISOString().slice(0, 10);
    const { rows: events } = await q(`select ${EVENT_COLS} from public.desk_events where day between $1 and $2 order by day, at nulls first, id`, [from, to]);
    const { rows: feeds } = await q('select feed, provider, last_attempt_at, last_ok_at, last_error, last_count from public.desk_feed_status order by feed');
    const p = deskProviders(), m = marketIqConfig();
    reply.header('Cache-Control', 'no-store');
    return ok(reply, { from, to, events, feeds, providers: { news: p.news?.name ?? 'off', events: p.events?.name ?? 'off', marketIq: !!(m.url && m.key) } });
  });

  app.post('/admin/desk/events', { schema: { ...admin, summary: 'Add an event by hand (owner/admin, audited); providers never overwrite it', body: EVENT } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const b = req.body;
    const { rows: [e] } = await q(`insert into public.desk_events (day, at, title, impact, category, country, source, source_id, manual, updated_by)
                                   values ($1, $2, $3, $4, $5, $6, 'manual', $7, true, $8) returning ${EVENT_COLS}`, [b.day, b.at, b.title, b.impact, b.category, b.country, randomUUID(), who.id]);
    await q(`insert into public.desk_event_history (event_id, actor, change, after) values ($1, $2, 'created', $3)`, [e.id, who.id, JSON.stringify(b)]);
    await audit(who.id, 'desk_event_added', { id: e.id, ...b });
    todayCache = null;
    return ok(reply, { event: e }, 201);
  });

  app.patch('/admin/desk/events/:id', { schema: { ...admin, summary: 'Edit or hide an event (owner/admin, audited); it becomes manual', params: z.object({ id: z.coerce.number().int().positive() }),
    body: EVENT.partial().omit({ country: true }).extend({ hidden: z.boolean().optional() }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const { rows: [old] } = await q(`select ${EVENT_COLS} from public.desk_events where id = $1`, [req.params.id]);
    if (!old) return fail(reply, 404, 'not_found', 'No such event.');
    const b = req.body;
    const next = { day: b.day ?? old.day, at: b.at !== undefined ? b.at : old.at, title: b.title ?? old.title, impact: b.impact ?? old.impact, category: b.category ?? old.category, hidden: b.hidden ?? old.hidden };
    const { rows: [e] } = await q(`update public.desk_events set day = $2, at = $3, title = $4, impact = $5, category = $6, hidden = $7, manual = true, updated_by = $8, updated_at = now()
                                   where id = $1 returning ${EVENT_COLS}`, [old.id, next.day, next.at, next.title, next.impact, next.category, next.hidden, who.id]);
    const onlyHidden = Object.keys(b).every((k) => k === 'hidden');
    const change = onlyHidden ? (next.hidden ? 'hidden' : 'shown') : 'updated';
    await q(`insert into public.desk_event_history (event_id, actor, change, before, after) values ($1, $2, $3, $4, $5)`, [old.id, who.id, change, JSON.stringify(old), JSON.stringify(next)]);
    await audit(who.id, 'desk_event_edited', { id: old.id, change, ...b });
    todayCache = null;
    return ok(reply, { event: e });
  });

  app.post('/admin/desk/sync', { schema: { ...admin, summary: 'Run a Desk feed now (owner/admin, audited)', body: z.object({ job: z.enum(Object.keys(JOBS) as [DeskJob, ...DeskJob[]]) }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'desk:admin'); if (!who) return;
    const r = await JOBS[req.body.job](syncDeps(), new Date());
    await audit(who.id, 'desk_sync_run', { job: req.body.job, count: r.count, error: r.error });
    todayCache = null;
    return ok(reply, { job: req.body.job, count: r.count, error: r.error, problems: 'problems' in r ? r.problems : undefined });
  });
}
