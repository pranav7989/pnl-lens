/**
 * @file  packages/shared/src/plan/desk-checkup.ts
 * @area  Desk
 * @what  Trade Check feeding the report (doc §8.7): the Desk's plan-vs-actual days summed for a report's period (Progress tab), and two 30-day plan rules a statement can't show, "Write the day's plan before the market opens" and "Don't take a trade you didn't plan yourself", scored from the Desk when it was used enough.
 */
import type { CheckItem, PlanCheck } from './score';

export interface DeskDay {
  date: string; planned: number; taken: number; not_taken: number; unmarked: number; off_plan: number;
  on_plan_pnl: number; off_plan_pnl: number; rules_kept: number; rules_total: number; source: 'journal' | 'tradebook';
}
export interface PlanActual {
  from: string; to: string; days: number; planned: number; taken: number; notTaken: number; offPlan: number;
  onPlanPnl: number; offPlanPnl: number; rulesKept: number; rulesTotal: number; tradebookDays: number;
  list: DeskDay[];
}
/** a rule is scored from the Desk only when it was used on at least this many days of the period */
export const MIN_DESK_DAYS = 5;
export const PLAN_DAYS_TARGET = 0.8;

export function planActualFor(days: DeskDay[], from: string, to: string): PlanActual | null {
  const d = days.filter((x) => x.date >= from && x.date <= to && (x.planned > 0 || x.off_plan > 0)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!d.length) return null;
  const sum = (f: (x: DeskDay) => number) => d.reduce((n, x) => n + f(x), 0);
  return {
    from, to, days: d.length, planned: sum((x) => x.planned), taken: sum((x) => x.taken), notTaken: sum((x) => x.not_taken), offPlan: sum((x) => x.off_plan),
    onPlanPnl: sum((x) => Number(x.on_plan_pnl)), offPlanPnl: sum((x) => Number(x.off_plan_pnl)), rulesKept: sum((x) => x.rules_kept), rulesTotal: sum((x) => x.rules_total),
    tradebookDays: d.filter((x) => x.source === 'tradebook').length, list: d,
  };
}

export type DeskCheckItem = CheckItem & { source?: 'desk' };

/**
 * The check-up with the Desk's answers: "written-plan" = days with a Desk plan out of the trading days since the plan
 * (met at 80%); "no-tips" = trades logged as not in the plan (met at none). Only with MIN_DESK_DAYS days on the Desk.
 */
export function withDesk(check: PlanCheck, days: DeskDay[], tradingDays: number, to: string): PlanCheck & { items: DeskCheckItem[] } {
  const since = days.filter((x) => x.date >= check.generatedOn && x.date <= to);
  const used = since.filter((x) => x.planned > 0 || x.off_plan > 0);
  if (used.length < MIN_DESK_DAYS) return check;
  const items: DeskCheckItem[] = check.items.map((i) => {
    if (i.met !== null) return i;
    if (i.id === 'written-plan' && tradingDays > 0) {
      const planned = since.filter((x) => x.planned > 0).length;
      return { ...i, now: `${planned} of ${tradingDays} trading days on the Desk`, met: planned / tradingDays >= PLAN_DAYS_TARGET, source: 'desk' };
    }
    if (i.id === 'no-tips') {
      const off = used.reduce((n, x) => n + x.off_plan, 0);
      return { ...i, now: off === 0 ? `every trade planned (${used.length} Desk days)` : `${off} trade${off === 1 ? '' : 's'} not in your plan (${used.length} Desk days)`, met: off === 0, source: 'desk' };
    }
    return i;
  });
  const measured = items.filter((i) => i.met !== null);
  return { ...check, items, measured: measured.length, met: measured.filter((i) => i.met).length };
}
