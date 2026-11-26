/**
 * @file  packages/shared/test/plan.test.ts
 * @area  Tests
 * @what  30-day plan generator on every golden report: always 5 Do + 5 Don't, real numbers, deterministic, habits only.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlan, addDays, istDate } from '../src/plan/build';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);
const at = new Date('2026-10-26T20:00:00Z'); // 27 Oct in IST

describe('30-day plan', () => {
  it('covers the golden set', () => expect(goldens.length).toBeGreaterThanOrEqual(20));

  for (const g of goldens) {
    it(`${g.name}: 5 Do and 5 Don't with finite, formatted numbers`, () => {
      const p = buildPlan(g.report, { generatedAt: at });
      expect(p.dos).toHaveLength(5);
      expect(p.donts).toHaveLength(5);
      expect(p.dos.every((r) => r.kind === 'do')).toBe(true);
      expect(p.donts.every((r) => r.kind === 'dont' && r.title.startsWith('Don’t'))).toBe(true);
      const all = [...p.dos, ...p.donts];
      expect(new Set(all.map((r) => r.id)).size).toBe(10);
      const text = [p.intro, ...all.flatMap((r) => [r.title, r.why, r.now, r.target, r.habit, r.check])].join('\n');
      expect(text).not.toMatch(/NaN|Infinity|undefined|null|\[object/);
      // habits, never what to buy or sell
      expect(text).not.toMatch(/\b(buy|sell) (this|now)|target price|\btips? (to|on)\b|recommend(ed)? (stock|share)/i);
      const sym = { INR: '₹', USD: '$', EUR: '€' }[p.currency as 'INR'];
      if (/[₹$€]\d/.test(text)) expect(text).toContain(sym);
      expect(p.scorecard.length).toBeGreaterThanOrEqual(3);
      expect(p.weekly).toHaveLength(5);
      expect(p.checkupOn).toBe('2026-11-26');
    });
  }

  it('is deterministic for a fixed date', () => {
    for (const g of goldens) expect(JSON.stringify(buildPlan(g.report, { generatedAt: at }))).toBe(JSON.stringify(buildPlan(g.report, { generatedAt: at })));
  });

  it('F&O reports get option rules; equity-only reports never get expiry or strike rules', () => {
    const ids = (n: string) => { const p = buildPlan(goldens.find((g) => g.name === n)!.report, { generatedAt: at }); return [...p.dos, ...p.donts].map((r) => r.id); };
    expect(ids('zerodha_tradebook_csv')).toContain('hold-past-stop');
    expect(buildPlan(goldens.find((g) => g.name === 'zerodha_tradebook_csv')!.report, { generatedAt: at }).donts[0].title).toMatch(/option/);
    for (const n of ['groww_pnl_csv', 'zerodha_equity_statement_xlsx', 'binance_trades_csv']) {
      expect(ids(n)).not.toContain('cap-expiry');
      expect(ids(n)).not.toContain('strikes');
    }
  });

  it('still gives a full plan for an empty or odd report', () => {
    for (const r of [{}, { trades: [] }, { m: { currency: 'USD' }, trades: [{ pnl: 10 }] }, null]) {
      const p = buildPlan(r, { generatedAt: at });
      expect(p.dos).toHaveLength(5);
      expect(p.donts).toHaveLength(5);
    }
  });

  it('dates are IST calendar days', () => {
    expect(istDate(new Date('2026-10-26T18:29:00Z'))).toBe('2026-10-26');
    expect(istDate(new Date('2026-10-26T18:31:00Z'))).toBe('2026-10-27');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
  });
});
