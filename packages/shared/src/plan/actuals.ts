/**
 * @file  packages/shared/src/plan/actuals.ts
 * @area  Desk
 * @what  Trade Check phase 3 (doc §8.6–8.7): a plan line's outcome (taken or not, result; a tradebook match wins over what the trader typed), matching a tradebook's trades to the day's lines by instrument, date and side, and the day's plan-vs-actual score (planned, taken, off-plan, on-plan and off-plan P&L, rules kept).
 */
import type { ParsedLine } from './parse';
import type { CheckResult } from './check';

export interface Outcome { taken: boolean | null; manual_pnl: number | null; matched_trade_ids: number[]; matched_pnl: number | null }
export interface ScoreLine { parsed: ParsedLine; decision: 'edited' | 'removed' | 'kept' | null; check_result: CheckResult | null; outcome: Outcome | null }
export interface DayScore {
  planned: number; taken: number; not_taken: number; unmarked: number; off_plan: number;
  on_plan_pnl: number; off_plan_pnl: number; rules_kept: number; rules_total: number; source: 'journal' | 'tradebook';
}

/** What happened to a line: a tradebook match is the truth; otherwise what the trader marked. */
export function outcomeOf(o: Outcome | null): { taken: boolean | null; pnl: number | null; from: 'tradebook' | 'journal' | null } {
  if (o?.matched_trade_ids?.length) return { taken: true, pnl: o.matched_pnl, from: 'tradebook' };
  if (o?.taken == null) return { taken: null, pnl: null, from: null };
  return { taken: o.taken, pnl: o.taken ? o.manual_pnl : null, from: 'journal' };
}

/** The day's plan vs actual. A taken line kept the rules when its check showed no rule break. */
export function scoreDay(lines: ScoreLine[], offPlan: { pnl: number | null }[]): DayScore {
  const live = lines.filter((l) => l.decision !== 'removed');
  const o = live.map((l) => ({ l, r: outcomeOf(l.outcome) }));
  const taken = o.filter((x) => x.r.taken === true);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (Number.isFinite(v) ? Number(v) : 0), 0);
  return {
    planned: live.length, taken: taken.length, not_taken: o.filter((x) => x.r.taken === false).length, unmarked: o.filter((x) => x.r.taken == null).length,
    off_plan: offPlan.length, on_plan_pnl: sum(taken.map((x) => x.r.pnl)), off_plan_pnl: sum(offPlan.map((x) => x.pnl)),
    rules_kept: taken.filter((x) => !(x.l.check_result?.chips ?? []).some((c) => c.level === 'block')).length, rules_total: taken.length,
    source: o.some((x) => x.r.from === 'tradebook') ? 'tradebook' : 'journal',
  };
}

export interface MatchLine { id: number; date: string; parsed: ParsedLine; removed: boolean }
export interface MatchTrade { id: number; underlying: string | null; kind: string; strike: number | null; direction: string | null; entryDate: string | null; pnl: number }

const sameTrade = (l: MatchLine, t: MatchTrade) => {
  const p = l.parsed;
  if (t.entryDate !== l.date || !p.underlying || String(t.underlying ?? '').toUpperCase() !== p.underlying || t.kind !== p.kind) return false;
  if ((p.kind === 'CE' || p.kind === 'PE') && p.strike != null && t.strike != null && Number(t.strike) !== p.strike) return false;
  if (t.direction && p.side && (t.direction === 'Long' ? 'buy' : 'sell') !== p.side) return false;
  return true;
};

/**
 * Lines to the tradebook's trades of the same day: same instrument (and strike), same opening side. Each trade goes to
 * one line: first one trade per line in plan order, then any further fills of the same instrument join the first line
 * that matched it (scaling in/out). Trades of a planned day that match no line are off-plan.
 */
export function matchLines(lines: MatchLine[], trades: MatchTrade[]): { matches: Map<number, { ids: number[]; pnl: number }>; offPlan: Map<string, MatchTrade[]> } {
  const live = lines.filter((l) => !l.removed);
  const used = new Set<number>(), matches = new Map<number, { ids: number[]; pnl: number }>();
  for (const l of live) {
    const t = trades.find((x) => !used.has(x.id) && sameTrade(l, x));
    if (t) { used.add(t.id); matches.set(l.id, { ids: [t.id], pnl: t.pnl }); }
  }
  for (const t of trades) {
    if (used.has(t.id)) continue;
    const l = live.find((x) => matches.has(x.id) && sameTrade(x, t));
    if (l) { const m = matches.get(l.id)!; m.ids.push(t.id); m.pnl += t.pnl; used.add(t.id); }
  }
  const days = new Set(live.map((l) => l.date)), offPlan = new Map<string, MatchTrade[]>();
  for (const t of trades) if (!used.has(t.id) && t.entryDate && days.has(t.entryDate)) offPlan.set(t.entryDate, [...(offPlan.get(t.entryDate) ?? []), t]);
  return { matches, offPlan };
}
