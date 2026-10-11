/**
 * @file  app/api/payments/order/route.ts
 * @area  Payments
 * @what  POST { planId } — off: 503 · link: pasted Razorpay URL · razorpay: creates an Order for Checkout.
 */
/**
 * POST /api/payments/order   { planId }
 * ----------------------------------------------------------------------------
 * Signed-in users only. The price is always computed on the server from the
 * plan and the visitor's country (never taken from the browser).
 *   mode off      → 503 { mode: 'off' }
 *   mode link     → { mode: 'link', url }      (pasted Razorpay Payment Page/Link)
 *   mode razorpay → creates a Razorpay Order, stores a 'created' payment row,
 *                   returns the options Checkout needs.
 * ----------------------------------------------------------------------------
 */
import { json, fail, requireUser, isResponse } from '@/lib/api/http';
import { paymentsMode, paymentLink, razorpayKeys } from '@/lib/payments/config';
import { createOrder } from '@/lib/payments/razorpay';
import { PLANS, planPrice, type PlanId } from '@/lib/pricing';
import { clientCountry } from '@/lib/auth/request';
import { captureError, track } from '@/lib/admin/telemetry';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireUser(); if (isResponse(user)) return user;
  const body = await req.json().catch(() => ({}));
  const plan = PLANS.find((p) => p.id === body?.planId);
  if (!plan) return fail(400, 'bad_plan', 'Unknown plan');
  const price = planPrice(plan, clientCountry(req) || user.country);
  const mode = paymentsMode();

  /* ---- off: payments not open yet ---- */
  if (mode === 'off') return fail(503, 'payments_off', 'Payments are opening soon. Write to support@pnllens.com to be notified.');

  /* ---- link: send the buyer to the pasted Razorpay Payment Page/Link ---- */
  if (mode === 'link') {
    const url = paymentLink(plan.id as PlanId, price.currency);
    if (!url) return fail(503, 'link_missing', 'This plan is not available for purchase yet.');
    await track(user.id, 'checkout_link_opened', { plan: plan.id, currency: price.currency });
    return json({ mode: 'link', url });
  }

  /* ---- razorpay: Orders API + Checkout ---- */
  try {
    const order = await createOrder({ amountMinor: price.amountMinor, currency: price.currency, receipt: `${plan.id}-${user.id.slice(0, 8)}-${Date.now().toString(36)}`, notes: { plan: plan.id, user: user.id } });
    await pool().query(`insert into public.payments (user_id, gateway, gateway_order_id, amount_minor, currency, status, plan_id, credits_granted) values ($1, 'razorpay', $2, $3, $4, 'created', $5, $6)`,
      [user.id, order.id, price.amountMinor, price.currency, plan.id, plan.reports]);
    const { rows } = await pool().query('select email from public.users where id = $1', [user.id]);
    return json({ mode: 'razorpay', keyId: razorpayKeys().keyId, orderId: order.id, amount: price.amountMinor, currency: price.currency,
      name: 'PnL Lens', description: `${plan.name} plan`, prefill: { email: rows[0]?.email || '' } });
  } catch (e) {
    await captureError(e, { source: 'server', route: 'POST /api/payments/order', userId: user.id, context: { plan: plan.id } });
    return fail(502, 'gateway_error', 'Could not start the payment. Please try again in a minute.');
  }
}
