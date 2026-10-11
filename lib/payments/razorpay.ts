/**
 * @file  lib/payments/razorpay.ts
 * @area  Payments
 * @what  Razorpay Orders API, Checkout signature and webhook signature verification (no SDK).
 */
/**
 * ============================================================================
 * PAYMENTS · Razorpay provider
 * ----------------------------------------------------------------------------
 * Implements the three server-side pieces of Razorpay Standard Checkout:
 *   1. createOrder()          POST https://api.razorpay.com/v1/orders
 *   2. verifyCheckout()       HMAC-SHA256(order_id + "|" + payment_id, key_secret)
 *   3. verifyWebhook()        HMAC-SHA256(raw request body, webhook_secret)
 * Official docs (linked in docs/PAYMENTS_RAZORPAY.md):
 *   https://razorpay.com/docs/developer-tools/integrations/standard-checkout/
 *   https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/
 *   https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/
 * No SDK needed: plain fetch + node:crypto.
 * ============================================================================
 */
import crypto from 'node:crypto';
import { razorpayKeys } from './config';

/* ---------- 1. Orders API ---------------------------------------------------- */
export interface RazorpayOrder { id: string; amount: number; currency: string; receipt: string; status: string }

export async function createOrder(p: { amountMinor: number; currency: 'INR' | 'USD'; receipt: string; notes?: Record<string, string> }): Promise<RazorpayOrder> {
  const { keyId, keySecret } = razorpayKeys();
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
    body: JSON.stringify({ amount: p.amountMinor, currency: p.currency, receipt: p.receipt.slice(0, 40), notes: p.notes || {} }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`razorpay_order_failed: ${j?.error?.description || res.status}`);
  return j as RazorpayOrder;
}

/* ---------- helpers ---------------------------------------------------------- */
const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- 2. Checkout handler signature (browser → our server) --------------- */
export function verifyCheckout(orderId: string, paymentId: string, signature: string, keySecret = razorpayKeys().keySecret) {
  return !!keySecret && safeEqual(hmac(keySecret, `${orderId}|${paymentId}`), signature);
}

/* ---------- 3. Webhook signature (Razorpay → our server) ---------------------- */
export function verifyWebhook(rawBody: string, signature: string | null, secret = razorpayKeys().webhookSecret) {
  return !!secret && !!signature && safeEqual(hmac(secret, rawBody), signature);
}

/** Extracts what we need from payment.captured / order.paid / payment.failed / refund.processed events. */
export function parseWebhook(body: any): { event: string; orderId: string | null; paymentId: string | null } {
  const pay = body?.payload?.payment?.entity, order = body?.payload?.order?.entity, refund = body?.payload?.refund?.entity;
  return { event: String(body?.event || ''), orderId: pay?.order_id || order?.id || null, paymentId: pay?.id || refund?.payment_id || null };
}
