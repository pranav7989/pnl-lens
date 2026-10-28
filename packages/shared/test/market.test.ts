/**
 * @file  packages/shared/test/market.test.ts
 * @area  Tests
 * @what  Market context: index change over the period, VIX bands and index-move bands on the entry day (BANKNIFTY trades use NIFTY BANK), coverage and nulls, your return with capital.
 */
import { describe, it, expect } from 'vitest';
import { marketContext, VIX_BANDS, MOVE_BANDS, type Close } from '../src/insights/market';

const days = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'];
const s = (closes: number[]): Close[] => days.map((day, i) => ({ day, close: closes[i] }));
const series = {
  NIFTY: s([100, 101.5, 101, 99.5, 100.2]),                 // +1.5%, −0.49%, −1.49%, +0.70%
  BANKNIFTY: s([200, 196, 199, 199.5, 203]),                // −2%, +1.53%, +0.25%, +1.75%
  INDIAVIX: s([12, 14, 19, 27, 15]),
};

describe('market context', () => {
  it('index change, VIX and move bands', () => {
    const T = [
      { pnl: 100, entryDate: '2025-01-02', underlying: 'NIFTY' },      // NIFTY +1.5% · VIX 14 Normal
      { pnl: -50, entryDate: '2025-01-03', underlying: 'RELIANCE' },   // NIFTY −0.49% · VIX 19 Nervous
      { pnl: -80, entryDate: '2025-01-06', underlying: 'NIFTY' },      // NIFTY −1.49% · VIX 27 Panicky
      { pnl: 30, entryDate: '2025-01-02', underlying: 'BANKNIFTY' },   // BANK −2% · VIX 14 Normal
    ];
    const c = marketContext(T, series, 100000)!;
    expect(c).toMatchObject({ from: '2025-01-02', to: '2025-01-06', coverage: 1 });
    expect(c.nifty!.changePct).toBeCloseTo((99.5 / 100 - 1) * 100, 6);   // close before the first day → last day's close
    expect(c.yourPct).toBeCloseTo(0, 6);
    expect(c.byVix!.map((b) => [b.key, b.n])).toEqual([[VIX_BANDS[1][0], 2], [VIX_BANDS[2][0], 1], [VIX_BANDS[3][0], 1]]);
    expect(c.byMove!.map((b) => [b.key, b.n, b.pnl])).toEqual([[MOVE_BANDS[0], 2, -50], [MOVE_BANDS[1], 1, -50], [MOVE_BANDS[2], 1, 100]]);
  });

  it('days without data are left out; under half placed → null sections; no dated trades → null', () => {
    const T = [{ pnl: 1, entryDate: '2025-01-02' }, { pnl: 1, entryDate: '2025-02-10' }, { pnl: 1, entryDate: '2025-02-11' }];
    const c = marketContext(T, series)!;
    expect(c.byVix).toBeNull();
    expect(c.coverage).toBeCloseTo(1 / 3, 6);
    expect(c.yourPct).toBeNull();
    expect(marketContext([{ pnl: 5 }], series)).toBeNull();
    expect(marketContext(T, {})!.nifty).toBeNull();
  });
});
