/**
 * @file  packages/shared/test/trade-check-profile.test.ts
 * @area  Tests
 * @what  Trade Check phase 1: features (dte from the contract expiry across the Sept 2025 Thursday -> Tuesday change, unavailable features of statements), Wilson/shrinkage/recency, the doc's expiry-day example flagged weak with its exact line, minimum evidence, stability, golden reports vs hand-checked numbers, overlapping reports counted once, watch-out picking, and the advice-wording scan.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { features, factsFromTrade, dteBucket, FEATURES } from '../src/features/build';
import { buildProfile, wilson, shrink, recencyWeight, topPatterns, segmentKey, type Pattern } from '../src/profile/build';
import { prepare, profileFromRows, type SourceRow } from '../src/profile/source';
import { describe as say, historyLine, period, TEXT, isAdvice, ADVICE } from '../src/plan/templates';

const GOLDEN = path.resolve(__dirname, '../../engine/test/golden');
const golden = (name: string) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${name}.json`), 'utf8')).trades as any[];
const rows = (trades: any[], reportId = 'r1', currency = 'INR', createdAt = '2026-10-01T00:00:00Z'): SourceRow[] =>
  trades.map((trade, i) => ({ reportId, createdAt, currency, tradeId: i + 1, trade }));
const NOW = new Date('2026-10-01T03:00:00Z');

describe('features', () => {
  it('days to expiry come from the contract, so expiry day stays dte 0 across the Sept 2025 move', () => {
    expect(dteBucket('2025-08-28', '2025-08-28')).toBe('0');           // Thursday expiry (before)
    expect(dteBucket('2025-09-30', '2025-09-30')).toBe('0');           // Tuesday expiry (after)
    expect(dteBucket('2025-09-29', '2025-09-30')).toBe('1');
    expect(dteBucket('2025-09-26', '2025-09-30')).toBe('2-4');
    expect(dteBucket('2025-09-20', '2025-09-30')).toBe('5+');
    expect(dteBucket('2025-10-01', '2025-09-30')).toBeNull();          // inconsistent data is never guessed
  });

  it('a tradebook trade gets every feature; a statement trade only what it has', () => {
    const tb = features(factsFromTrade({ symbol: 'NIFTY25SEP24300CE', kind: 'CE', underlying: 'NIFTY', direction: 'Long', entryDate: '2025-09-30', entryHour: 9,
      expiry: '2025-09-30', expiryType: 'Weekly', qty: 150, buy: 18000, sell: 9000, pnl: -9000 }), { medianQty: () => 75, sessionSeq: 3, afterLosses: 2 });
    expect(tb).toEqual({ underlying: 'NIFTY', instrument: 'option', option_type: 'CE', side: 'buy', expiry_kind: 'weekly', dte: '0', weekday: 'Tue',
      time_bucket: 'open', size_ratio: '1-2x', session_seq: '3rd+', after_losses: '2+', premium_bucket: '50-150' });
    const st = features(factsFromTrade(golden('zerodha_fo_statement_xlsx')[0]));
    expect([st.side, st.dte, st.weekday, st.time_bucket, st.session_seq]).toEqual([null, null, null, null, null]);
    expect([st.instrument, st.expiry_kind]).toEqual(['option', 'weekly']);
    expect(features(factsFromTrade({ kind: 'FUT', underlying: 'BANKNIFTY', expiry: '2026-11-24', expiryType: 'Futures', qty: 30, buy: 1, sell: 1, pnl: 0 })).expiry_kind).toBe('monthly');
    expect(features(factsFromTrade({ kind: 'FUT', underlying: 'NIFTY', expiry: '2026-11-24', qty: 1, buy: 1, sell: 1, pnl: 0 }), { expiryKind: () => 'weekly' }).expiry_kind).toBe('weekly');
  });
});

describe('statistics', () => {
  it('Wilson 90%, shrinkage k = 10, 90-day half-life', () => {
    const [lo, hi] = wilson(0.29, 36);
    expect([lo, hi].map((x) => Math.round(x * 1000) / 1000)).toEqual([0.184, 0.426]);
    expect(shrink(10, -500, 100)).toBe(-200);
    expect(recencyWeight('2026-07-03', NOW)).toBeCloseTo(0.5, 2);
    expect(recencyWeight(null, NOW)).toBe(1);
  });
});

// the doc's own example (§2): 36 option buys over 12 Nifty expiry days, 3 profitable days, −₹18,420
function expiryExample() {
  const tuesdays: string[] = [];
  for (let d = Date.parse('2026-04-01T00:00:00Z'); tuesdays.length < 12; d += 864e5) {
    const iso = new Date(d).toISOString().slice(0, 10);
    if (new Date(d).getUTCDay() === 2 && (tuesdays.length === 0 || Date.parse(iso) - Date.parse(tuesdays[tuesdays.length - 1]) >= 14 * 864e5)) tuesdays.push(iso);
  }
  const t = (date: string, expiry: string, pnl: number, hour: number) => ({ symbol: `NIFTY${expiry}CE`, kind: 'CE', underlying: 'NIFTY', direction: 'Long', entryDate: date, exitDate: date,
    entryHour: hour, expiry, expiryType: 'Weekly', qty: 75, buy: 75 * 120, sell: 75 * 120 + pnl, pnl });
  const trades: any[] = [];
  tuesdays.forEach((day, i) => {
    const pnls = i < 3 ? [2000, 1500, -1000] : i < 7 ? [600, -1740, -1740] : [-960, -960, -960];
    pnls.forEach((p) => trades.push(t(day, day, p, 14)));
    // the rest of the trader's history: Friday mornings mostly win; Thursday afternoons are mixed
    const fri = new Date(Date.parse(day) - 4 * 864e5).toISOString().slice(0, 10), thu = new Date(Date.parse(day) - 5 * 864e5).toISOString().slice(0, 10);
    for (let k = 0; k < 9; k++) trades.push(t(fri, day, k < 8 ? 1000 : -700, 9 + (k % 2)));
    for (const p of [900, -800, 900, -800, -800]) trades.push(t(thu, day, p, 12));
  });
  return { tuesdays, trades };
}

describe('the expiry-day example (doc §2)', () => {
  const { trades, tuesdays } = expiryExample();
  const { profile, prepared } = profileFromRows(rows(trades), NOW);
  const p = profile.patterns.find((x) => x.segment_key === 'instrument=option|side=buy|dte=0')!;

  it('is flagged weak, with the numbers of the doc', () => {
    expect(tuesdays[0] >= '2026-04-01' && tuesdays[11] <= '2026-09-30').toBe(true);
    expect([p.n_trades, p.n_days, p.n_expiries, p.win_days, p.wins, Math.round(p.total_pnl)]).toEqual([36, 12, 12, 3, 10, -18420]);
    expect(p.shown).toBe(true);
    expect(p.verdict).toBe('weak');
    expect(profile.baseline.win_rate).toBeGreaterThan(0.5);
  });

  it('reads exactly like the doc chip', () => {
    expect(historyLine(p, prepared.currency, NOW)).toBe('Your history: option buys on expiry day · 12 expiries · 3 profitable · −₹18,420 (Apr–Sep 2026)');
  });

  it('watch-outs: weak habits first (the expiry-day one among them), one strength, the same habit never twice', () => {
    const top = topPatterns(profile.patterns);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top[0].verdict).toBe('weak');
    expect(top.some((x) => x.verdict === 'weak' && x.dims.dte === '0')).toBe(true);
    expect(top.some((x) => x.verdict === 'strong')).toBe(true);
    for (const a of top) for (const b of top) {
      if (a === b || a.verdict !== b.verdict) continue;
      expect(Object.entries(a.dims).every(([k, v]) => (b.dims as any)[k] === v)).toBe(false);
      expect(a.n_trades === b.n_trades && a.total_pnl === b.total_pnl).toBe(false);
    }
  });

  it('stability: same trades, same profile', () => {
    expect(profileFromRows(rows(trades), NOW).profile).toEqual(profile);
  });

  it('an improved habit fades: profitable expiry days since then turn the old warning off', () => {
    const better = [...trades];
    for (let w = 0; w < 14; w++) {                                     // Oct 2026 – Jan 2027: expiry-day buys that now mostly work
      const d = new Date(Date.parse('2026-10-06T00:00:00Z') + w * 7 * 864e5).toISOString().slice(0, 10);
      for (const pnl of [1500, 1200, -400]) better.push({ ...trades[0], entryDate: d, exitDate: d, expiry: d, sell: 9000 + pnl, pnl });
    }
    const after = profileFromRows(rows(better), new Date('2027-01-15T00:00:00Z')).profile.patterns.find((x) => x.segment_key === p.segment_key)!;
    expect(after.n_trades).toBe(36 + 42);
    expect(after.verdict).not.toBe('weak');
  });

  it('an old statement still has its habits (recency counts back from the newest trade, not from today)', () => {
    const later = profileFromRows(rows(trades), new Date('2028-01-01T00:00:00Z')).profile.patterns.find((x) => x.segment_key === p.segment_key)!;
    expect([later.verdict, later.score]).toEqual([p.verdict, p.score]);
  });
});

describe('minimum evidence', () => {
  it('under 8 trades or under 4 days: stored, never shown, always neutral', () => {
    const t = (d: string, pnl: number) => ({ kind: 'CE', underlying: 'NIFTY', direction: 'Long', entryDate: d, entryHour: 10, expiry: d, qty: 75, buy: 9000, sell: 9000 + pnl, pnl });
    const threeDays = ['2026-09-01', '2026-09-08', '2026-09-15'].flatMap((d) => [t(d, -5000), t(d, -5000), t(d, -5000), t(d, -5000)]);
    const p = buildProfile(prepare(rows(threeDays)).trades, NOW).patterns.find((x) => x.segment_key === 'instrument=option|side=buy|dte=0')!;
    expect([p.n_trades, p.n_days, p.shown, p.verdict]).toEqual([12, 3, false, 'neutral']);
  });
});

describe('golden reports vs hand-checked numbers', () => {
  it('Zerodha tradebook (96 trades)', () => {
    const { profile } = profileFromRows(rows(golden('zerodha_tradebook_csv')), NOW);
    expect([profile.baseline.n_trades, profile.baseline.n_days, Math.round(profile.baseline.win_rate * 1e6)]).toEqual([96, 58, 510417]);
    expect([profile.baseline.period_from, profile.baseline.period_to]).toEqual(['2025-01-06', '2025-03-26']);
    const ob = profile.patterns.find((x) => x.segment_key === 'instrument=option|side=buy')!;
    expect([ob.n_trades, ob.wins, Math.round(ob.total_pnl * 100) / 100, ob.n_days]).toEqual([55, 26, 21338.25, 42]);
    const eq = profile.patterns.find((x) => x.segment_key === 'instrument=equity')!;
    expect([eq.n_trades, eq.wins, Math.round(eq.total_pnl * 100) / 100]).toEqual([41, 23, 190790.25]);
  });
  it('Dhan tradebook and a Zerodha F&O statement (no dates: the contract expiry stands in for the day)', () => {
    const dhan = profileFromRows(rows(golden('dhan_tradebook_csv')), NOW).profile;
    expect([dhan.baseline.n_trades, Math.round(dhan.baseline.win_rate * 1e6)]).toEqual([30, 566667]);
    expect(dhan.patterns.find((x) => x.segment_key === 'instrument=option|side=buy')!.n_trades).toBe(19);
    const st = profileFromRows(rows(golden('zerodha_fo_statement_xlsx')), NOW);
    expect([st.profile.baseline.n_trades, st.profile.baseline.n_days]).toEqual([28, 22]);
    expect(st.prepared.unavailable).toEqual(expect.arrayContaining(['side', 'dte', 'time_bucket', 'session_seq']));
  });
  it('watch-outs of the Zerodha tradebook: one habit once (a premium band counts as an option)', () => {
    const top = topPatterns(profileFromRows(rows(golden('zerodha_tradebook_csv')), NOW).profile.patterns);
    const weak = top.filter((x) => x.verdict === 'weak').map((x) => x.dims);
    expect(weak.some((d) => d.session_seq === '2nd' && d.instrument === 'option')).toBe(true);
    expect(weak.some((d) => d.session_seq === '2nd' && d.premium_bucket)).toBe(false);
    expect(top.some((x) => x.verdict === 'strong')).toBe(true);
  });
  it('the same statement in two reports counts once; another currency is left out', () => {
    const z = golden('zerodha_tradebook_csv');
    const p = prepare([...rows(z, 'a'), ...rows(z, 'b', 'INR', '2026-10-02T00:00:00Z'), ...rows(golden('binance_trades_csv'), 'c', 'USD')]);
    expect([p.trades.length, p.currency, p.reportIds]).toEqual([96, 'INR', ['a']]);
  });
});

describe('wording (doc §1, §12)', () => {
  it('segment descriptions', () => {
    expect(say({ instrument: 'option', side: 'buy', dte: '0' })).toBe('option buys on expiry day');
    expect(say({ underlying: 'NIFTY', instrument: 'option', option_type: 'CE', side: 'buy', time_bucket: 'open' })).toBe('NIFTY call option buys before 11:00');
    expect(say({ after_losses: '2+' })).toBe('trades after 2 or more losses that day');
    expect(say({ option_type: 'PE' })).toBe('put option trades');
    expect(say({ session_seq: '2nd', premium_bucket: '>150' })).toBe('option trades as the second trade of the day at a premium above ₹150');
    expect([period('2026-04-07', '2026-09-22'), period('2025-11-04', '2026-02-10'), period('2026-09-01', '2026-09-29')]).toEqual(['Apr–Sep 2026', 'Nov 2025–Feb 2026', 'Sep 2026']);
  });
  it('"(older data)" when the newest trade is more than 60 days old', () => {
    const p = { dims: { instrument: 'equity' }, n_trades: 20, n_days: 9, n_expiries: null, win_days: 3, win_rate: 0.6, wins: 12, total_pnl: 5000, expectancy: 250,
      verdict: 'strong', period_from: '2026-01-05', period_to: '2026-03-30', last_trade_at: '2026-03-30' } as unknown as Pattern;
    expect(historyLine(p, 'INR', NOW)).toBe('Your history: equity trades · 20 trades · 60% win rate · avg +₹250 (Jan–Mar 2026) (older data)');
  });
  it('no template or rendered line gives advice', () => {
    const { profile } = profileFromRows(rows(expiryExample().trades), NOW);
    const rendered = profile.patterns.filter((p) => p.shown).map((p) => historyLine(p, 'INR', NOW));
    const fixed = Object.values(TEXT).map((v) => (typeof v === 'function' ? (v as (x: any) => string)('30 Sep 2026') : v));
    for (const s of [...rendered, ...fixed]) expect(isAdvice(s), s).toBe(false);
    expect(rendered.length).toBeGreaterThan(20);
    for (const bad of ['You should cut size', 'Avoid expiry day', "Don't take this trade", 'Buy NIFTY 24300 CE', 'Consider a smaller lot', 'target at 170'])
      expect(isAdvice(bad), bad).toBe(true);
    expect(ADVICE.length).toBeGreaterThan(5);
  });
  it('segment keys use the fixed feature order', () => {
    expect(segmentKey({ dte: '0', side: 'buy', instrument: 'option' })).toBe('instrument=option|side=buy|dte=0');
    expect(FEATURES[0]).toBe('underlying');
  });
});
