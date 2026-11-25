/**
 * @file  packages/shared/test/trade-check-lines.test.ts
 * @area  Tests
 * @what  Trade Check phase 2: the plan-line parser (doc example, futures, equity, side first, time, every error), a plan line and a stored trade with the same facts get identical features (property test), dte 0 on expiry day either side of the Sept 2025 change, check() on the doc example (rule ✕ + history !), every rule kind, history thresholds and limits, no-profile and new-instrument lines, stability, speed, the advice scan of every chip, and rule suggestions (weak habits, 30-day plan, settings; never twice).
 */
import { describe, it, expect } from 'vitest';
import { parseLine, formatLine } from '../src/plan/parse';
import { check, lineExpiry, type CheckContext, type CheckProfile, type TraderRule } from '../src/plan/check';
import { features, factsFromTrade } from '../src/features/build';
import { profileFromRows, usualKey } from '../src/profile/source';
import { isAdvice } from '../src/plan/templates';
import { rng } from '../src/insights/edge';
import { suggestRules } from '../src/plan/suggest';

describe('parser', () => {
  it('the doc example', () => {
    expect(parseLine('NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot')).toEqual({ underlying: 'NIFTY', kind: 'CE', strike: 24300, side: 'buy', entry: 120,
      sl: 90, target: 170, lots: 1, qty: null, time: null, errors: [], ok: true });
  });
  it('futures, equity, side first, glued strikes, time, rupee signs', () => {
    expect(parseLine('BANKNIFTY FUT sell 52000 sl 52200 tgt 51600 2 lots')).toMatchObject({ kind: 'FUT', side: 'sell', entry: 52000, sl: 52200, target: 51600, lots: 2, ok: true });
    expect(parseLine('RELIANCE buy ₹2500 SL 2450 qty 10')).toMatchObject({ underlying: 'RELIANCE', kind: 'EQ', entry: 2500, qty: 10, ok: true });
    expect(parseLine('sell NIFTY 24300PE 85 sl 110 1lot at 10:30')).toMatchObject({ underlying: 'NIFTY', kind: 'PE', strike: 24300, side: 'sell', entry: 85, sl: 110, lots: 1, time: '10:30', ok: true });
    expect(parseLine('sensex 81000 ce b 300 sl:250 2 lots 9:20')).toMatchObject({ underlying: 'SENSEX', side: 'buy', entry: 300, sl: 250, time: '09:20', ok: true });
    expect(formatLine(parseLine('NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot'))).toBe('NIFTY 24300 CE · buy · 120 · SL 90 · target 170 · 1 lot');
  });
  it('unclear lines are highlighted, never guessed', () => {
    const f = (s: string) => parseLine(s).errors.map((e) => e.field);
    expect(f('NIFTY CE buy 120 1 lot')).toContain('strike');
    expect(f('NIFTY 24300 CE 120 1 lot')).toContain('side');
    expect(f('NIFTY 24300 CE buy 1 lot')).toContain('entry');
    expect(f('NIFTY 24300 CE buy 120')).toContain('size');
    expect(f('NIFTY 24300 CE buy 120 sl 130 1 lot')).toContain('sl');           // a buy's SL above the entry
    expect(f('NIFTY FUT sell 25000 target 25100 1 lot')).toContain('target');
    expect(f('NIFTY 24300 CE buy 120 1 lot maybe')).toContain('text');
    expect(f('NIFTY 24300 CE buy 120 1.5 lots')).toContain('size');
    expect(parseLine('').ok).toBe(false);
  });
});

const expiries = (days: string[], kind: 'weekly' | 'monthly' = 'weekly') => days.map((expiry) => ({ underlying: 'NIFTY', exchange: 'NSE', expiry, kind }));
const ctxOf = (o: Partial<CheckContext> = {}): CheckContext => ({
  date: '2026-11-24', time: '09:40', expiries: expiries(['2026-11-24', '2026-12-01']).concat(expiries(['2026-11-24', '2026-12-29'], 'monthly')),
  lotSize: (u) => ({ NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 } as Record<string, number>)[u] ?? null, profile: null, rules: [], others: [], now: new Date('2026-11-24T04:00:00Z'), ...o,
});

