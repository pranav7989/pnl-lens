# Payments — Razorpay (domestic + international)

Payments are built and switched **off** until the company registration and Razorpay activation are done. Switching on is a configuration change, not a code change.

## 1. Two modes (`PAYMENTS_MODE`)

| Mode | Use when | What happens | Needs |
|---|---|---|---|
| `off` (default) | Registration pending | Buy buttons show "Payments opening soon" + support email | Nothing |
| `razorpay` | Live | Orders API → Checkout → signature check → **webhook grants the plan** | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

Link mode (pasted Payment Pages, plans granted by hand) was removed in backend-v2 (plan D5). A plan is granted only by the verified webhook, or by the owner-only manual grant in the admin console (reason required, audited).

## 2. How the full integration works (`razorpay` mode)

| Step | Where | Notes |
|---|---|---|
| 1. Buyer clicks Buy | `apps/web/components/payments/BuyButton.tsx` | Must be signed in |
| 2. Create order | `POST /api/v1/payments/order` (`apps/api/src/routes/payments.ts`) → `packages/shared/src/payments/razorpay.ts` `createOrder()` | Price computed on the server from `packages/shared/src/pricing.ts` and the visitor's country (₹ for India, $ elsewhere). A `payments` row is stored as `created` |
| 3. Checkout opens | `checkout.js` from `https://checkout.razorpay.com/v1/checkout.js` | Prefilled with the user's real email (international payments fail with dummy email/phone) |
| 4. Success handler | `POST /api/v1/payments/verify` | Verifies `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`; marks `authorized`; UI says "payment received" |
| 5. **Webhook** | `POST /api/payments/webhook` (also `/api/v1/payments/webhook`) | Verifies `X-Razorpay-Signature = HMAC_SHA256(raw body, webhook_secret)`. `payment.captured` / `order.paid` → `grant_plan()` (one transaction, idempotent). `payment.failed` → failed. `refund.processed` → refunded |
| 6. Plan active | `subscriptions` table + credits | Reports, statements per report and validity come from `packages/shared/src/pricing.ts` |

The plan is granted **only by the webhook**, following Razorpay's guidance that the Checkout callback is not a replacement for webhooks. A replayed webhook grants nothing twice (tested).

## 3. Razorpay dashboard setup

1. Complete KYC and business verification; generate **Test** API keys first.
2. Settings → Webhooks → add `https://pnllens.com/api/payments/webhook`, set a secret, enable **payment.captured, payment.failed, order.paid, refund.processed**.
3. Payment capture: set **automatic capture** (authorised payments must be captured to settle).
4. **International payments**: Account & Settings → International payments → activate International Cards (activation form; Razorpay may do a video verification). Settlement is in INR.
5. Add `checkout.razorpay.com` to the site's Content-Security-Policy (`script-src`, `frame-src`) when CSP is enabled.
6. Go live: replace test keys with live keys and set `PAYMENTS_MODE=razorpay`.

## 4. Official Razorpay documentation

| Topic | Link |
|---|---|
| Standard Checkout — end-to-end guide | https://razorpay.com/docs/developer-tools/integrations/standard-checkout/ |
| Node.js server integration steps (orders, signature) | https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/ |
| Web Standard Checkout — best practices (webhooks to enable) | https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/best-practices/ |
| Webhooks setup | https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/ |
| Orders API — create order | https://razorpay.com/docs/api/orders/create |
| International payments (activation, currencies) | https://razorpay.com/docs/payments/international-payments |
| International payments FAQ (currency, settlement in INR) | https://razorpay.com/docs/payments/international-payments/faqs |

## 5. Testing without live keys

- Unit: `tests/payments.test.ts` (signatures).
- API tests: `apps/api/test/payments-admin.test.ts` (off mode, signature checks, a replayed webhook grants once, the old webhook URL still works).
