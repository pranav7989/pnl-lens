/**
 * @file  app/api/payments/config/route.ts
 * @area  Payments
 * @what  GET — active payment mode and per-plan link availability for the pricing page.
 */
/**
 * GET /api/payments/config
 * Tells the pricing page which payment mode is active (off | link | razorpay)
 * and, in link mode, which plans have a pasted Razorpay link for this visitor's currency.
 */
import { json } from '@/lib/api/http';
import { paymentsMode, paymentLink } from '@/lib/payments/config';
import { PLANS, planPrice } from '@/lib/pricing';
import { clientCountry } from '@/lib/auth/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const mode = paymentsMode(), country = clientCountry(req);
  const plans = PLANS.map((p) => { const price = planPrice(p, country); return { id: p.id, price: price.label, currency: price.currency, link: mode === 'link' ? !!paymentLink(p.id, price.currency) : undefined }; });
  return json({ mode, plans, support: 'support@pnllens.com' });
}
