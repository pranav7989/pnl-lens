/**
 * @file  apps/web/app/api/payments/verify/route.ts
 * @area  Payments
 * @what  POST — verifies the Checkout signature and marks the payment authorized (plan is granted by the webhook).
 */
/**
 * POST /api/payments/verify   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Called by Checkout's success handler. Verifies the signature and marks the
 * payment 'authorized' so the UI can say "payment received". The plan itself is
 * granted ONLY by the webhook (Razorpay's recommended practice), which is
 * idempotent and survives the browser closing mid-payment.
 */
import { json, fail, requireUser, isResponse } from '@/lib/api/http';
import { verifyCheckout } from '@/lib/payments/razorpay';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireUser(); if (isResponse(user)) return user;
  const b = await req.json().catch(() => ({}));
  const ok = typeof b?.razorpay_order_id === 'string' && verifyCheckout(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature);
  if (!ok) return fail(400, 'bad_signature', 'Payment could not be verified.');
  await pool().query(`update public.payments set status = 'authorized', gateway_payment_id = $3 where gateway_order_id = $1 and user_id = $2 and status = 'created'`,
    [b.razorpay_order_id, user.id, b.razorpay_payment_id]);
  return json({ ok: true, message: 'Payment received. Your plan will be active in a few seconds.' });
}
