/**
 * @file  packages/shared/test/trade-check-actuals.test.ts
 * @area  Tests
 * @what  Trade Check phase 3: a line's outcome (tradebook match wins over what was typed), the day's plan-vs-actual score (planned, taken, off-plan, on/off-plan P&L, rules kept), matching tradebook trades to lines (instrument, strike, side, date; more fills join the first match; the rest of a planned day is off-plan), and the rules that need the day so far (stop after N losses, trades a day incl. off-plan).
 */
import { describe, it, expect } from 'vitest';
import { outcomeOf, scoreDay, matchLines, type MatchTrade } from '../src/plan/actuals';
import { parseLine } from '../src/plan/parse';
import { checkDay, type CheckContextData } from '../src/plan/check';
import { isAdvice } from '../src/plan/templates';

const P = (t: string) => parseLine(t);
const block = (text: string) => ({ chips: [{ kind: 'rule', level: 'block', key: 'rule:1', text }] }) as any;

describe('outcome and score', () => {
  it('a tradebook match is the truth; otherwise what the trader marked', () => {
    expect(outcomeOf(null)).toEqual({ taken: null, pnl: null, from: null });
    expect(outcomeOf({ taken: false, manual_pnl: 500, matched_trade_ids: [], matched_pnl: null })).toEqual({ taken: false, pnl: null, from: 'journal' });
    expect(outcomeOf({ taken: true, manual_pnl: -800, matched_trade_ids: [], matched_pnl: null })).toEqual({ taken: true, pnl: -800, from: 'journal' });
    expect(outcomeOf({ taken: false, manual_pnl: null, matched_trade_ids: [7], matched_pnl: 1200 })).toEqual({ taken: true, pnl: 1200, from: 'tradebook' });
  });

  it('planned, taken, not taken, unmarked, off-plan, P&L on and off the plan, rules kept', () => {
    const s = scoreDay([
      { parsed: P('NIFTY 24300 CE buy 120 1 lot'), decision: null, check_result: { chips: [] } as any, outcome: { taken: true, manual_pnl: 1500, matched_trade_ids: [], matched_pnl: null } },
      { parsed: P('NIFTY 24300 PE buy 90 1 lot'), decision: 'kept', check_result: block('Breaks your rule: "No option buys on expiry day"'), outcome: { taken: true, manual_pnl: -2000, matched_trade_ids: [], matched_pnl: null } },
      { parsed: P('RELIANCE buy 2500 qty 10'), decision: null, check_result: null, outcome: { taken: false, manual_pnl: null, matched_trade_ids: [], matched_pnl: null } },
      { parsed: P('SBIN buy 800 qty 10'), decision: null, check_result: null, outcome: null },
      { parsed: P('TCS buy 4000 qty 1'), decision: 'removed', check_result: null, outcome: { taken: true, manual_pnl: 9999, matched_trade_ids: [], matched_pnl: null } },
    ], [{ pnl: -700 }, { pnl: null }]);
    expect(s).toEqual({ planned: 4, taken: 2, not_taken: 1, unmarked: 1, off_plan: 2, on_plan_pnl: -500, off_plan_pnl: -700, rules_kept: 1, rules_total: 2, source: 'journal' });
  });
});

describe('matching a tradebook to the plan', () => {
  // the golden Zerodha tradebook's 3 Mar 2025
  const trades: MatchTrade[] = [
    { id: 1, underlying: 'NIFTY', kind: 'PE', strike: 22500, direction: 'Long', entryDate: '2025-03-03', pnl: 5424 },
    { id: 2, underlying: 'TATASTEEL', kind: 'CE', strike: 160, direction: 'Long', entryDate: '2025-03-03', pnl: 2322.5 },
    { id: 3, underlying: 'NIFTY', kind: 'CE', strike: 24000, direction: 'Long', entryDate: '2025-03-03', pnl: 1279.5 },
    { id: 4, underlying: 'RELIANCE', kind: 'EQ', strike: null, direction: 'Long', entryDate: '2025-03-03', pnl: -13716 },
    { id: 5, underlying: 'HDFCBANK', kind: 'EQ', strike: null, direction: 'Long', entryDate: '2025-03-03', pnl: 4710 },
    { id: 6, underlying: 'NIFTY', kind: 'PE', strike: 22500, direction: 'Long', entryDate: '2025-03-03', pnl: -400 },    // a second fill
    { id: 7, underlying: 'SBIN', kind: 'EQ', strike: null, direction: 'Long', entryDate: '2025-03-04', pnl: 100 },        // a day without a plan
  ];
  const lines = [
    { id: 10, date: '2025-03-03', parsed: P('NIFTY 22500 PE buy 100 1 lot'), removed: false },
    { id: 11, date: '2025-03-03', parsed: P('RELIANCE buy 1300 qty 10'), removed: false },
    { id: 12, date: '2025-03-03', parsed: P('HDFCBANK sell 1700 qty 10'), removed: false },                                  // planned a sell, bought
    { id: 13, date: '2025-03-03', parsed: P('NIFTY 24000 CE buy 100 1 lot'), removed: true },
  ];
  it('instrument, strike, side and date; more fills join the first match; the rest of the day is off-plan', () => {
    const { matches, offPlan } = matchLines(lines, trades);
    expect([...matches.entries()]).toEqual([[10, { ids: [1, 6], pnl: 5024 }], [11, { ids: [4], pnl: -13716 }]]);
    expect(offPlan.get('2025-03-03')!.map((t) => t.id)).toEqual([2, 3, 5]);     // the removed line doesn't claim trade 3
    expect(offPlan.has('2025-03-04')).toBe(false);
  });
});

describe('rules that need the day so far', () => {
  const ctx = (journal: CheckContextData['journal'], rules: any[]): CheckContextData => ({ date: '2026-11-24', time: '10:00', expiries: [], lots: { NIFTY: 65 }, costs: {}, profile: null, rules, journal });
  const lines = [
    { parsed: P('NIFTY FUT buy 25000 SL 24950 1 lot'), removed: false, createdAt: '2026-11-24T03:50:00Z', lost: true },
    { parsed: P('RELIANCE buy 2500 SL 2450 qty 10'), removed: false, createdAt: '2026-11-24T04:30:00Z', lost: false },
    { parsed: P('SBIN buy 800 SL 790 qty 10'), removed: false, createdAt: '2026-11-24T06:00:00Z' },
  ];
  it('stop after N losses: earlier losing lines and journal losses logged before the line', () => {
    const r = checkDay(lines, ctx([{ createdAt: '2026-11-24T05:00:00Z', pnl: -900 }], [{ id: 1, kind: 'stop_after_losses', params: { n: 2 } }]));
    const txt = r.map((x) => x!.chips.filter((c) => c.level === 'block').map((c) => c.text));
    expect(txt).toEqual([[], [], ['Breaks your rule: "Stop for the day after 2 losses" · 2 losses so far today']]);
    for (const t of txt.flat()) expect(isAdvice(t)).toBe(false);
    expect(checkDay(lines, { ...ctx(undefined, [{ id: 1, kind: 'stop_after_losses', params: { n: 2 } }]) })[2]!.unavailable).toContain('losses_today');
  });
  it('trades a day count the trades not in the plan', () => {
    const r = checkDay(lines.slice(0, 2), ctx([{ createdAt: '2026-11-24T04:00:00Z', pnl: 300 }], [{ id: 2, kind: 'max_trades_day', params: { n: 2 } }]));
    expect(r[1]!.chips.filter((c) => c.kind === 'rule').map((c) => c.text)).toEqual(['Breaks your rule: "No more than 2 trades a day" · this is trade 3 of the day']);
  });
});
