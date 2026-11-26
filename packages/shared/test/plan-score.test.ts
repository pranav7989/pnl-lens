/**
 * @file  packages/shared/test/plan-score.test.ts
 * @area  Tests
 * @what  30-day plan check-up scoring on the golden reports: metrics match the plan's own numbers, better trading scores Met, habit-only rules are not measurable, trades since the plan are used when there are enough.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlan, measure } from '../src/plan/build';
import { scorePlan, MIN_TRADES_SINCE } from '../src/plan/score';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);
const golden = (n: string) => goldens.find((g) => g.name === n)!.report;
const at = new Date('2026-10-27T06:00:00Z');

describe('plan check-up scoring', () => {
  for (const g of goldens) {
    it(`${g.name}: every metric is re-measured to the plan's own number; the same statement does not meet its targets`, () => {
      const plan = buildPlan(g.report, { generatedAt: at });
      for (const r of [...plan.dos, ...plan.donts]) if (r.metric) expect(measure(g.report, r.metric.key, r.metric.param), r.id).toBeCloseTo(r.metric.now, 6);
      const check = scorePlan(plan, g.report);
      expect(check.items).toHaveLength(10);
      expect(check.scope).toBe('all');                      // the golden trades are all before the plan date
      expect(check.measured).toBe([...plan.dos, ...plan.donts].filter((r) => r.metric).length);
      for (const i of check.items) {
        if (i.met === null) expect(i.now).toBeNull();
        else expect(i.now).toMatch(/\d|no |sized up/);
      }
      // a plan's targets are improvements on that very statement, so (almost) nothing is met against itself
      expect(check.met).toBeLessThanOrEqual(Math.ceil(check.measured / 3));
      expect(JSON.stringify(check)).not.toMatch(/NaN|Infinity|undefined/);
    });
  }

  it('habit-only rules are not measurable from a statement', () => {
    const check = scorePlan(buildPlan(golden('groww_pnl_csv'), { generatedAt: at }), golden('groww_pnl_csv'));
    const habit = check.items.find((i) => ['weekly-review', 'daily-limit', 'note', 'review-worst', 'same-size', 'written-plan'].includes(i.id));
    expect(habit).toMatchObject({ met: null, now: null });
  });

  it('better trading next month scores Met: no losses held past the stop, no trades in the banned name', () => {
    const before = golden('zerodha_tradebook_csv');
    const plan = buildPlan(before, { generatedAt: at });
    const stop = plan.donts.find((r) => r.id === 'hold-past-stop')!, ban = plan.donts.find((r) => r.id === 'avoid-worst')!;
    expect(stop && ban).toBeTruthy();
    const better = { ...before, trades: before.trades.filter((t: any) => Number(t.pct) > -30 && (t.underlying || t.symbol) !== ban.metric!.param) };
    const items = Object.fromEntries(scorePlan(plan, better).items.map((i) => [i.id, i]));
    expect(items['hold-past-stop']).toMatchObject({ met: true, now: '0 past −30%' });
    expect(items['avoid-worst']).toMatchObject({ met: true });
    expect(items['avoid-worst'].now).toMatch(/^0 trades in /);
  });

  it('uses only the trades since the plan date when there are enough of them', () => {
    const before = golden('zerodha_tradebook_csv');
    const plan = buildPlan(before, { generatedAt: at });
    const shift = (t: any, d: string) => ({ ...t, entryDate: d, exitDate: d });
    const after = before.trades.slice(0, MIN_TRADES_SINCE).map((t: any) => shift(t, '2026-11-03'));
    const next = { ...before, trades: [...before.trades, ...after] };
    const check = scorePlan(plan, next);
    expect(check).toMatchObject({ scope: 'since', trades: MIN_TRADES_SINCE, generatedOn: '2026-10-27' });
    expect(check.items.find((i) => i.id === 'charges')?.met ?? null).toBeNull();   // statement totals are not split by date
    const few = scorePlan(plan, { ...before, trades: [...before.trades, ...after.slice(0, MIN_TRADES_SINCE - 1)] });
    expect(few.scope).toBe('all');
  });
});
