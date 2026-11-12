/**
 * @file  packages/shared/test/capital.test.ts
 * @area  Tests
 * @what  Capital %: return, a year at this pace (only for 30+ days), average/largest loss, worst day, drawdown and the 1% / 2% loss counts on a hand-made case; null without capital; finite on every golden report.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capitalStats } from '../src/insights/capital';

const d = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

describe('capital %', () => {
  it('a hand-made month', () => {
    // capital 100,000; days: +3,000, −1,500 (two trades −500 and −1,000), +500 … across 60 days
    const T = [{ pnl: 3000, exitDate: d(0) }, { pnl: -500, exitDate: d(10) }, { pnl: -1000, exitDate: d(10) }, { pnl: 2500, exitDate: d(59) }];
    const c = capitalStats(T, 100_000)!;
    expect(c.returnPct).toBeCloseTo(4, 6);
    expect(c.spanDays).toBe(60);
    expect(c.yearPct).toBeCloseTo(4 * 365 / 60, 6);
    expect(c.avgTradePct).toBeCloseTo(1, 6);
    expect(c.avgLossPct).toBeCloseTo(-0.75, 6);
    expect(c.largestLossPct).toBeCloseTo(-1, 6);
    expect(c.worstDayPct).toBeCloseTo(-1.5, 6);
    expect(c.maxDDPct).toBeCloseTo(-1.5, 6);
    expect(c.over1).toBe(0);                     // −1,000 is exactly 1%, not more
    expect(c.over2).toBe(0);
  });
  it('no capital or no trades: null; a short span has no yearly figure', () => {
    expect(capitalStats([{ pnl: 1 }], null)).toBeNull();
    expect(capitalStats([{ pnl: 1 }], 0)).toBeNull();
    expect(capitalStats([], 1000)).toBeNull();
    expect(capitalStats([{ pnl: 10, exitDate: d(0) }, { pnl: -30, exitDate: d(5) }], 1000)!.yearPct).toBeNull();
    expect(capitalStats([{ pnl: -30 }, { pnl: -10 }], 1000)).toMatchObject({ over1: 0.5, over2: 0.5 });
  });
  it('finite on every golden report', () => {
    const dir = join(__dirname, '../../engine/test/golden');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')).report; if (!r) continue;
      expect(JSON.stringify(capitalStats(r.trades, 500_000)), f).not.toMatch(/NaN|Infinity/);
    }
  });
});
