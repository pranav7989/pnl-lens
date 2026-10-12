/**
 * @file  apps/web/lib/payments/config.ts
 * @area  Payments
 * @what  PAYMENTS_MODE switch (off | link | razorpay) and pasted Razorpay links.
 */
/**
 * ============================================================================
 * PAYMENTS · configuration (the only switch you need)
 * ----------------------------------------------------------------------------
 * PAYMENTS_MODE
 *   off       → buy buttons show "Payments opening soon" (default while the
 *               company registration is pending). Nothing else changes.
 *   link      → buy buttons open a Razorpay Payment Page / Payment Link that you
 *               paste below, one per plan and currency. Plans are then granted
 *               by an admin (or by the webhook if you also set the secret).
 *   razorpay  → full integration: Orders API → Checkout → signature check →
 *               webhook grants the plan. Needs the three RAZORPAY_* secrets.
 *
 * Paste links (link mode):
 *   PAYMENT_LINK_SINGLE_INR, PAYMENT_LINK_SINGLE_USD, PAYMENT_LINK_SNAPSHOT_INR, …
 *   (PLAN = SINGLE | SNAPSHOT | PROGRESS | DISCIPLINE, CURRENCY = INR | USD)
 * Docs: docs/PAYMENTS_RAZORPAY.md
 * backend-v2: apps/api supports off | razorpay only (plan D5); this link mode lives on in apps/web until the
 * Phase 6 cutover removes the web payment routes.
 * ============================================================================
 */
import type { PlanId } from '@pnl-lens/shared/pricing';

export type PaymentsMode = 'off' | 'link' | 'razorpay';

export function paymentsMode(): PaymentsMode {
  const m = (process.env.PAYMENTS_MODE || 'off').toLowerCase();
  if (m === 'razorpay' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) return 'razorpay';
  if (m === 'link') return 'link';
  return 'off';
}

/** Razorpay Payment Page / Link pasted for a plan and currency (link mode). */
export function paymentLink(plan: PlanId, currency: 'INR' | 'USD'): string | null {
  const url = process.env[`PAYMENT_LINK_${plan.toUpperCase()}_${currency}`];
  return url && /^https:\/\/(rzp\.io|pages\.razorpay\.com|razorpay\.me|[a-z0-9.-]*razorpay\.com)\//i.test(url) ? url : null;
}

export { razorpayKeys } from '@pnl-lens/shared/payments/config';
