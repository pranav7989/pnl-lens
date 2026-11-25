/**
 * @file  apps/api/src/routes/desk.ts
 * @area  API
 * @what  Desk (spec v1.0, PR 1): public rates/session config and calculator, the trader's desk settings, and owner/admin editing of charge rates, brokerage plans and the market calendar (audited).
 */
/**
 * The calculator itself runs in the browser (packages/shared/src/desk/charges.ts); POST /desk/calc runs the same
 * function on the server for checks and logs. No exchange prices anywhere: the trader types every price (rule R3).
 * The Desk uses no report credits.
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Perm, type Role } from '@pnl-lens/shared/admin/rbac';
import { calcCharges, positionSize, SEGMENTS, type DeskSegment, type ChargeRates, type BrokeragePlan } from '@pnl-lens/shared/desk/charges';
import { istParts, sessionState, SESSION_LABEL } from '@pnl-lens/shared/desk/session';
import type { App, Deps } from '../app.js';
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
}
