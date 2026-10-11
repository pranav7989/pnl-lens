/**
 * @file  apps/web/app/api/payments/webhook/route.ts
 * @area  Payments
 * @what  POST — Razorpay webhook. Verifies signature; payment.captured/order.paid grant the plan (idempotent).
 */
/**
 * POST /api/payments/webhook   (configured in the Razorpay Dashboard)
 * ----------------------------------------------------------------------------
 * The ONLY place a plan is granted.
 *   1. verify X-Razorpay-Signature = HMAC-SHA256(raw body, RAZORPAY_WEBHOOK_SECRET)
 *   2. payment.captured / order.paid → grant_plan() (idempotent SQL function)
 *      payment.failed               → mark failed
 *      refund.processed             → mark refunded (access is reviewed by an admin)
 *   3. always answer 200 quickly once the signature is valid (Razorpay retries non-2xx)
 * Docs: https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/
 * ----------------------------------------------------------------------------
 */
import { verifyWebhook, parseWebhook } from '@/lib/payments/razorpay';
import { PLANS } from '@pnl-lens/shared/pricing';
import { captureError } from '@/lib/admin/telemetry';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();                                     // raw body is required for the signature
  if (!verifyWebhook(raw, req.headers.get('x-razorpay-signature'))) return new Response('invalid signature', { status: 401 });
  let body: any; try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const { event, orderId, paymentId } = parseWebhook(body);
  try {
    if ((event === 'payment.captured' || event === 'order.paid') && orderId) {
      const { rows } = await pool().query('select plan_id from public.payments where gateway_order_id = $1', [orderId]);
      const plan = PLANS.find((p) => p.id === rows[0]?.plan_id);
      if (plan) await pool().query('select public.grant_plan($1, $2, $3, $4, $5, $6)', [orderId, paymentId, body, plan.reports, plan.filesPerReport, plan.days]);
    } else if (event === 'payment.failed' && orderId) {
      await pool().query(`update public.payments set status = 'failed', raw_payload = $2 where gateway_order_id = $1 and status in ('created', 'authorized')`, [orderId, body]);
    } else if (event === 'refund.processed' && paymentId) {
      await pool().query(`update public.payments set status = 'refunded', raw_payload = $2 where gateway_payment_id = $1`, [paymentId, body]);
    }
  } catch (e) {
    await captureError(e, { source: 'server', route: 'POST /api/payments/webhook', context: { event, orderId } });
    return new Response('error', { status: 500 });                  // Razorpay will retry
  }
  return new Response('ok', { status: 200 });
}