describe('same facts, same features (doc §12)', () => {
  it('a plan line and a stored trade with the same facts produce identical features', () => {
    const r = rng(42), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 300; i++) {
      const kind = pick(['CE', 'PE', 'FUT', 'EQ'] as const), side = pick(['buy', 'sell'] as const), hour = pick([9, 10, 11, 12, 13, 14, 15]);
      const date = pick(['2026-11-20', '2026-11-23', '2026-11-24']), expiry = pick(['2026-11-24', '2026-12-29']);
      const lots = 1 + Math.floor(r() * 4), entry = Math.round(20 + r() * 300), seq = 1 + Math.floor(r() * 4);
      const underlying = kind === 'EQ' ? 'RELIANCE' : 'NIFTY', lot = kind === 'EQ' ? 1 : 65, qty = lots * lot;
      const usual = { [usualKey(underlying, kind === 'EQ' ? 'equity' : kind === 'FUT' ? 'future' : 'option')]: 65 };
      const trade = { kind, underlying, direction: side === 'buy' ? 'Long' : 'Short', entryDate: date, entryHour: hour, expiry: kind === 'EQ' ? null : expiry,
        expiryType: expiry === '2026-12-29' ? 'Monthly' : 'Weekly', qty, buy: entry * qty, sell: entry * qty, pnl: 0 };
      const fromTrade = features(factsFromTrade(trade), { medianQty: (u, inst) => usual[usualKey(u, inst)] ?? null, sessionSeq: seq,
        expiryKind: (_u, e) => (kind === 'FUT' || e === '2026-12-29' ? 'monthly' : 'weekly') });
      const text = `${underlying} ${kind === 'CE' || kind === 'PE' ? `24300 ${kind}` : kind === 'FUT' ? 'FUT' : ''} ${side} ${entry} ${kind === 'EQ' ? `qty ${qty}` : `${lots} lots`} at ${String(hour).padStart(2, '0')}:05`;
      // the line's contract is the calendar's nearest one on that day: give it exactly the trade's expiry
      const ctx = ctxOf({ date, expiries: kind === 'FUT' ? expiries([expiry], 'monthly') : expiries([expiry], expiry === '2026-12-29' ? 'monthly' : 'weekly'),
        others: Array.from({ length: seq - 1 }, () => ({ lossAtSl: null })),
        profile: { version: 1, currency: 'INR', patterns: [], usualQty: usual, tradedUnderlyings: [] } });
      const fromLine = check(parseLine(text), ctx).features;
      expect({ ...fromLine, after_losses: null }, text).toEqual({ ...fromTrade, after_losses: null });
    }
  });

  it('expiry day is dte 0 on either side of the Sept 2025 Thursday -> Tuesday change', () => {
    const line = parseLine('NIFTY 24300 CE buy 120 1 lot');
    expect(check(line, ctxOf({ date: '2025-08-28', expiries: expiries(['2025-08-28', '2025-09-04']) })).features.dte).toBe('0');   // Thursday
    expect(check(line, ctxOf({ date: '2025-09-30', expiries: expiries(['2025-09-30', '2025-10-07']) })).features.dte).toBe('0');   // Tuesday
    expect(check(line, ctxOf({ date: '2025-09-29', expiries: expiries(['2025-09-30']) })).features.dte).toBe('1');
    expect(lineExpiry(parseLine('NIFTY FUT buy 25000 1 lot'), ctxOf())!.expiry).toBe('2026-11-24');     // futures: nearest monthly
    expect(check(line, ctxOf({ expiries: [] })).unavailable).toContain('dte');
  });
});

// a profile with the doc's habits: option buys on expiry day weak, option buys before 11:00 strong
function docProfile(): CheckProfile {
  const t = (date: string, expiry: string, pnl: number, hour: number) => ({ kind: 'CE', underlying: 'NIFTY', direction: 'Long', entryDate: date, exitDate: date,
    entryHour: hour, expiry, expiryType: 'Weekly', qty: 75, buy: 9000, sell: 9000 + pnl, pnl });
  const trades: any[] = [];
  const tue: string[] = [];
  for (let d = Date.parse('2026-04-07T00:00:00Z'); tue.length < 12; d += 14 * 864e5) tue.push(new Date(d).toISOString().slice(0, 10));
  tue.forEach((day, i) => {
    (i < 3 ? [2000, 1500, -1000] : i < 7 ? [600, -1740, -1740] : [-960, -960, -960]).forEach((p) => trades.push(t(day, day, p, 14)));
    const fri = new Date(Date.parse(day) - 4 * 864e5).toISOString().slice(0, 10), thu = new Date(Date.parse(day) - 5 * 864e5).toISOString().slice(0, 10);
    for (let k = 0; k < 9; k++) trades.push(t(fri, day, k < 8 ? 1000 : -700, 9 + (k % 2)));
    for (const p of [900, -800, 900, -800, -800]) trades.push(t(thu, day, p, 12));
  });
  const { profile, prepared } = profileFromRows(trades.map((trade, i) => ({ reportId: 'r', createdAt: '', currency: 'INR', tradeId: i, trade })), new Date('2026-10-01T00:00:00Z'));
  return { version: 7, currency: 'INR', patterns: profile.patterns.filter((p) => p.shown && p.verdict !== 'neutral'), usualQty: prepared.usualQty, tradedUnderlyings: ['NIFTY'] };
}
const rule = (id: number, kind: TraderRule['kind'], params: any): TraderRule => ({ id, kind, params });

