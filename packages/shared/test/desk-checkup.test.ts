/**
 * @file  packages/shared/test/desk-checkup.test.ts
 * @area  Tests
 * @what  Trade Check in the report: the Desk's days summed for a report's period (only days with a plan or a logged trade), and the 30-day check-up's "written plan" and "no unplanned trades" rules scored from the Desk only after 5 Desk days, measured counts updated.
 */
import { describe, it, expect } from 'vitest';
import { planActualFor, withDesk, type DeskDay } from '../src/plan/desk-checkup';
import type { PlanCheck } from '../src/plan/score';

const day = (date: string, o: Partial<DeskDay> = {}): DeskDay => ({ date, planned: 2, taken: 1, not_taken: 1, unmarked: 0, off_plan: 0, on_plan_pnl: 1000, off_plan_pnl: 0, rules_kept: 1, rules_total: 1, source: 'journal', ...o });
const check: PlanCheck = { generatedOn: '2026-10-01', checkupOn: '2026-10-31', scope: 'since', trades: 40, met: 1, measured: 2, items: [
  { id: 'cap-expiry', kind: 'do', title: 'Cap each expiry.', habit: '', before: '9', target: '6', now: '5', met: true },
  { id: 'payoff', kind: 'do', title: 'Payoff.', habit: '', before: '0.8', target: '1.2', now: '0.9', met: false },
  { id: 'written-plan', kind: 'do', title: 'Write the day’s plan before the market opens.', habit: '', before: 'Not tracked', target: 'every trading day', now: null, met: null },
  { id: 'no-tips', kind: 'dont', title: 'Don’t take a trade you didn’t plan yourself.', habit: '', before: 'Not tracked', target: 'every trade planned', now: null, met: null },
] };

describe('plan vs actual for a report period', () => {
  it('sums only the period, only days the Desk was used', () => {
    const a = planActualFor([day('2026-09-30'), day('2026-10-02'), day('2026-10-03', { off_plan: 2, off_plan_pnl: -500, source: 'tradebook' }), day('2026-10-04', { planned: 0, taken: 0, not_taken: 0 })], '2026-10-01', '2026-10-31')!;
    expect(a).toMatchObject({ days: 2, planned: 4, taken: 2, offPlan: 2, onPlanPnl: 2000, offPlanPnl: -500, rulesKept: 2, rulesTotal: 2, tradebookDays: 1 });
    expect(a.list.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03']);
    expect(planActualFor([day('2026-09-30')], '2026-10-01', '2026-10-31')).toBeNull();
  });
});

describe('the 30-day check-up from the Desk', () => {
  const days = (n: number, o: Partial<DeskDay> = {}) => Array.from({ length: n }, (_, i) => day(`2026-10-${String(2 + i).padStart(2, '0')}`, o));
  it('under 5 Desk days: unchanged', () => {
    expect(withDesk(check, days(4), 20, '2026-10-30')).toBe(check);
  });
  it('written plan met at 80% of trading days; unplanned trades met at none; counts updated', () => {
    const r = withDesk(check, days(17), 20, '2026-10-30');
    expect(r.items.find((i) => i.id === 'written-plan')).toMatchObject({ now: '17 of 20 trading days on the Desk', met: true, source: 'desk' });
    expect(r.items.find((i) => i.id === 'no-tips')).toMatchObject({ now: 'every trade planned (17 Desk days)', met: true, source: 'desk' });
    expect([r.met, r.measured]).toEqual([3, 4]);
    const worse = withDesk(check, [...days(10), ...days(2, { off_plan: 1 }).map((d, i) => ({ ...d, date: `2026-10-2${i}` }))], 20, '2026-10-30');
    expect(worse.items.find((i) => i.id === 'written-plan')!.met).toBe(false);
    expect(worse.items.find((i) => i.id === 'no-tips')).toMatchObject({ now: '2 trades not in your plan (12 Desk days)', met: false });
    expect(worse.items.find((i) => i.id === 'payoff')).toEqual(check.items[1]);       // measured rules are left alone
  });
});
