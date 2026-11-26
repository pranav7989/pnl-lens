/**
 * @file  apps/api/src/lib/trade-check-data.ts
 * @area  Desk
 * @what  Reads what Trade Check needs for one trader and day: the active profile (shown habits, usual sizes, instruments traded), their active rules, upcoming expiries, lot sizes, charge rates and brokerage, and the day's journal (trades not in the plan); returned as the same JSON the browser gets (GET /desk/context), so the browser and the API run check() on identical inputs.
 */
import type { Pattern } from '@pnl-lens/shared/profile';
import type { CheckContextData, CheckProfile, TraderRule } from '@pnl-lens/shared/plan/check';
import type { ChargeRates, BrokeragePlan, DeskSegment } from '@pnl-lens/shared/desk/charges';
import { istParts } from '@pnl-lens/shared/desk/session';

type Q = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const SEGMENTS: DeskSegment[] = ['options', 'futures', 'eq_intraday'];

export function patternFromRow(r: any): Pattern {
  return {
    segment_key: r.segment_key, dims: r.dims, n_trades: r.n_trades, n_days: r.n_days, n_expiries: r.n_expiries, wins: r.wins, win_days: r.win_days,
    win_rate: Number(r.win_rate), wr_low: Number(r.wr_low), wr_high: Number(r.wr_high), total_pnl: Number(r.total_pnl), expectancy: Number(r.expectancy),
    expectancy_low: null, expectancy_high: null, expectancy_shrunk: Number(r.expectancy_shrunk), recency: Number(r.recency), score: Number(r.score),
    shown: !!r.shown, verdict: r.verdict, period_from: day(r.period_from), period_to: day(r.period_to), last_trade_at: day(r.last_trade_at),
  };
}

/** The trader's active profile for checks, or null before the first one. */
export async function checkProfile(q: Q, userId: string): Promise<(CheckProfile & { periodTo: string | null; unavailable: string[] }) | null> {
  const { rows: [p] } = await q.query('select active_version, currency, usual_qty, period_to, unavailable from public.trader_profiles where user_id = $1', [userId]);
  if (!p) return null;
  const { rows } = await q.query(`select segment_key, dims, n_trades, n_days, n_expiries, wins, win_days, win_rate, wr_low, wr_high, total_pnl, expectancy, expectancy_shrunk,
                                         recency, score, shown, verdict, period_from, period_to, last_trade_at
                                    from public.trader_patterns where user_id = $1 and profile_version = $2 and shown and verdict <> 'neutral'`, [userId, p.active_version]);
  const { rows: traded } = await q.query(`select distinct dims->>'underlying' as u from public.trader_patterns
                                           where user_id = $1 and profile_version = $2 and dims ? 'underlying'`, [userId, p.active_version]);
  return { version: p.active_version, currency: p.currency, patterns: rows.map(patternFromRow), usualQty: p.usual_qty ?? {}, tradedUnderlyings: traded.map((t) => t.u).sort(),
    periodTo: day(p.period_to), unavailable: p.unavailable ?? [] };
}

export async function activeRules(q: Q, userId: string): Promise<TraderRule[]> {
  const { rows } = await q.query('select id, kind, params from public.trader_rules where user_id = $1 and active order by id', [userId]);
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, params: r.params }));
}

export async function contextData(q: Q, userId: string, date: string, now = new Date()): Promise<CheckContextData> {
  const ist = istParts(now);
  const [profile, rules, exp, lots, rates, plans, settings, journal] = await Promise.all([
    checkProfile(q, userId),
    activeRules(q, userId),
    q.query(`select underlying, exchange, expiry::text as expiry, kind from public.expiry_calendar where expiry between $1::date and $1::date + 45 order by expiry`, [date]),
    q.query(`select distinct on (underlying) underlying, lot_size from public.instrument_master
              where valid_to is null and expiry >= $1::date and lot_size is not null order by underlying, expiry`, [date]),
    q.query(`select distinct on (segment, exchange) segment, exchange, stt_buy, stt_sell, stt_exercise, exch_txn, sebi_per_crore, stamp_buy, gst, ipft_per_crore, stt_round_rupee
               from public.charge_rates where effective_from <= $1::date and segment = any($2::text[]) and exchange in ('NSE', 'BSE')
              order by segment, exchange, effective_from desc`, [date, SEGMENTS]),
    q.query('select name, segment, flat_per_order, pct, cap_per_order, is_default from public.brokerage_plans where segment = any($1::text[])', [SEGMENTS]),
    q.query('select brokerage_plan from public.desk_settings where user_id = $1', [userId]),
    q.query('select created_at, pnl from public.journal_trades where user_id = $1 and plan_date = $2 order by created_at', [userId, date]),
  ]);
  const chosen = settings.rows[0]?.brokerage_plan ?? null;
  const costs: CheckContextData['costs'] = {};
  for (const r of rates.rows) {
    const plan = plans.rows.find((p) => p.segment === r.segment && (chosen ? p.name === chosen : p.is_default)) ?? plans.rows.find((p) => p.segment === r.segment && p.is_default);
    if (!plan) continue;
    const n = (v: unknown) => (v == null ? null : Number(v));
    const rate: ChargeRates = { stt_buy: Number(r.stt_buy), stt_sell: Number(r.stt_sell), stt_exercise: Number(r.stt_exercise), exch_txn: Number(r.exch_txn),
      sebi_per_crore: Number(r.sebi_per_crore), stamp_buy: Number(r.stamp_buy), gst: Number(r.gst), ipft_per_crore: Number(r.ipft_per_crore), stt_round_rupee: !!r.stt_round_rupee };
    const brokerage: BrokeragePlan = { flat_per_order: n(plan.flat_per_order), pct: n(plan.pct), cap_per_order: n(plan.cap_per_order) };
    (costs[r.segment as DeskSegment] ??= {})[r.exchange as 'NSE' | 'BSE'] = { rates: rate, brokerage };
  }
  return {
    date, time: date === ist.day ? `${String(Math.floor(ist.minutes / 60)).padStart(2, '0')}:${String(ist.minutes % 60).padStart(2, '0')}` : '09:15',
    expiries: exp.rows, lots: Object.fromEntries(lots.rows.map((l) => [l.underlying, Number(l.lot_size)])), costs,
    profile: profile ? { version: profile.version, currency: profile.currency, patterns: profile.patterns, usualQty: profile.usualQty, tradedUnderlyings: profile.tradedUnderlyings } : null,
    rules,
    journal: journal.rows.map((j) => ({ createdAt: (j.created_at as Date).toISOString(), pnl: j.pnl == null ? null : Number(j.pnl) })),
  };
}
