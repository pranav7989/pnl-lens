/**
 * @file  packages/shared/src/pricing.ts
 * @area  Payments
 * @what  Plans and prices (single source of truth): reports, statements per report, validity, ₹/$ by country.
 */
/**
 * Single source of truth for plans and prices. Used by the landing page, the pricing page and
 * (phase 5) POST /api/payments/order — so the price shown is always the price charged.
 * Country comes from CloudFront-Viewer-Country or the signed-in user's stored country;
 * unknown → PRICING_DEFAULT_COUNTRY.
 */
export type PlanId = 'single' | 'snapshot' | 'progress' | 'discipline';
export interface Plan {
  id: PlanId; name: string; inrMinor: number; usdMinor: number; reports: number; filesPerReport: number;
  /** length of the plan in months, shown to users (null = Single: a few days of access) */
  months: number | null; retentionDays: number; progress: boolean;
  /** how long the plan stays valid after purchase (window for creating new reports; API + DB grant use this) */
  days: number;
}
// Durations as of 15 Oct 2026 (owner, REQ-3): Single 7 days, Snapshot 3 months, Progress 6 months, Discipline 12 months.
export const PLANS: Plan[] = [
  { id: 'single', name: 'Single', inrMinor: 9900, usdMinor: 900, reports: 1, filesPerReport: 2, months: null, retentionDays: 7, progress: false, days: 7 },
  { id: 'snapshot', name: 'Snapshot', inrMinor: 49900, usdMinor: 1900, reports: 5, filesPerReport: 3, months: 3, retentionDays: 92, progress: false, days: 92 },
  { id: 'progress', name: 'Progress', inrMinor: 149900, usdMinor: 4900, reports: 25, filesPerReport: 3, months: 6, retentionDays: 183, progress: true, days: 183 },
  { id: 'discipline', name: 'Discipline', inrMinor: 399900, usdMinor: 12900, reports: 90, filesPerReport: 3, months: 12, retentionDays: 395, progress: true, days: 365 },
];

/* Plan wording, built only from PLANS so durations are written in one place. */
const reportsWord = (n: number) => `${n} report${n === 1 ? '' : 's'}`;
/** Pricing card subtitle: "one-time" (Single) or "for 3 months". */
export const durationLabel = (p: Plan) => (p.months ? `for ${p.months} months` : 'one-time');
/** Short length: "7 days" or "6 months". */
export const lengthLabel = (p: Plan) => (p.months ? `${p.months} months` : `${p.days} days`);
/** First card bullet: "1 report", "5 reports", or "25 reports over 6 months" for progress plans. */
export const reportsBullet = (p: Plan) => (p.progress && p.months ? `${reportsWord(p.reports)} over ${p.months} months` : reportsWord(p.reports));
/** Validity bullet for plans without "over N months": "Use within 7 days", "Use within 3 months" (credits spec, 19 Oct 2026). */
export const validityBullet = (p: Plan) => (p.progress ? null : p.months ? `Use within ${p.months} months` : `Use within ${p.days} days`);

/**
 * When a plan bought or granted at `from` ends: calendar months (19-Oct-26 + 3 months = 19-Jan-27; 31-Aug + 6 months =
 * 28/29-Feb), Single = 7 days. The window for using the plan's reports (credits spec rule 4).
 */
export function planEndsAt(p: Plan, from: Date = new Date()): Date {
  if (!p.months) return new Date(from.getTime() + p.days * 86400e3);
  const y = from.getUTCFullYear(), m = from.getUTCMonth() + p.months, d = from.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();                     // last day of the target month
  return new Date(Date.UTC(y, m, Math.min(d, lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}
/** Whole days from `from` to the plan's end (what the database grant functions take). */
export const planDays = (p: Plan, from: Date = new Date()) => Math.round((planEndsAt(p, from).getTime() - from.getTime()) / 86400e3);
/** Checkout description / plan name on payments: "Snapshot plan · 5 reports · 3 months". */
export const planSummary = (p: Plan) => `${p.name} plan · ${reportsWord(p.reports)} · ${lengthLabel(p)}`;
/** Approved decision D4: reports never expire. Shown on every pricing card. */
export const REPORTS_KEPT = 'Reports kept until you delete them';

export interface Price { country: string; currency: 'INR' | 'USD'; amountMinor: number; label: string }
const fmtINR = (minor: number) => '₹' + (minor / 100).toLocaleString('en-IN');
const fmtUSD = (minor: number) => '$' + (minor / 100).toLocaleString('en-US', { minimumFractionDigits: minor % 100 ? 2 : 0 });

export function planPrice(plan: Plan, country: string | null | undefined): Price {
  const c = (country || process.env.PRICING_DEFAULT_COUNTRY || 'US').toUpperCase();
  return c === 'IN'
    ? { country: c, currency: 'INR', amountMinor: plan.inrMinor, label: fmtINR(plan.inrMinor) }
    : { country: c, currency: 'USD', amountMinor: plan.usdMinor, label: fmtUSD(plan.usdMinor) };
}
/** India site vs global site (US, Europe and everywhere else). */
export type Region = 'IN' | 'GLOBAL';
export const regionFor = (country: string | null | undefined): Region => ((country || process.env.PRICING_DEFAULT_COUNTRY || 'US').toUpperCase() === 'IN' ? 'IN' : 'GLOBAL');

export function plansFor(country: string | null | undefined) {
  return PLANS.map((p) => ({ ...p, price: planPrice(p, country) }));
}
/** Back-compat: the standard single-report price (Snapshot). */
export function priceFor(country: string | null | undefined): Price {
  return planPrice(PLANS[1], country);
}
