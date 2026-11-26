/**
 * @file  packages/shared/test/lifetime.test.ts
 * @area  Tests
 * @what  Lifetime merge: a re-uploaded statement adds nothing, overlapping statements count shared trades once, identical trades within one file stay separate, currencies never mix, months and report shares add up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeReports, lifetimeCurrencies, type LifetimeReport } from '../src/insights/lifetime';

const golden = (n: string) => JSON.parse(readFileSync(join(__dirname, '../../engine/test/golden', n + '.json'), 'utf8')).report;
const rep = (id: string, createdAt: string, report: any, trades = report.trades): LifetimeReport => ({ id, name: id, createdAt, currency: report.m.currency, trades });
const sum = (xs: any[]) => xs.reduce((s, t) => s + t.pnl, 0);

describe('lifetime merge', () => {
  const tb = golden('zerodha_tradebook_csv'), dhan = golden('zerodha_equity_statement_xlsx'), binance = golden('binance_trades_csv');   // the Dhan sample repeats tradebook trades

  it('the same statement uploaded twice counts once', () => {
    const l = mergeReports([rep('a', '2026-01-01', tb), rep('b', '2026-02-01', tb)], 'INR');
    expect(l.n).toBe(tb.trades.length);
    expect(l.duplicates).toBe(tb.trades.length);
    expect(l.net).toBeCloseTo(sum(tb.trades), 6);
    expect(l.reports.map((r) => r.unique)).toEqual([tb.trades.length, 0]);
  });

  it('overlapping statements count shared trades once; different statements add up', () => {
    const half = tb.trades.slice(0, 40), rest = tb.trades.slice(30);         // 10 trades in both
    const l = mergeReports([rep('a', '2026-01-01', tb, half), rep('b', '2026-02-01', tb, rest), rep('c', '2026-03-01', dhan)], 'INR');
    expect(l.n).toBe(tb.trades.length + dhan.trades.length);
    expect(l.duplicates).toBe(10);
    expect(l.reports.find((r) => r.id === 'b')!.unique).toBe(rest.length - 10);
    expect(l.net).toBeCloseTo(sum(tb.trades) + sum(dhan.trades), 6);
    expect(l.months.reduce((s, m) => s + m.n, 0)).toBe(l.trades.filter((t) => t.exitDate || t.entryDate).length);
    expect(l.reports.reduce((s, r) => s + r.net, 0)).toBeCloseTo(l.net, 6);
  });

  it('identical trades inside one file stay separate (two real trades)', () => {
    const t = { symbol: 'X', entryDate: '2025-01-02', exitDate: '2025-01-02', qty: 1, buy: 10, sell: 12, pnl: 2 };
    const r = { m: { currency: 'INR' } };
    expect(mergeReports([rep('a', '2026-01-01', r, [t, { ...t }]), rep('b', '2026-01-02', r, [t])], 'INR').n).toBe(2);
    expect(mergeReports([rep('a', '2026-01-01', r, [t]), rep('b', '2026-01-02', r, [t, { ...t }, { ...t }])], 'INR').n).toBe(3);
  });

  it('currencies never mix; the main currency comes first', () => {
    const all = [rep('a', '2026-01-01', tb), rep('b', '2026-01-02', binance)];
    expect(lifetimeCurrencies(all).map((c) => c.currency)).toEqual(['INR', 'USD']);
    expect(mergeReports(all, 'USD').n).toBe(binance.trades.length);
    expect(mergeReports(all, 'INR').n).toBe(tb.trades.length);
  });

  it('trades are in date order; best and worst month are real months', () => {
    const l = mergeReports([rep('a', '2026-01-01', tb)], 'INR');
    const ds = l.trades.map((t) => t.exitDate || t.entryDate).filter(Boolean);
    expect([...ds].sort()).toEqual(ds);
    expect(l.months.some((m) => m.key === l.bestMonth?.key)).toBe(true);
    expect(l.from! <= l.to!).toBe(true);
  });
});
