/**
 * @file  packages/shared/src/desk/charges.ts
 * @area  Desk
 * @what  Desk calculator (spec v1.0 B2): brokerage, STT/CTT, exchange charges, SEBI fee, stamp duty, GST, breakeven and net P&L (charges only, and with the trader's slippage), and position size from a risk budget; pure, shared by the browser and the API.
 */
/**
 * All rates come from the database (charge_rates, brokerage_plans) with an effective date; nothing is hard-coded here.
 * Rates are fractions (0.0015 = 0.15%). Money is computed unrounded and rounded to paise only for display; STT is
 * rounded to the nearest rupee when the rate set says so (as contract notes do). The trader types every price.
 */

export type DeskSegment = 'eq_delivery' | 'eq_intraday' | 'futures' | 'options' | 'currency_fut' | 'currency_opt' | 'commodity_fut' | 'commodity_opt';
export const SEGMENTS: DeskSegment[] = ['eq_intraday', 'eq_delivery', 'futures', 'options', 'currency_fut', 'currency_opt', 'commodity_fut', 'commodity_opt'];
export const F_AND_O: DeskSegment[] = ['futures', 'options', 'currency_fut', 'currency_opt', 'commodity_fut', 'commodity_opt'];

export interface ChargeRates {
  stt_buy: number; stt_sell: number; stt_exercise?: number; exch_txn: number; sebi_per_crore: number; stamp_buy: number;
  gst: number; ipft_per_crore?: number; stt_round_rupee?: boolean;
}
export interface BrokeragePlan { flat_per_order?: number | null; pct?: number | null; cap_per_order?: number | null }
export interface CalcInput {
  segment: DeskSegment;
  buy: number;
  sell: number;
  qty: number;
  rates: ChargeRates;
  brokerage: BrokeragePlan;
  /** number of buy and sell orders (default 1 + 1) */
  orders?: { buy: number; sell: number };
  /** the trader's average slippage per unit (null = unknown) */
  slippagePerUnit?: number | null;
}
export interface Charges {
  turnover: number; buyValue: number; sellValue: number;
  brokerage: number; stt: number; exchTxn: number; sebi: number; ipft: number; stamp: number; gst: number; total: number;
  /** charges only: what the mock shows */
  pointsToBreakeven: number; netPnl: number;
  /** with the trader's slippage, when known */
  withSlippage: { slippage: number; realCost: number; pointsToBreakeven: number; netPnl: number } | null;
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
/** rupees to paise, for display and tests (half away from zero, without float surprises like 1.005) */
export const paise = (x: number) => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;

function brokerageFor(orderValue: number, plan: BrokeragePlan): number {
  if (plan.pct != null) {
    const v = plan.pct * orderValue;
    return plan.cap_per_order != null ? Math.min(v, plan.cap_per_order) : v;
  }
  return num(plan.flat_per_order);
}

/** Every charge for one round trip (buy then sell), unrounded except STT when the rate set rounds it. */
export function calcCharges(i: CalcInput): Charges {
  const qty = Math.max(0, num(i.qty));
  const buyValue = num(i.buy) * qty, sellValue = num(i.sell) * qty;
  const turnover = buyValue + sellValue;
  const orders = i.orders ?? { buy: 1, sell: 1 };
  const r = i.rates;
  const brokerage = brokerageFor(orders.buy ? buyValue / orders.buy : 0, i.brokerage) * orders.buy
    + brokerageFor(orders.sell ? sellValue / orders.sell : 0, i.brokerage) * orders.sell;
  const sttRaw = num(r.stt_buy) * buyValue + num(r.stt_sell) * sellValue;
  const stt = r.stt_round_rupee === false ? sttRaw : Math.round(sttRaw);
  const exchTxn = num(r.exch_txn) * turnover;
  const sebi = (num(r.sebi_per_crore) / 1e7) * turnover;
  const ipft = (num(r.ipft_per_crore) / 1e7) * turnover;
  const stamp = num(r.stamp_buy) * buyValue;
  const gst = num(r.gst) * (brokerage + exchTxn + sebi + ipft);
  const total = brokerage + stt + exchTxn + sebi + ipft + stamp + gst;
  const gross = (num(i.sell) - num(i.buy)) * qty;
  const slip = i.slippagePerUnit != null && i.slippagePerUnit >= 0 ? i.slippagePerUnit * qty : null;
  return {
    turnover, buyValue, sellValue, brokerage, stt, exchTxn, sebi, ipft, stamp, gst, total,
    pointsToBreakeven: qty ? total / qty : 0, netPnl: gross - total,
    withSlippage: slip == null ? null : { slippage: slip, realCost: total + slip, pointsToBreakeven: qty ? (total + slip) / qty : 0, netPnl: gross - total - slip },
  };
}

export interface SizeInput {
  segment: DeskSegment;
  side: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  riskBudget: number;
  lotSize?: number | null;
  rates: ChargeRates;
  brokerage: BrokeragePlan;
  slippagePerUnit?: number | null;
}
export interface Size {
  maxQty: number;
  lots: number | null;
  lossAtStop: number;            // |entry - SL| x qty + charges of that round trip (spec B2.5)
  riskPerUnit: number;
  message: string | null;        // e.g. "Your risk rule allows less than 1 lot at this stop-loss"
}

/** Largest quantity whose loss at the stop-loss, with costs, stays within the risk budget (F&O: whole lots). */
export function positionSize(i: SizeInput): Size {
  const gap = Math.abs(num(i.entry) - num(i.stopLoss));
  const lot = F_AND_O.includes(i.segment) && i.lotSize && i.lotSize > 0 ? i.lotSize : 1;
  const slip = i.slippagePerUnit != null && i.slippagePerUnit > 0 ? i.slippagePerUnit : 0;
  const roundTrip = (qty: number) => calcCharges({
    segment: i.segment, qty, rates: i.rates, brokerage: i.brokerage,
    buy: i.side === 'buy' ? i.entry : i.stopLoss, sell: i.side === 'buy' ? i.stopLoss : i.entry,
  }).total;
  if (!gap || !(i.riskBudget > 0)) return { maxQty: 0, lots: lot > 1 ? 0 : null, lossAtStop: 0, riskPerUnit: gap, message: gap ? 'Set a risk per trade to size the position' : 'Set a stop-loss different from the entry' };
  // charges per unit depend on the quantity (flat brokerage), so estimate at the quantity the gap alone allows
  const first = Math.max(lot, Math.floor(i.riskBudget / gap));
  const riskPerUnit = gap + roundTrip(first) / first + slip;
  let qty = Math.floor(Math.floor(i.riskBudget / riskPerUnit) / lot) * lot;
  while (qty > 0 && gap * qty + roundTrip(qty) + slip * qty > i.riskBudget) qty -= lot;     // never over budget
  const loss = qty ? gap * qty + roundTrip(qty) : 0;
  return {
    maxQty: qty, lots: lot > 1 ? qty / lot : null, lossAtStop: loss, riskPerUnit,
    message: qty ? null : lot > 1 ? 'Your risk rule allows less than 1 lot at this stop-loss' : 'Your risk rule allows less than 1 unit at this stop-loss',
  };
}

/** The rate set in force on a day: the newest effective_from on or before it. */
export function rateFor<T extends { effective_from: string }>(rows: T[], day: string): T | null {
  return rows.filter((r) => r.effective_from <= day).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
}
