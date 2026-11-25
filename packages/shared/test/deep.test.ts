/**
 * @file  packages/shared/test/deep.test.ts
 * @area  Tests
 * @what  Deep dive statistics: consistency/risk by day, R-multiples, weekday × hour heatmap and days to expiry: correct on small hand-made cases, finite and complete on every golden report, null when the statement cannot show them.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consistency, rMultiples, heatmap, daysToExpiry, DTE_ORDER } from '../src/insights/deep';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);
const golden = (n: string) => goldens.find((g) => g.name === n)!.report;
const d = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

describe('consistency by day', () => {
  it('counts green days, finds the drawdown, its length and the recovery', () => {
    // daily: +100, +100, −50, −150, +50, +200, +10
    const pnl = [100, 100, -50, -150, 50, 200, 10];
    const c = consistency(pnl.map((p, i) => ({ pnl: p, exitDate: d(i) })))!;
    expect(c.days).toBe(7);
    expect(c.greenDays).toBeCloseTo(5 / 7, 6);
    expect(c.maxDD).toBe(-200);
    expect(c.ddDays).toBe(2);                        // peak on day 2 (index 1) → trough on day 4 (index 3)
    expect(c.recoveryDays).toBe(2);                  // back above 200 on index 5
    expect(c.underwaterNow).toBe(0);
    expect(c.bestDay).toEqual({ date: d(5), pnl: 200 });
    expect(c.worstDay).toEqual({ date: d(3), pnl: -150 });
    expect(c.top3Share).toBeCloseTo(Math.min(1, 400 / 260), 6);
    expect(c.sharpe).toBeNull();                      // fewer than 10 days
  });
  it('null without enough dated days; sums several trades on one day', () => {
    expect(consistency([{ pnl: 5 }, { pnl: 6 }])).toBeNull();
    const c = consistency([1, 2, 3, 4, 5, 6].flatMap((i) => [{ pnl: 10, exitDate: d(i) }, { pnl: -4, exitDate: d(i) }]))!;
    expect(c.days).toBe(6);
    expect(c.avgDay).toBe(6);
  });
});

describe('R-multiples', () => {
  it('1R is the average loss; buckets cover every trade', () => {
    const t = [-100, -100, -100, 50, 150, 250, 350, -250, 10, 20].map((pnl) => ({ pnl }));
    const r = rMultiples(t)!;
    expect(r.r).toBeCloseTo(137.5, 6);
    expect(r.buckets.reduce((s, b) => s + b.n, 0)).toBe(10);
    expect(r.bigWins).toBe(1);                         // 350 = 2.5R; 250 = 1.8R
    expect(r.bigLosses).toBe(0);
  });
});

describe('timing', () => {
  it('days to expiry ignores expiries before the entry date', () => {
    const base = { isOpt: true, pnl: 10 };
    const t = [
      { ...base, entryDate: '2025-01-02', expiry: '2025-01-02' }, { ...base, entryDate: '2025-01-02', expiry: '2025-01-03' },
      { ...base, entryDate: '2025-01-02', expiry: '2025-01-08' }, { ...base, entryDate: '2025-01-02', expiry: '2025-01-30' },
      { ...base, entryDate: '2025-01-02', expiry: '2025-01-09' }, { ...base, entryDate: '2025-01-02', expiry: '2024-10-31' },
    ];
    const b = daysToExpiry(t)!;
    expect(b.map((x) => x.key)).toEqual(DTE_ORDER);
    expect(b.reduce((s, x) => s + x.n, 0)).toBe(5);
  });
});

describe('on every golden report', () => {
  for (const g of goldens) {
    it(`${g.name}: finite or null`, () => {
      const T = g.report.trades;
      const all = { c: consistency(T), r: rMultiples(T), h: heatmap(T), e: daysToExpiry(T) };
      expect(JSON.stringify(all)).not.toMatch(/NaN|Infinity/);
      if (all.r) expect(all.r.buckets.reduce((s, b) => s + b.n, 0)).toBe(T.filter((t: any) => Number.isFinite(t.pnl)).length);
      if (all.h) expect(Object.values(all.h.cells).reduce((s, c) => s + c.n, 0)).toBe(T.filter((t: any) => t.entryDate && Number.isFinite(t.entryHour)).length);
    });
  }
  it('a tradebook with dates and hours gets every section; a statement without dates gets none of the dated ones', () => {
    const tb = golden('zerodha_tradebook_csv').trades;
    expect(consistency(tb) && heatmap(tb) && rMultiples(tb)).toBeTruthy();
    const st = golden('zerodha_fo_statement_xlsx').trades;
    expect([consistency(st), heatmap(st), daysToExpiry(st)]).toEqual([null, null, null]);
  });
});
