/**
 * @file  packages/shared/test/benchmarks.test.ts
 * @area  Tests
 * @what  Peer benchmarks: segment from the main instrument group, metrics from trades (same with research-view field names), quantiles, and percentiles (direction, clamping, interpolation).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentOf, benchmarkValues, quantiles, percentileOf, QUANTILES } from '../src/insights/benchmarks';

const g = (n: string) => JSON.parse(readFileSync(join(__dirname, '../../engine/test/golden', n + '.json'), 'utf8')).report;

describe('benchmarks', () => {
  it('segment = market + main instrument group; same with research-view field names', () => {
    const tb = g('zerodha_tradebook_csv');
    const counts = new Map<string, number>(); for (const t of tb.trades) counts.set(t.group, (counts.get(t.group) || 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];   // ties: alphabetical, like segmentOf
    expect(segmentOf(tb.trades, tb.m.market)).toBe(`India · ${main}`);
    expect(segmentOf(tb.trades.map((t: any) => ({ ...t, grp: t.group, group: undefined })), 'India')).toBe(`India · ${main}`);
    expect(segmentOf(g('zerodha_fo_statement_xlsx').trades, 'India')).toBe('India · Index options');
    expect(segmentOf([], 'India')).toBeNull();
  });

  it('metrics from trades; under 10 trades none', () => {
    const tb = g('zerodha_tradebook_csv'), v = benchmarkValues(tb.trades)!;
    expect(v.win_rate).toBeCloseTo(tb.m.winRate, 6);
    expect(v.profit_factor).toBeCloseTo(tb.m.profitFactor, 4);
    expect(v.deep_loss_share).toBeGreaterThan(0);
    expect(benchmarkValues(tb.trades.slice(0, 9))).toBeNull();
    expect(benchmarkValues(Array.from({ length: 12 }, () => ({ pnl: 5, pct: 3 })))).toMatchObject({ win_rate: 1, payoff: null, profit_factor: null, deep_loss_share: 0 });
  });

  it('quantiles and percentiles', () => {
    const vals = Array.from({ length: 101 }, (_, i) => i);                // 0 … 100
    const qs = quantiles(vals);
    expect(qs).toHaveLength(QUANTILES.length);
    expect(qs[0]).toBeCloseTo(5, 6); expect(qs[9]).toBeCloseTo(50, 6); expect(qs[18]).toBeCloseTo(95, 6);
    expect(percentileOf(72, qs, true)).toBeCloseTo(0.72, 6);
    expect(percentileOf(72, qs, false)).toBeCloseTo(0.28, 6);             // lower is better
    expect(percentileOf(-10, qs, true)).toBe(0.02);
    expect(percentileOf(500, qs, true)).toBe(0.98);
    expect(percentileOf(500, qs, false)).toBeCloseTo(0.02, 9);
    expect(percentileOf(5, [], true)).toBe(0.5);
  });
});
