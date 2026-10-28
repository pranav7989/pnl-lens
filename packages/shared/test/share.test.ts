/**
 * @file  packages/shared/test/share.test.ts
 * @area  Tests
 * @what  Share card content: level and score from Progress, the chosen stats only (4 at most), return only with capital, and never a money amount, currency sign or symbol on any golden report.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shareCard, periodLabel } from '../src/insights/share';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f, report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report })).filter((g) => g.report);
const tb = goldens.find((g) => g.name === 'zerodha_tradebook_csv.json')!.report;

describe('share card', () => {
  it('level, score, period and the default stats', () => {
    const c = shareCard(tb, { planCheck: { met: 5, measured: 8 } });
    expect(c).toMatchObject({ level: 'Disciplined', score: tb.progress.months.at(-1).score, period: 'Jan–Mar 2025', trades: 96 });
    expect(c.items.map((i) => i.key)).toEqual(['winRate', 'edge', 'plan', 'greenDays']);
    expect(c.items.find((i) => i.key === 'plan')!.value).toBe('5 of 8 rules met');
  });
  it('only what the user picked; return only when capital is set', () => {
    expect(shareCard(tb, { include: ['return', 'winRate'] }).items.map((i) => i.key)).toEqual(['winRate']);
    const withCap = shareCard(tb, { include: ['return'], capital: 500000 });
    expect(withCap.items[0]).toMatchObject({ key: 'return' });
    expect(withCap.items[0].value).toMatch(/^[+−]?\d+\.\d%$/);
  });
  for (const g of goldens) {
    it(`${g.name}: no money, currency or symbol on the card`, () => {
      const c = shareCard(g.report, { include: ['winRate', 'edge', 'plan', 'greenDays', 'return', 'payoff'], capital: 100000, planCheck: { met: 1, measured: 2 } });
      const text = JSON.stringify(c);
      expect(text).not.toMatch(/[₹$€£]|INR|USD|EUR/);
      for (const t of g.report.trades.slice(0, 50)) expect(text).not.toContain(`"${t.symbol}"`);
      expect(c.items.length).toBeLessThanOrEqual(4);
    });
  }
  it('period labels', () => {
    expect(periodLabel('2025-03-02', '2025-03-30')).toBe('Mar 2025');
    expect(periodLabel('2024-11-02', '2025-02-01')).toBe('Nov 2024 – Feb 2025');
    expect(periodLabel(null, null)).toBe('');
  });
});
