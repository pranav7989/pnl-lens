/**
 * @file  packages/shared/test/desk-charges.test.ts
 * @area  Tests
 * @what  Desk calculator: the spec B2.6 golden example to the paisa (charges only and with slippage), one case per segment, delivery STT on both sides, the brokerage cap, STT rounding flag, rate set by date, position size (lots, zero-lot message, costs included), session state.
 */
import { describe, it, expect } from 'vitest';
import { calcCharges, positionSize, rateFor, paise, type ChargeRates, type BrokeragePlan } from '../src/desk/charges';
import { sessionState, istParts } from '../src/desk/session';

// the 1 Apr 2026 seed rows (migration 0033)
const R = {
  options_nse: { stt_buy: 0, stt_sell: 0.0015, exch_txn: 0.0003553, sebi_per_crore: 10, stamp_buy: 0.00003, gst: 0.18 },
  futures_nse: { stt_buy: 0, stt_sell: 0.0005, exch_txn: 0.0000183, sebi_per_crore: 10, stamp_buy: 0.00002, gst: 0.18 },
  delivery_nse: { stt_buy: 0.001, stt_sell: 0.001, exch_txn: 0.0000307, sebi_per_crore: 10, stamp_buy: 0.00015, gst: 0.18 },
  intraday_bse: { stt_buy: 0, stt_sell: 0.00025, exch_txn: 0.0000375, sebi_per_crore: 10, stamp_buy: 0.00003, gst: 0.18 },
  currency_opt_nse: { stt_buy: 0, stt_sell: 0, exch_txn: 0.000311, sebi_per_crore: 10, stamp_buy: 0.000001, gst: 0.18 },
  commodity_fut_mcx: { stt_buy: 0, stt_sell: 0.0001, exch_txn: 0.000021, sebi_per_crore: 10, stamp_buy: 0.00002, gst: 0.18 },
} satisfies Record<string, ChargeRates>;
const FLAT20: BrokeragePlan = { flat_per_order: 20 };
const PCT_CAP: BrokeragePlan = { pct: 0.0003, cap_per_order: 20 };
const money = (c: ReturnType<typeof calcCharges>) => ({
  turnover: paise(c.turnover), brokerage: paise(c.brokerage), stt: paise(c.stt), exchTxn: paise(c.exchTxn), gst: paise(c.gst),
  sebi: paise(c.sebi), stamp: paise(c.stamp), total: paise(c.total),
});

describe('spec B2.6 golden example (must match the mock to the paisa)', () => {
  const c = calcCharges({ segment: 'options', buy: 120, sell: 170, qty: 65, rates: R.options_nse, brokerage: FLAT20, slippagePerUnit: 1.6 });
  it('charges table', () => {
    expect(money(c)).toEqual({ turnover: 18850, brokerage: 40, stt: 17, exchTxn: 6.7, gst: 8.41, sebi: 0.02, stamp: 0.23, total: 72.36 });
  });
  it('charges only (as in the mock): 1.11 points, ₹3,177.64', () => {
    expect(paise(c.pointsToBreakeven)).toBe(1.11);
    expect(paise(c.netPnl)).toBe(3177.64);
  });
  it('with the trader slippage (spec): ₹104.00, real cost ₹176.36, 2.71 points, ₹3,073.64', () => {
    expect(c.withSlippage && { s: paise(c.withSlippage.slippage), r: paise(c.withSlippage.realCost), p: paise(c.withSlippage.pointsToBreakeven), n: paise(c.withSlippage.netPnl) })
      .toEqual({ s: 104, r: 176.36, p: 2.71, n: 3073.64 });
    expect(calcCharges({ segment: 'options', buy: 120, sell: 170, qty: 65, rates: R.options_nse, brokerage: FLAT20 }).withSlippage).toBeNull();
  });
  it('position size: risk ₹3,000, SL 90, lot 65 → 65 (1 lot), loss at SL ≈ ₹2,012 with costs', () => {
    const s = positionSize({ segment: 'options', side: 'buy', entry: 120, stopLoss: 90, riskBudget: 3000, lotSize: 65, rates: R.options_nse, brokerage: FLAT20, slippagePerUnit: 1.6 });
    expect(s.maxQty).toBe(65);
    expect(s.lots).toBe(1);
    expect(Math.round(s.lossAtStop)).toBe(2012);
    expect(s.message).toBeNull();
  });
});

