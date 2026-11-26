/**
 * @file  packages/shared/test/rewind.test.ts
 * @area  Tests
 * @what  Rewind (what-if replay) on the golden reports: no rules = the real result; each rule does exactly what it says; stops never make a trade worse; date rules need dates; the 30-day plan becomes Rewind settings.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rewind, orderTrades, losingNames, entryHours, planRules, entryWeekday } from '../src/insights/simulate';
import { buildPlan } from '../src/plan/build';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);
const golden = (n: string) => goldens.find((g) => g.name === n)!.report;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('rewind', () => {
  for (const g of goldens) {
    it(`${g.name}: no rules gives the real result; every rule keeps the numbers finite`, () => {
      const T = g.report.trades;
      const base = rewind(T);
      expect(base.delta).toBe(0);
      expect(base.rewound).toEqual(base.actual);
      expect(base.actual.net).toBeCloseTo(sum(T.filter((t: any) => Number.isFinite(t.pnl)).map((t: any) => t.pnl)), 6);
      expect(base.curve.rewound).toEqual(base.curve.actual);
      const all = rewind(T, { stopPct: 20, skipWeekdays: ['Friday'], skipHours: [9], maxPerDay: 3, stopAfterLosses: 2, noReentryAfterLoss: true, skipNames: [losingNames(T)[0]?.name].filter(Boolean) as string[], maxSize: 50_000 });
      expect(JSON.stringify(all)).not.toMatch(/NaN|null,null|Infinity/);
      expect(all.curve.rewound).toHaveLength(base.curve.actual.length);
      expect(all.rewound.n + all.skipped).toBe(base.actual.n);
    });
  }

  it('a stop never makes a trade worse, and caps exactly the trades that lost more', () => {
    for (const g of goldens) {
      const T = g.report.trades, r = rewind(T, { stopPct: 25 });
      expect(r.delta).toBeGreaterThanOrEqual(0);
      const deeper = T.filter((t: any) => Number(t.pct) < -25 && Number(t.buy) > 0 && -(0.25 * t.buy) > t.pnl);
      expect(r.stopped).toBe(deeper.length);
      expect(r.delta).toBeCloseTo(sum(deeper.map((t: any) => -(0.25 * t.buy) - t.pnl)), 4);
    }
  });

  it('skipping a name removes exactly its trades', () => {
    const T = golden('zerodha_tradebook_csv').trades, worst = losingNames(T)[0];
    const r = rewind(T, { skipNames: [worst.name] });
    expect(r.skipped).toBe(worst.n);
    expect(r.delta).toBeCloseTo(-worst.pnl, 6);
  });

  it('day rules: at most N a day, stop after N losses, no re-entry after a loss', () => {
    const T = golden('zerodha_tradebook_csv').trades;
    const kept = (rules: any) => { const r = rewind(T, rules); return r; };
    const days = new Set(T.map((t: any) => t.entryDate || t.exitDate)).size;
    expect(kept({ maxPerDay: 1 }).rewound.n).toBe(days);
    const r2 = kept({ stopAfterLosses: 1 }), r3 = kept({ noReentryAfterLoss: true });
    expect(r2.rewound.n).toBeLessThan(T.length);
    expect(r3.rewound.n).toBeGreaterThanOrEqual(r2.rewound.n);       // "no re-entry after a loss" can trade again after a win
  });

  it('weekday and hour rules use the entry date and hour', () => {
    const T = golden('zerodha_tradebook_csv').trades;
    const fri = T.filter((t: any) => entryWeekday(t) === 'Friday');
    expect(rewind(T, { skipWeekdays: ['Friday'] }).skipped).toBe(fri.length);
    const h = entryHours(T)[0];
    expect(rewind(T, { skipHours: [h.hour] }).skipped).toBe(h.n);
  });

  it('a statement without dates offers only the rules it can show', () => {
    const a = rewind(golden('zerodha_fo_statement_xlsx').trades).available;
    expect(a).toMatchObject({ stopPct: true, maxSize: true, skipNames: true, maxPerDay: false, stopAfterLosses: false, noReentryAfterLoss: false, skipWeekdays: false, skipHours: false });
    expect(rewind(golden('zerodha_fo_statement_xlsx').trades, { maxPerDay: 1 }).skipped).toBe(0);
  });

  it('byRule shows each rule on its own, best first', () => {
    const T = golden('zerodha_tradebook_csv').trades;
    const r = rewind(T, { stopPct: 30, noReentryAfterLoss: true });
    expect(r.byRule.map((b) => b.rule).sort()).toEqual(['noReentryAfterLoss', 'stopPct']);
    expect(r.byRule[0].delta).toBeGreaterThanOrEqual(r.byRule[1].delta);
    expect(r.byRule.find((b) => b.rule === 'stopPct')!.delta).toBeCloseTo(rewind(T, { stopPct: 30 }).delta, 6);
  });

  it('the 30-day plan becomes Rewind settings', () => {
    const plan = buildPlan(golden('zerodha_tradebook_csv'), { generatedAt: new Date('2026-10-27T06:00:00Z') });
    const rules = planRules(plan);
    expect(rules.stopPct).toBe(30);
    expect(rules.skipNames).toEqual([plan.donts.find((d) => d.id === 'avoid-worst')!.metric!.param]);
    expect(rules.noReentryAfterLoss).toBe(true);
    expect(rewind(golden('zerodha_tradebook_csv').trades, rules).delta).toBeGreaterThan(0);
  });

  it('orders trades by date and entry hour; undated trades keep file order at the end', () => {
    const T = [{ pnl: 1, entryDate: '2025-01-02', entryHour: 11 }, { pnl: 2 }, { pnl: 3, entryDate: '2025-01-02', entryHour: 9 }, { pnl: 4, entryDate: '2025-01-01' }, { pnl: 5 }];
    expect(orderTrades(T).map((t) => t.pnl)).toEqual([4, 3, 1, 2, 5]);
  });
});
