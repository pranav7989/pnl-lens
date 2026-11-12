/**
 * @file  packages/shared/test/edge.test.ts
 * @area  Tests
 * @what  Edge verdict and projection: deterministic, sensible on clear cases (always winning, coin flip, always losing, too few), finite and ordered on every golden report.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { edgeVerdict, project, rng, MIN_TRADES } from '../src/insights/edge';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);
const T = (xs: number[]) => xs.map((pnl) => ({ pnl }));
const series = (n: number, f: (i: number, r: () => number) => number) => { const r = rng(7); return T(Array.from({ length: n }, (_, i) => f(i, r))); };

describe('edge verdict', () => {
  it('a clear winner is real, a clear loser is negative, a coin flip is unproven, a short list is too few', () => {
    const win = edgeVerdict(series(200, (_, r) => 100 + (r() - 0.5) * 120));
    expect(win.verdict).toBe('real');
    expect(win.luck).toBeLessThan(0.01);
    expect(win.low).toBeGreaterThan(0);
    expect(win.needed).toBeGreaterThanOrEqual(200);
    expect(edgeVerdict(series(200, (_, r) => -100 + (r() - 0.5) * 120)).verdict).toBe('negative');
    const flip = edgeVerdict(series(400, (i) => (i % 2 ? 1000 : -1000)));
    expect(flip.verdict).toBe('unproven');
    expect(flip.luck).toBeGreaterThan(0.3);
    expect(flip.low).toBeLessThan(0);
    expect(flip.high).toBeGreaterThan(0);
    expect(edgeVerdict(T([5, 6, 7])).verdict).toBe('too-few');
  });

  it('is deterministic for the same trades', () => {
    const t = series(150, (_, r) => (r() - 0.45) * 1000);
    expect(edgeVerdict(t)).toEqual(edgeVerdict(t));
    expect(project(t)).toEqual(project(t));
  });

  it('a wider spread needs more trades to be sure', () => {
    const tight = edgeVerdict(series(100, (_, r) => 50 + (r() - 0.5) * 100)), wide = edgeVerdict(series(100, (_, r) => 50 + (r() - 0.5) * 4000));
    expect(tight.needed).toBe(100);                       // already enough trades: nothing more needed
    expect(wide.needed!).toBeGreaterThan(100);
  });
});

describe('projection', () => {
  it('bands are ordered at every step and start at 0; chances are between 0 and 1', () => {
    const p = project(series(120, (_, r) => (r() - 0.4) * 1000))!;
    expect(p.p50).toHaveLength(101);
    expect([p.p5[0], p.p50[0], p.p95[0]]).toEqual([0, 0, 0]);
    for (let i = 0; i <= p.horizon; i++) expect(p.p5[i] <= p.p25[i] && p.p25[i] <= p.p50[i] && p.p50[i] <= p.p75[i] && p.p75[i] <= p.p95[i]).toBe(true);
    for (const v of [p.profitChance, p.giveBack25!, p.giveBack50!]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(p.giveBack50!).toBeLessThanOrEqual(p.giveBack25!);
    expect(p.ddBad).toBeLessThanOrEqual(p.ddTypical);
    expect(p.ddTypical).toBeLessThanOrEqual(0);
  });

  it('a winner mostly ends in profit; a loser mostly does not; no profit means no give-back figure', () => {
    expect(project(series(100, (_, r) => 100 + (r() - 0.5) * 200))!.profitChance).toBeGreaterThan(0.95);
    const lose = project(series(100, (_, r) => -100 + (r() - 0.5) * 200))!;
    expect(lose.profitChance).toBeLessThan(0.05);
    expect(lose.giveBack25).toBeNull();
    expect(project(T([1, 2, 3]))).toBeNull();
  });

  for (const g of goldens) {
    it(`${g.name}: finite numbers`, () => {
      const e = edgeVerdict(g.report.trades), p = project(g.report.trades);
      expect(JSON.stringify([e, p])).not.toMatch(/NaN|Infinity/);
      if (g.report.trades.length >= MIN_TRADES) { expect(e.verdict).not.toBe('too-few'); expect(p).not.toBeNull(); expect(e.low).toBeLessThanOrEqual(e.high); }
      else expect(e.verdict).toBe('too-few');
    });
  }
});