describe('every segment', () => {
  it('delivery: STT on both buy and sell value; ₹0 brokerage', () => {
    const c = calcCharges({ segment: 'eq_delivery', buy: 1000, sell: 1010, qty: 100, rates: R.delivery_nse, brokerage: { flat_per_order: 0 } });
    expect(paise(c.stt)).toBe(Math.round(0.001 * 100000 + 0.001 * 101000));                       // 201
    expect(paise(c.brokerage)).toBe(0);
    expect(paise(c.stamp)).toBe(15);                                                                  // 0.015% of buy value only
  });
  it('intraday (BSE): STT on sell only; brokerage 0.03% capped at ₹20 per order', () => {
    const small = calcCharges({ segment: 'eq_intraday', buy: 100, sell: 101, qty: 100, rates: R.intraday_bse, brokerage: PCT_CAP });
    expect(paise(small.brokerage)).toBe(paise(0.0003 * 10000 + 0.0003 * 10100));                     // 3.00 + 3.03, under the cap
    const big = calcCharges({ segment: 'eq_intraday', buy: 1000, sell: 1010, qty: 1000, rates: R.intraday_bse, brokerage: PCT_CAP });
    expect(big.brokerage).toBe(40);                                                                   // capped: ₹20 x 2 orders
    expect(big.stt).toBe(Math.round(0.00025 * 1010000));
  });
  it('futures (NSE)', () => {
    const c = calcCharges({ segment: 'futures', buy: 25200, sell: 25260, qty: 65, rates: R.futures_nse, brokerage: PCT_CAP });
    expect(c.brokerage).toBe(40);
    expect(c.stt).toBe(Math.round(0.0005 * 25260 * 65));
    expect(paise(c.netPnl)).toBe(paise(60 * 65 - c.total));
  });
  it('currency options: no STT', () => {
    expect(calcCharges({ segment: 'currency_opt', buy: 0.5, sell: 0.6, qty: 1000, rates: R.currency_opt_nse, brokerage: FLAT20 }).stt).toBe(0);
  });
  it('commodity futures (MCX): CTT on sell', () => {
    const c = calcCharges({ segment: 'commodity_fut', buy: 6000, sell: 6050, qty: 100, rates: R.commodity_fut_mcx, brokerage: PCT_CAP });
    expect(c.stt).toBe(Math.round(0.0001 * 605000));
  });
  it('STT rounding can be turned off by the rate set', () => {
    expect(calcCharges({ segment: 'options', buy: 120, sell: 170, qty: 65, rates: { ...R.options_nse, stt_round_rupee: false }, brokerage: FLAT20 }).stt).toBeCloseTo(16.575, 9);
  });
});

describe('rate set by date', () => {
  const rows = [{ effective_from: '2024-10-01', stt_sell: 0.001 }, { effective_from: '2026-04-01', stt_sell: 0.0015 }];
  it('31 Mar 2026 uses the old STT, 1 Apr 2026 the new one', () => {
    expect(rateFor(rows, '2026-03-31')!.stt_sell).toBe(0.001);
    expect(rateFor(rows, '2026-04-01')!.stt_sell).toBe(0.0015);
    expect(rateFor(rows, '2024-01-01')).toBeNull();
  });
});

describe('position size', () => {
  it('equity is not rounded to lots; futures are', () => {
    const eq = positionSize({ segment: 'eq_intraday', side: 'buy', entry: 1000, stopLoss: 990, riskBudget: 3000, rates: R.intraday_bse, brokerage: PCT_CAP });
    expect(eq.lots).toBeNull();
    expect(eq.maxQty).toBeGreaterThan(250);
    expect(eq.lossAtStop).toBeLessThanOrEqual(3000);
    const fut = positionSize({ segment: 'futures', side: 'sell', entry: 25200, stopLoss: 25250, riskBudget: 10000, lotSize: 65, rates: R.futures_nse, brokerage: PCT_CAP });
    expect(fut.maxQty % 65).toBe(0);
    expect(fut.maxQty).toBe(65 * 2);                                                                   // 3 lots = 9,750 + STT ~2,457 > 10,000
    expect(fut.lossAtStop).toBeLessThanOrEqual(10000);
  });
  it('less than one lot: zero with the message', () => {
    const s = positionSize({ segment: 'options', side: 'buy', entry: 120, stopLoss: 70, riskBudget: 2000, lotSize: 65, rates: R.options_nse, brokerage: FLAT20 });
    expect(s.maxQty).toBe(0);
    expect(s.message).toBe('Your risk rule allows less than 1 lot at this stop-loss');
  });
  it('costs are included: never over the budget', () => {
    for (const risk of [1000, 2500, 3000, 7777]) {
      const s = positionSize({ segment: 'eq_intraday', side: 'buy', entry: 250, stopLoss: 245, riskBudget: risk, rates: R.intraday_bse, brokerage: PCT_CAP, slippagePerUnit: 0.1 });
      expect(s.lossAtStop + 0.1 * s.maxQty).toBeLessThanOrEqual(risk);
    }
  });
});

describe('session state (IST)', () => {
  const eq = { is_holiday: false, pre_open: '09:00', open: '09:15', close: '15:30' };
  const at = (h: number, m: number) => h * 60 + m;
  it('equity: pre-open, open, closed; holiday; no row = closed', () => {
    expect(sessionState(eq, at(8, 42))).toBe('closed');
    expect(sessionState(eq, at(9, 5))).toBe('pre_open');
    expect(sessionState(eq, at(9, 15))).toBe('open');
    expect(sessionState(eq, at(15, 30))).toBe('closed');
    expect(sessionState({ ...eq, is_holiday: true }, at(11, 0))).toBe('holiday');
    expect(sessionState(null, at(11, 0))).toBe('closed');
  });
  it('MCX (to 23:55) and currency (to 17:00)', () => {
    expect(sessionState({ is_holiday: false, pre_open: null, open: '09:00', close: '23:55' }, at(23, 40))).toBe('open');
    expect(sessionState({ is_holiday: false, pre_open: null, open: '09:00', close: '17:00' }, at(17, 0))).toBe('closed');
  });
  it('IST parts and the header label', () => {
    const p = istParts(new Date('2026-11-24T03:12:00Z'));                                             // 08:42 IST
    expect(p).toMatchObject({ day: '2026-11-24', minutes: 8 * 60 + 42 });
    expect(p.label).toBe('Tue 24 Nov 2026');
  });
});
