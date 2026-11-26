/**
 * @file  packages/shared/src/plan/score.ts
 * @area  Reports
 * @what  30-day plan check-up: scores each measurable rule of an earlier plan against a newer report (Met / Missed / not measurable), on the trades since the plan when there are enough.
 */
/**
 * Pure and deterministic. The plan rules carry their metric (build.ts: key, value then, target, comparison); this
 * re-measures the same metric on the new report with the same code that wrote the plan. Habit-only rules ("write
 * the day's plan") cannot be seen in a statement and come back as met: null.
 */
import { measure, fmtMoney, type Plan, type PlanRule, type MetricKey, type RuleMetric } from './build';

export interface CheckItem {
  id: string; kind: 'do' | 'dont'; title: string; habit: string;
  /** the plan's own wording: the number when the plan was made, and the target */
  before: string; target: string;
  /** the same metric on the new report, formatted; null when it cannot be measured */
  now: string | null;
  met: boolean | null;
}
export interface PlanCheck {
  generatedOn: string; checkupOn: string;
  /** 'since': only trades on or after the plan date; 'all': the whole new statement (too few dated trades after it) */
  scope: 'since' | 'all';
  trades: number;
  items: CheckItem[];
  met: number;
  measured: number;
}

/** at least this many trades after the plan date to score only those */
export const MIN_TRADES_SINCE = 5;

const one = (v: number) => (Math.round(v * 10) / 10).toString();
const pct = (v: number) => `${Math.round(v)}%`;

export function formatMetric(key: MetricKey, v: number, cur: string, param?: string): string {
  switch (key) {
    case 'avg-per-expiry': return `${one(v)} per expiry`;
    case 'avg-size': return `${fmtMoney(v, cur)} average`;
    case 'share-past-10': return `${pct(v)} past −10%`;
    case 'share-wins-under-10': return `${pct(v)} of wins under +10%`;
    case 'names': return `${v} name${v === 1 ? '' : 's'} traded`;
    case 'largest-loss': return v > 0 ? `${fmtMoney(-v, cur)} largest loss` : 'no losing trade';
    case 'payoff': return `${one(v)} win-to-loss ratio`;
    case 'max-strikes': return `${v} strike${v === 1 ? '' : 's'} at most`;
    case 'size-up': return v ? 'sized up after a good month' : 'no size-up after a good month';
    case 'past-stop': return `${v} past −${String(param || 'opt:30').split(':')[1]}%`;
    case 'name-trades': return `${v} trade${v === 1 ? '' : 's'} in ${param}`;
    case 'charges-ratio': return `${pct(v)} of gross profit`;
    case 're-entries': return `${v} same-day re-entr${v === 1 ? 'y' : 'ies'}`;
    case 'worst-share': return `${pct(v)} of losses`;
    case 'streak': return `${v} loss${v === 1 ? '' : 'es'} in a row at most`;
    case 'hold-losers': return `${one(v)} days on losers`;
    case 'per-week': return `${one(v)} a week`;
  }
}

const isMet = (m: RuleMetric, v: number) => (m.op === 'lt' ? v < m.target : m.op === 'le' ? v <= m.target + 1e-9 : v >= m.target - 1e-9);
const dateOf = (t: any) => String(t?.exitDate || t?.entryDate || '').slice(0, 10);

/** Scores `plan` (made earlier) against `report` (a later statement). */
export function scorePlan(plan: Pick<Plan, 'generatedAt' | 'checkupOn' | 'dos' | 'donts'>, report: any): PlanCheck {
  const all: any[] = (report?.trades || []).filter((t: any) => Number.isFinite(t?.pnl));
  const since = all.filter((t) => dateOf(t) && dateOf(t) >= plan.generatedAt);
  const scope: PlanCheck['scope'] = since.length >= MIN_TRADES_SINCE ? 'since' : 'all';
  // statement totals (charges, gross profit) cover the whole file, so they are not used for a part of it
  const scored = scope === 'since' ? { ...report, trades: since, m: { currency: report?.m?.currency } } : report;
  const cur = String(report?.m?.currency || 'INR').toUpperCase();
  const items: CheckItem[] = [...(plan.dos || []), ...(plan.donts || [])].map((r: PlanRule) => {
    const base = { id: r.id, kind: r.kind, title: r.title, habit: r.habit, before: r.now, target: r.target };
    if (!r.metric) return { ...base, now: null, met: null };
    const v = measure(scored, r.metric.key, r.metric.param);
    if (v === null || !Number.isFinite(v)) return { ...base, now: null, met: null };
    return { ...base, now: formatMetric(r.metric.key, v, cur, r.metric.param), met: isMet(r.metric, v) };
  });
  const measured = items.filter((i) => i.met !== null);
  return {
    generatedOn: plan.generatedAt, checkupOn: plan.checkupOn, scope, trades: scope === 'since' ? since.length : all.length,
    items, met: measured.filter((i) => i.met).length, measured: measured.length,
  };
}
