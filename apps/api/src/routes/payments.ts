/**
 * @file  apps/api/src/routes/payments.ts
 * @area  Payments
 * @what  Payments ported from apps/web/app/api/payments/*: config, order, verify, and the Razorpay webhook (the ONLY place a plan is granted).
 */
/**
 * Modes: off | razorpay (link mode removed, plan D5). The price is always computed on the server from the plan and
 * the visitor's country. The webhook verifies X-Razorpay-Signature over the raw body, then grant_plan() (idempotent)
 * creates the plan with values from packages/shared PLANS, never from the request.
 */
import { z } from 'zod';
import { PLANS, planPrice, planSummary, planDays } from '@pnl-lens/shared/pricing';
import { paymentsMode, razorpayKeys } from '@pnl-lens/shared/payments/config';
import { createOrder, verifyCheckout, verifyWebhook, parseWebhook } from '@pnl-lens/shared/payments/razorpay';
import { clientCountry } from '@pnl-lens/shared/auth/request';
import { captureErrorWith, trackWith } from '@pnl-lens/shared/admin/telemetry';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, asFetchLike } from '../lib/http.js';

export async function paymentRoutes(app: App, deps: Deps, opts: { webhookOnly?: boolean } = {}) {
  /** POST — Razorpay webhook. Verifies the signature; payment.captured / order.paid grant the plan (idempotent). */
  await app.register(async (w) => {
    // raw body is required for the signature
    w.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    w.post('/payments/webhook', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { tags: ['payments'], summary: 'Razorpay webhook (signature-checked)', hide: !!opts.webhookOnly } }, async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : '';
      const text = (code: number, msg: string) => reply.code(code).type('text/plain').send(msg);
      if (!verifyWebhook(raw, (req.headers['x-razorpay-signature'] as string | undefined) ?? null)) return text(401, 'invalid signature');
      let body: any; try { body = JSON.parse(raw); } catch { return text(400, 'bad json'); }
      const { event, orderId, paymentId } = parseWebhook(body);
      try {
        if ((event === 'payment.captured' || event === 'order.paid') && orderId) {
          const { rows } = await deps.pool.query('select plan_id from public.payments where gateway_order_id = $1', [orderId]);
          const plan = PLANS.find((p) => p.id === rows[0]?.plan_id);
          if (plan) {
            const g = await deps.pool.query('select public.grant_plan($1, $2, $3, $4, $5, $6) as ok', [orderId, paymentId, body, plan.reports, plan.filesPerReport, planDays(plan)]);
            // REQ-2: a purchase that started from the journey bar or card (Razorpay returns the order's notes)
            const notes = body?.payload?.payment?.entity?.notes || body?.payload?.order?.entity?.notes || {};
            if (g.rows[0]?.ok && notes.source === 'journey') {
              const { rows: u } = await deps.pool.query('select user_id from public.payments where gateway_order_id = $1', [orderId]);
              await trackWith(deps.pool, u[0]?.user_id ?? null, 'upgrade_from_journey', { plan: plan.id });
            }
          }
        } else if (event === 'payment.failed' && orderId) {
          await deps.pool.query(`update public.payments set status = 'failed', raw_payload = $2 where gateway_order_id = $1 and status in ('created', 'authorized')`, [orderId, body]);
        } else if (event === 'refund.processed' && paymentId) {
          await deps.pool.query(`update public.payments set status = 'refunded', raw_payload = $2 where gateway_payment_id = $1`, [paymentId, body]);
        }
      } catch (e) {
        await captureErrorWith(deps.pool, e, { source: 'server', route: 'POST /payments/webhook', context: { event, orderId } });
        return text(500, 'error');                                     // Razorpay will retry
      }
      return text(200, 'ok');
    });
  });
  if (opts.webhookOnly) return;

  /** Active payment mode and prices for the pricing page. */
  app.get('/payments/config', { schema: { tags: ['payments'], summary: 'Payment mode and plan prices for this visitor' } }, async (req, reply) => {
    const mode = paymentsMode(), country = clientCountry(asFetchLike(req));
    const plans = PLANS.map((p) => { const price = planPrice(p, country); return { id: p.id, price: price.label, currency: price.currency }; });
    return ok(reply, { mode, plans, support: 'support@pnllens.com' });
  });

  /** POST { planId } — off: 503 · razorpay: creates an Order for Checkout. */
  app.post('/payments/order', {
    attachValidation: true,
    schema: { tags: ['payments'], summary: 'Start a payment for a plan', security: [{ session: [] }], body: z.object({ planId: z.string(), source: z.enum(['journey']).optional() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const plan = PLANS.find((p) => p.id === (req.body as any)?.planId);
    if (!plan) return fail(reply, 400, 'bad_plan', 'Unknown plan');
    const price = planPrice(plan, clientCountry(asFetchLike(req)) || user.country);
    if (paymentsMode() === 'off') return fail(reply, 503, 'payments_off', 'Payments are opening soon. Write to support@pnllens.com to be notified.');
    try {
      const order = await createOrder({ amountMinor: price.amountMinor, currency: price.currency, receipt: `${plan.id}-${user.id.slice(0, 8)}-${Date.now().toString(36)}`, notes: { plan: plan.id, user: user.id, ...((req.body as any)?.source === 'journey' ? { source: 'journey' } : {}) } });
      await deps.pool.query(`insert into public.payments (user_id, gateway, gateway_order_id, amount_minor, currency, status, plan_id, credits_granted) values ($1, 'razorpay', $2, $3, $4, 'created', $5, $6)`,
        [user.id, order.id, price.amountMinor, price.currency, plan.id, plan.reports]);
      const { rows } = await deps.pool.query('select email from public.users where id = $1', [user.id]);
      await trackWith(deps.pool, user.id, 'checkout_started', { plan: plan.id, currency: price.currency });
      return ok(reply, { mode: 'razorpay', keyId: razorpayKeys().keyId, orderId: order.id, amount: price.amountMinor, currency: price.currency,
        name: 'PnL Lens', description: planSummary(plan), prefill: { email: rows[0]?.email || '' } });
    } catch (e) {
      await captureErrorWith(deps.pool, e, { source: 'server', route: 'POST /payments/order', userId: user.id, context: { plan: plan.id } });
      return fail(reply, 502, 'gateway_error', 'Could not start the payment. Please try again in a minute.');
    }
  });

  /** Verifies the Checkout signature and marks the payment authorized. The plan itself is granted only by the webhook. */
  app.post('/payments/verify', {
    attachValidation: true,
    schema: { tags: ['payments'], summary: 'Confirm Checkout (plan is granted by the webhook)', security: [{ session: [] }],
      body: z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const b = req.body as any;
    const valid = typeof b?.razorpay_order_id === 'string' && verifyCheckout(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature);
    if (!valid) return fail(reply, 400, 'bad_signature', 'Payment could not be verified.');
    await deps.pool.query(`update public.payments set status = 'authorized', gateway_payment_id = $3 where gateway_order_id = $1 and user_id = $2 and status = 'created'`,
      [b.razorpay_order_id, user.id, b.razorpay_payment_id]);
    return ok(reply, { ok: true, message: 'Payment received. Your plan will be active in a few seconds.' });
  });
}
