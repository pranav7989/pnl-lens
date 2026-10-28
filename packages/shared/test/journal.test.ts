/**
 * @file  packages/shared/test/journal.test.ts
 * @area  Tests
 * @what  Journal stats: notes match trades by trade identity (also across reports), groups by setup / tag / emotion add up, best and worst need 2+ trades.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { journalStats } from '../src/insights/journal';
import { tradeKey } from '../src/insights/lifetime';

const tb = JSON.parse(readFileSync(join(__dirname, '../../engine/test/golden/zerodha_tradebook_csv.json'), 'utf8')).report.trades;
const note = (t: any, x: Partial<{ setup: string; tags: string[]; emotion: string; note: string }>) => ({ tradeKey: tradeKey(t), setup: null, tags: [], emotion: null, note: null, ...x });

describe('journal stats', () => {
  it('nothing journaled: zero, no groups', () => {
    const s = journalStats(tb, []);
    expect(s).toMatchObject({ total: tb.length, journaled: 0, bySetup: [], byTag: [], byEmotion: [], best: null, worst: null });
  });

  it('groups by setup, tag and emotion; best and worst come from groups of 2+', () => {
    const wins = tb.filter((t: any) => t.pnl > 0).slice(0, 3), losses = tb.filter((t: any) => t.pnl < 0).slice(0, 2);
    const notes = [...wins.map((t: any) => note(t, { setup: 'Breakout', tags: ['plan'], emotion: 'calm' })), ...losses.map((t: any) => note(t, { setup: 'Chase', tags: ['plan', 'late'], emotion: 'revenge' }))];
    const s = journalStats(tb, notes);
    expect(s.journaled).toBe(5);
    expect(s.bySetup.map((g) => g.key)).toEqual(['Breakout', 'Chase']);
    expect(s.bySetup[0].n).toBe(3);
    expect(s.byTag.find((g) => g.key === 'plan')!.n).toBe(5);
    expect(s.byTag.find((g) => g.key === 'late')!.n).toBe(2);
    expect(s.byEmotion.map((g) => g.key).sort()).toEqual(['Calm', 'Revenge']);
    expect(s.best!.pnl).toBeGreaterThan(0);
    expect(s.worst).toMatchObject({ n: 2 });
    expect(s.worst!.pnl).toBeCloseTo(losses.reduce((a: number, t: any) => a + t.pnl, 0), 6);
  });

  it('a note written on one report matches the same trade in another report', () => {
    const copy = tb.map((t: any) => ({ ...t }));
    expect(journalStats(copy, [note(tb[0], { setup: 'X' })]).journaled).toBe(1);
  });
});
