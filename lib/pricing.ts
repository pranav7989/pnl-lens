/**
 * @file  lib/pricing.ts
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
  months: number | null; retentionDays: number; progress: boolean;
  /** how long the plan stays valid after purchase */
  days: number;
}
export const PLANS: Plan[] = [
  { id: 'single', name: 'Single', inrMinor: 9900, usdMinor: 499, reports: 1, filesPerReport: 2, months: null, retentionDays: 7, progress: false, days: 7 },
  { id: 'snapshot', name: 'Snapshot', inrMinor: 49900, usdMinor: 1900, reports: 5, filesPerReport: 3, months: null, retentionDays: 180, progress: false, days: 183 },
  { id: 'progress', name: 'Progress', inrMinor: 149900, usdMinor: 4900, reports: 25, filesPerReport: 3, months: 3, retentionDays: 120, progress: true, days: 92 },
  { id: 'discipline', name: 'Discipline', inrMinor: 399900, usdMinor: 12900, reports: 90, filesPerReport: 3, months: 12, retentionDays: 395, progress: true, days: 365 },
];

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
