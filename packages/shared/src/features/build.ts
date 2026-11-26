/**
 * @file  packages/shared/src/features/build.ts
 * @area  Desk
 * @what  Trade Check features (architecture doc §4): one pure function describes a stored trade and, later, a typed plan line in the same words (underlying, instrument, side, expiry kind, days to expiry, weekday, time of day, size vs usual, place in the day, losses before it, premium), so history and plans can be matched.
 */
/**
 * Choices for v1, written down so they can be revisited:
 * - Days to expiry come from the contract's own expiry date (exchange data), never from a weekday name, so trades
 *   around NSE's September 2025 move from Thursday to Tuesday still land on dte = 0 on expiry day. Calendar days.
 * - Time of day: stored trades give the hour only, so the buckets break on whole hours: before 11:00, 11:00–13:00,
 *   from 13:00 (the doc's 13:30 split needs minutes we don't have). Plan lines use the same hour rule.
 * - Size: quantity ÷ the trader's median quantity for the same underlying and instrument (lot-size history before
 *   Nov 2026 isn't available; the ratio equals the lots ratio while the lot size is unchanged).
 * - Place in the day and losses before it: from the order of entries in the day (exit times aren't stored), so
 *   "after 2 losses" means two earlier entries of that day that ended in a loss.
 * A feature the data can't give is null ("unavailable"); the profile and the matcher skip it.
 */
export const FEATURE_VERSION = '1';
export const FEATURES = ['underlying', 'instrument', 'option_type', 'side', 'expiry_kind', 'dte', 'weekday', 'time_bucket', 'size_ratio', 'session_seq', 'after_losses', 'premium_bucket'] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, string | null>;

export interface Facts {
  underlying: string | null;
  kind: 'EQ' | 'FUT' | 'CE' | 'PE';
  side: 'buy' | 'sell' | null;        // the opening side
  date: string | null;                // YYYY-MM-DD of entry
  hour: number | null;                // entry hour (IST)
  expiry: string | null;              // the contract's expiry
  expiryType: string | null;          // engine: Weekly / Monthly / Futures
  qty: number;
  entryPrice: number | null;          // per unit
}
export interface FeatureContext {
  /** the trader's median quantity for an underlying + instrument (null = no history) */
  medianQty?: (underlying: string | null, instrument: string) => number | null;
  /** weekly/monthly from the expiry calendar, when known */
  expiryKind?: (underlying: string | null, expiry: string) => 'weekly' | 'monthly' | null;
  /** 1-based place of the trade among the day's entries, and losses among the day's earlier entries */
  sessionSeq?: number | null;
  afterLosses?: number | null;
}

const INSTRUMENT = { EQ: 'equity', FUT: 'future', CE: 'option', PE: 'option' } as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 864e5;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function dteBucket(date: string | null, expiry: string | null): string | null {
  if (!isDay(date) || !isDay(expiry)) return null;
  const d = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  if (d < 0) return null;                                   // inconsistent data: never guess
  return d === 0 ? '0' : d === 1 ? '1' : d <= 4 ? '2-4' : '5+';
}
export const timeBucket = (hour: number | null) => (hour == null || !Number.isFinite(hour) ? null : hour < 11 ? 'open' : hour < 13 ? 'mid' : 'late');
export function sizeBucket(qty: number, median: number | null): string | null {
  if (!median || !(median > 0) || !(qty > 0)) return null;
  const r = qty / median;
  return r <= 1 ? '<=1x' : r <= 2 ? '1-2x' : '>2x';
}
const seqBucket = (n: number | null | undefined) => (n == null || n < 1 ? null : n === 1 ? '1st' : n === 2 ? '2nd' : '3rd+');
const lossBucket = (n: number | null | undefined) => (n == null || n < 0 ? null : n === 0 ? '0' : n === 1 ? '1' : '2+');
const premiumBucket = (p: number | null) => (p == null || !(p > 0) ? null : p < 50 ? '<50' : p <= 150 ? '50-150' : '>150');
function kindOfExpiry(t: string | null): 'weekly' | 'monthly' | null {
  const s = String(t ?? '').toLowerCase();
  return s.startsWith('week') ? 'weekly' : s.startsWith('month') || s.startsWith('fut') ? 'monthly' : null;
}

export function features(f: Facts, ctx: FeatureContext = {}): Features {
  const instrument = INSTRUMENT[f.kind];
  const deriv = instrument !== 'equity';
  const underlying = f.underlying ? f.underlying.trim().toUpperCase() : null;
  return {
    underlying,
    instrument,
    option_type: instrument === 'option' ? f.kind : null,
    side: f.side,
    expiry_kind: deriv && isDay(f.expiry) ? (ctx.expiryKind?.(underlying, f.expiry) ?? kindOfExpiry(f.expiryType)) : null,
    dte: deriv ? dteBucket(f.date, f.expiry) : null,
    weekday: isDay(f.date) ? WEEKDAYS[new Date(`${f.date}T00:00:00Z`).getUTCDay()] : null,
    time_bucket: timeBucket(f.hour),
    size_ratio: sizeBucket(f.qty, ctx.medianQty?.(underlying, instrument) ?? null),
    session_seq: seqBucket(ctx.sessionSeq),
    after_losses: lossBucket(ctx.afterLosses),
    premium_bucket: instrument === 'option' ? premiumBucket(f.entryPrice) : null,
  };
}

/** An engine trade (report.trades[i]) -> facts. Statements without an opening side, dates or times give nulls. */
export function factsFromTrade(t: any): Facts {
  const kind = (['EQ', 'FUT', 'CE', 'PE'].includes(t?.kind) ? t.kind : 'EQ') as Facts['kind'];
  const qty = Math.abs(Number(t?.qty) || 0);
  const side = t?.direction === 'Long' ? 'buy' : t?.direction === 'Short' ? 'sell' : null;
  const value = side === 'sell' ? Number(t?.sell) : Number(t?.buy);
  const hour = Number.isInteger(t?.entryHour) ? t.entryHour : null;
  return {
    underlying: t?.underlying || t?.symbol || null, kind, side,
    date: isDay(t?.entryDate) ? t.entryDate : null, hour,
    expiry: isDay(t?.expiry) ? t.expiry : null, expiryType: t?.expiryType ?? null,
    qty, entryPrice: qty && Number.isFinite(value) && value > 0 ? value / qty : null,
  };
}

/** Which features a trader's data can't give at all (shown as "Upload a tradebook to unlock …"). */
export function unavailable(all: Features[]): FeatureName[] {
  return FEATURES.filter((k) => !all.some((f) => f[k] != null));
}