describe('check()', () => {
  const profile = docProfile();
  const line = parseLine('NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot');
  const noExpiryBuys = rule(12, 'no_segment', { dims: { instrument: 'option', side: 'buy', dte: '0' } });

  it('the doc example: ✕ the rule, ! the expiry-day history (sample and period), version and contract', () => {
    const r = check(line, ctxOf({ profile, rules: [noExpiryBuys], time: '14:10' }));
    expect(r.check_version).toBe('1.0');
    expect(r.profile_version).toBe(7);
    expect(r.chips[0]).toMatchObject({ kind: 'rule', level: 'block', rule_id: 12, text: 'Breaks your rule: "No option buys on expiry day"' });
    const h = r.chips.filter((c) => c.kind === 'history');
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h.length).toBeLessThanOrEqual(2);
    expect(h.some((c) => c.level === 'caution' && c.text.startsWith('Your history: option buys on expiry day · 12 expiries · 3 profitable · −₹18,420 (Apr–Sep 2026)'))).toBe(true);
    for (const c of r.chips) expect(isAdvice(c.text), c.text).toBe(false);
  });

  it('a line that matches a strength shows ✓; the same line and profile always give the same chips', () => {
    const fri = check(parseLine('NIFTY 24300 CE buy 120 SL 90 1 lot at 09:30'), ctxOf({ profile, date: '2026-11-20' }));
    expect(fri.chips.some((c) => c.level === 'strength')).toBe(true);
    expect(check(line, ctxOf({ profile, rules: [noExpiryBuys] }))).toEqual(check(line, ctxOf({ profile, rules: [noExpiryBuys] })));
  });

  it('every rule kind', () => {
    const texts = (o: Partial<CheckContext>, l = line) => check(l, ctxOf(o)).chips.filter((c) => c.kind === 'rule').map((c) => c.text);
    expect(texts({ rules: [rule(1, 'max_trades_day', { n: 3 })], others: [{ lossAtSl: 0 }, { lossAtSl: 0 }, { lossAtSl: 0 }] }))
      .toEqual(['Breaks your rule: "No more than 3 trades a day" · this is trade 4 of the day']);
    expect(texts({ rules: [rule(1, 'max_trades_day', { n: 3 })], others: [{ lossAtSl: 0 }] })).toEqual([]);
    // 30 points x 65 = 1,950 (no rates given) + 4,500 already planned = 6,450 > 6,000
    expect(texts({ rules: [rule(2, 'max_daily_loss', { amount: 6000 })], others: [{ lossAtSl: 4500 }] }))
      .toEqual(['Breaks your rule: "Daily loss limit ₹6,000" · planned loss at stop-loss ₹6,450']);
    expect(check(parseLine('NIFTY 24300 CE buy 120 1 lot'), ctxOf({ rules: [rule(2, 'max_daily_loss', { amount: 6000 })] })).chips.map((c) => c.key)).toContain('info:add_stop_loss');
    expect(texts({ rules: [rule(3, 'max_lots', { lots: 2 })] }, parseLine('NIFTY 24300 CE buy 120 SL 90 3 lots'))).toEqual(['Breaks your rule: "No more than 2 lots" · this line is 3 lots']);
    expect(texts({ profile, rules: [rule(3, 'max_lots', { ratio: 1.5 })] }, parseLine('NIFTY 24300 CE buy 120 SL 90 qty 195')))
      .toEqual(['Breaks your rule: "No more than 1.5× my usual size" · this line is 2.6× your usual size']);
    expect(texts({ rules: [rule(4, 'time_window', { from: '09:30', to: '11:30' })] }, parseLine('NIFTY 24300 CE buy 120 SL 90 1 lot at 13:15')))
      .toEqual(['Breaks your rule: "Trade only between 09:30 and 11:30" · planned at 13:15']);
    expect(texts({ rules: [rule(4, 'time_window', { from: '09:30', to: '11:30' })], time: '10:00' })).toEqual([]);
    expect(texts({ rules: [rule(5, 'no_segment', { dims: { underlying: 'BANKNIFTY' } })] })).toEqual([]);
    expect(texts({ rules: [{ ...rule(5, 'no_segment', { dims: { underlying: 'NIFTY' } }), active: false }] })).toEqual([]);
    expect(check(line, ctxOf({ rules: [rule(6, 'stop_after_losses', { n: 2 })] })).unavailable).toContain('losses_today');
  });

  it('loss at the stop-loss includes the round trip charges when rates are known', () => {
    const rates = { stt_buy: 0, stt_sell: 0.0015, exch_txn: 0.0003553, sebi_per_crore: 10, stamp_buy: 0.00003, gst: 0.18 };
    const r = check(line, ctxOf({ costs: () => ({ segment: 'options', rates, brokerage: { flat_per_order: 20 } }) }));
    expect(r.loss_at_sl).toBeGreaterThan(30 * 65);
    expect(r.loss_at_sl).toBeLessThan(30 * 65 + 100);
  });

  it('no profile: one line instead of history; never traded: says the history is across instruments', () => {
    expect(check(line, ctxOf()).chips.map((c) => c.text)).toEqual(['Upload a tradebook to see how lines like this went for you.']);
    const other = check(parseLine('BANKNIFTY 52000 CE buy 300 SL 250 1 lot'), ctxOf({ profile: { ...profile, tradedUnderlyings: ['NIFTY'] }, time: '14:10',
      expiries: [{ underlying: 'BANKNIFTY', exchange: 'NSE', expiry: '2026-11-24', kind: 'monthly' }] }));
    const h = other.chips.filter((c) => c.kind === 'history');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((c) => c.text.includes('across all the instruments you traded'))).toBe(true);
  });

  it('segments without enough evidence never show; at most 2 history chips', () => {
    const weakSmall = { ...profile.patterns[0], shown: false, verdict: 'weak' as const, dims: { instrument: 'option' }, segment_key: 'instrument=option' };
    const r = check(line, ctxOf({ profile: { ...profile, patterns: [weakSmall] } }));
    expect(r.chips.filter((c) => c.kind === 'history')).toEqual([]);
    expect(check(line, ctxOf({ profile, time: '14:10' })).chips.filter((c) => c.kind === 'history').length).toBeLessThanOrEqual(2);
  });

  it('fast enough for the browser on every keystroke (doc: under 300 ms)', () => {
    const big = { ...profile, patterns: Array.from({ length: 40 }, () => profile.patterns).flat() };
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) check(parseLine(`NIFTY 24300 CE buy ${100 + i} SL 80 1 lot`), ctxOf({ profile: big, rules: [noExpiryBuys] }));
    expect((performance.now() - t0) / 200).toBeLessThan(30);
  });
});

