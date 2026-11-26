/**
 * @file  apps/worker/src/actuals.ts
 * @area  Worker
 * @what  Trade Check phase 3: after a profile rebuild, the trader's plan lines are matched to their tradebook's trades (instrument, date, side; packages/shared/src/plan/actuals.ts), the result stored per line, and each matched day scored with the tradebook's off-plan trades; matches to trades that are gone are cleared and those days scored again from the journal.
 */
import type pg from 'pg';
import { uniqueRows, type SourceRow } from '@pnl-lens/shared/profile/source';
import { matchLines, scoreDay, type MatchTrade } from '@pnl-lens/shared/plan/actuals';

export interface MatchResult { days: number; matched: number; offPlan: number }

export async function matchPlans(pool: pg.Pool, userId: string): Promise<MatchResult> {
  const { rows: src } = await pool.query('select report_id, created_at, currency, trade_id, trade from public.profile_source_trades($1)', [userId]);
  const rows: SourceRow[] = src.map((r) => ({ reportId: r.report_id, createdAt: String(r.created_at), currency: r.currency, tradeId: r.trade_id == null ? null : Number(r.trade_id), trade: r.trade }));
  const trades: MatchTrade[] = uniqueRows(rows).picked.filter((r) => r.tradeId != null && /^\d{4}-\d{2}-\d{2}$/.test(String(r.trade?.entryDate))).map((r) => ({
    id: r.tradeId!, underlying: r.trade.underlying ?? r.trade.symbol ?? null, kind: r.trade.kind, strike: r.trade.strike ?? null,
    direction: r.trade.direction ?? null, entryDate: r.trade.entryDate, pnl: Number(r.trade.pnl),
  }));
  // matches to trades that are gone (a report was deleted) are cleared, and those days scored again from the journal
  const { rows: stale } = await pool.query(`select o.line_id, p.plan_date::text as date from public.plan_outcomes o
      join public.trade_plan_lines l on l.id = o.line_id join public.trade_plans p on p.id = l.plan_id
     where o.user_id = $1 and cardinality(o.matched_trade_ids) > 0 and not (o.matched_trade_ids <@ $2::bigint[])`, [userId, trades.map((t) => t.id)]);
  if (stale.length) await rescoreFromJournal(pool, userId, stale.map((r) => Number(r.line_id)), [...new Set(stale.map((r) => r.date as string))]);
  const dates = [...new Set(trades.map((t) => t.entryDate!))];
  if (!dates.length) return { days: 0, matched: 0, offPlan: 0 };
  const { rows: lines } = await pool.query(`select l.id, p.plan_date::text as date, l.parsed, l.decision, l.check_result from public.trade_plan_lines l
                                              join public.trade_plans p on p.id = l.plan_id where p.user_id = $1 and p.plan_date = any($2::date[]) order by p.plan_date, l.position`, [userId, dates]);
  if (!lines.length) return { days: 0, matched: 0, offPlan: 0 };
  const { matches, offPlan } = matchLines(lines.map((l) => ({ id: Number(l.id), date: l.date, parsed: l.parsed, removed: l.decision === 'removed' })), trades);

  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const l of lines) {
      const m = matches.get(Number(l.id));
      await c.query(`insert into public.plan_outcomes (line_id, user_id, matched_trade_ids, matched_pnl, matched_at) values ($1, $2, $3, $4, $5)
                     on conflict (line_id) do update set matched_trade_ids = excluded.matched_trade_ids, matched_pnl = excluded.matched_pnl, matched_at = excluded.matched_at, updated_at = now()`,
      [l.id, userId, m?.ids ?? [], m ? m.pnl : null, m ? new Date() : null]);
    }
    const { rows: outs } = await c.query('select line_id, taken, manual_pnl, matched_trade_ids, matched_pnl from public.plan_outcomes where user_id = $1 and line_id = any($2::bigint[])', [userId, lines.map((l) => l.id)]);
    const byLine = new Map(outs.map((o) => [Number(o.line_id), { taken: o.taken, manual_pnl: o.manual_pnl == null ? null : Number(o.manual_pnl),
      matched_trade_ids: (o.matched_trade_ids ?? []).map(Number), matched_pnl: o.matched_pnl == null ? null : Number(o.matched_pnl) }]));
    // a day the tradebook covers is scored from the tradebook: its unmatched trades are the off-plan ones
    for (const date of new Set(lines.map((l) => l.date))) {
      const day = lines.filter((l) => l.date === date).map((l) => ({ parsed: l.parsed, decision: l.decision, check_result: l.check_result, outcome: byLine.get(Number(l.id)) ?? null }));
      const s = scoreDay(day, (offPlan.get(date) ?? []).map((t) => ({ pnl: t.pnl })));
      await c.query(`insert into public.plan_day_scores (user_id, plan_date, planned, taken, not_taken, unmarked, off_plan, on_plan_pnl, off_plan_pnl, rules_kept, rules_total, source, scored_at)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'tradebook', now())
                     on conflict (user_id, plan_date) do update set planned = excluded.planned, taken = excluded.taken, not_taken = excluded.not_taken, unmarked = excluded.unmarked,
                       off_plan = excluded.off_plan, on_plan_pnl = excluded.on_plan_pnl, off_plan_pnl = excluded.off_plan_pnl, rules_kept = excluded.rules_kept,
                       rules_total = excluded.rules_total, source = 'tradebook', scored_at = now()`,
      [userId, date, s.planned, s.taken, s.not_taken, s.unmarked, s.off_plan, s.on_plan_pnl, s.off_plan_pnl, s.rules_kept, s.rules_total]);
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
  return { days: new Set(lines.map((l) => l.date)).size, matched: matches.size, offPlan: [...offPlan.values()].reduce((n, x) => n + x.length, 0) };
}

async function rescoreFromJournal(pool: pg.Pool, userId: string, lineIds: number[], dates: string[]) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`update public.plan_outcomes set matched_trade_ids = '{}', matched_pnl = null, matched_at = null, updated_at = now() where line_id = any($1::bigint[])`, [lineIds]);
    for (const date of dates) {
      const { rows: day } = await c.query(`select l.parsed, l.decision, l.check_result,
          case when o.line_id is null then null else jsonb_build_object('taken', o.taken, 'manual_pnl', o.manual_pnl::float8, 'matched_trade_ids', o.matched_trade_ids, 'matched_pnl', o.matched_pnl::float8) end as outcome
          from public.trade_plan_lines l join public.trade_plans p on p.id = l.plan_id left join public.plan_outcomes o on o.line_id = l.id
         where p.user_id = $1 and p.plan_date = $2 order by l.position`, [userId, date]);
      const { rows: j } = await c.query('select pnl::float8 as pnl from public.journal_trades where user_id = $1 and plan_date = $2', [userId, date]);
      const s = scoreDay(day, j);
      await c.query(`update public.plan_day_scores set planned = $3, taken = $4, not_taken = $5, unmarked = $6, off_plan = $7, on_plan_pnl = $8, off_plan_pnl = $9,
                       rules_kept = $10, rules_total = $11, source = 'journal', scored_at = now() where user_id = $1 and plan_date = $2`,
      [userId, date, s.planned, s.taken, s.not_taken, s.unmarked, s.off_plan, s.on_plan_pnl, s.off_plan_pnl, s.rules_kept, s.rules_total]);
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}
