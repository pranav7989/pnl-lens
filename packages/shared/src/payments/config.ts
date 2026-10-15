/**
 * @file  packages/shared/src/payments/config.ts
 * @area  Payments
 * @what  PAYMENTS_MODE for backend v2 (off | razorpay; link mode removed, plan D5) and the Razorpay keys.
 */
/**
 * PAYMENTS_MODE
 *   off       → buy buttons show "Payments opening soon" (default while the company registration is pending).
 *   razorpay  → Orders API → Checkout → signature check → webhook grants the plan. Needs the RAZORPAY_* secrets.
 * Link mode (pasted Payment Pages, plans granted by hand) is removed in v2 (plan D5): a plan is granted only by
 * the verified webhook, or by the audited owner-only manual grant. apps/web keeps its own link-mode switch until
 * the Phase 6 cutover removes its payment routes.
 */
export type PaymentsMode = 'off' | 'razorpay';

export function paymentsMode(): PaymentsMode {
  const m = (process.env.PAYMENTS_MODE || 'off').toLowerCase();
  return m === 'razorpay' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'off';
}

export const razorpayKeys = () => ({
  keyId: process.env.RAZORPAY_KEY_ID || '',
  keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
});