describe('suggested from your trades', () => {
  const profile = docProfile();
  const plan = { dos: [{ id: 'daily-limit', title: 'Set a daily loss limit and stop when you reach it.' }],
    donts: [{ id: 're-entry', title: 'Don’t trade again the same day after a loss.' }, { id: 'avoid-worst', title: 'Don’t trade BANKNIFTY this month.', metric: { param: 'banknifty' } },
      { id: 'overtrade', title: 'Don’t trade more often than your plan allows.', metric: { target: 12 } }, { id: 'payoff', title: 'x' }] };

  it('weak habits, the 30-day plan rules a machine can check, and Desk settings', () => {
    const s = suggestRules({ patterns: profile.patterns, currency: 'INR', plan, settings: { max_daily_loss: null, max_trades_day: null }, taken: [], activeKinds: [], now: new Date('2026-10-01T00:00:00Z') });
    expect(s.filter((x) => x.kind === 'no_segment' && x.key.startsWith('segment:')).length).toBeGreaterThan(0);
    expect(s.find((x) => x.key === 'segment:instrument=option|side=buy|dte=0')?.label).toBe('No option buys on expiry day');
    expect(s.filter((x) => x.key.startsWith('plan:')).map((x) => [x.key, x.label])).toEqual([
      ['plan:daily-limit', 'Daily loss limit'], ['plan:re-entry', 'Stop for the day after 1 loss'], ['plan:avoid-worst:BANKNIFTY', 'No BANKNIFTY trades'], ['plan:overtrade', 'No more than 2 trades a day'],
    ]);
    expect(s.find((x) => x.key === 'plan:daily-limit')!.needs).toBe('amount');
    for (const x of s) { expect(isAdvice(x.label), x.label).toBe(false); expect(isAdvice(x.why), x.why).toBe(false); }
  });
  it('settings fill the amount; nothing already accepted, dismissed or covered is offered again', () => {
    const s = suggestRules({ patterns: [], currency: 'INR', plan, settings: { max_daily_loss: 6000, max_trades_day: 3 }, taken: ['plan:re-entry'], activeKinds: ['max_trades_day'] });
    expect(s.map((x) => x.key)).toEqual(['plan:daily-limit', 'plan:avoid-worst:BANKNIFTY']);
    expect(s[0]).toMatchObject({ params: { amount: 6000 }, label: 'Daily loss limit ₹6,000' });
    expect(s[0].needs).toBeUndefined();
  });
});
