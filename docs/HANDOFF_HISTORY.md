# PnL Lens — Developer Handoff

**Hosting:** AWS only — ECS on Fargate, RDS for PostgreSQL, ALB, ECR, Secrets Manager, EventBridge, SES, CloudWatch.
**Sign-in:** "Continue with Google" or a 6-digit code by email. No SMS, no phone numbers — works in every country.

**Status:** landing page, database, engine (incl. behaviour layer and PDF/Word reading), report v2, upload → report, dashboard/exports, **sign-in**, offline single-file build, and AWS packaging are built and tested.
Remaining: provision AWS (0), payments (5), hardening (7), launch (9).

| Mode | Command | Uses |
|---|---|---|
| Local, zero setup | `npm run dev` | JSON file store, dev user, emails written to `.data/dev-mail.log` |
| Local, production-like | `docker compose up --build` | Postgres 16 in Docker |
| AWS | `docs/DEPLOYMENT_AWS_ALTERNATIVE.md` | RDS + ECS Fargate + SES |

---

## 1. What is finished

| Area | Scope | Where | Verified by |
|---|---|---|---|
| **Landing page** | Public homepage at `/`: headline promise, animated lens scanning a sample trade ledger, SEBI FY26 loss statistic (sourced), 6 headline mistakes with example evidence (plus a one-line list of the other checks), rules + what-if section, interactive tour of the 4 report tabs, 8 use cases, supported brokers/exchanges (10 Indian, 8 international, 8 crypto; tested layouts marked) with a logo strip, 3-step how-it-works, privacy and "what we'll never do", pricing (one price, chosen by the visitor's country via `lib/pricing.ts`), FAQ, disclaimer. Signed-in visitors get Dashboard / New report CTAs. Self-hosted Archivo variable font (OFL) | `app/page.tsx`, `components/landing/Landing.tsx`, `app/landing.css`, `public/landing.js`, `app/fonts/` | Screenshots at 1440 / 1024 / 390 px; no horizontal scroll; tabs with arrow-key support; reduced-motion shows the finished state; page complete with JavaScript off; app pages unaffected (report E2E re-run) |
| **Report v2** | Hover cards on every tile (current vs ideal behaviour, ~40 keys; tap ⓘ on touch), Behavioural mistakes section on Insights (8 headline + up to 12 more, from a 100-trait library), Clusters split into "When you trade" (month/weekday tiles) and "How you hold, size & pick" (bar charts), Archivo font, CSS-only motion, "analysing" loader | `lib/report-ui/render.js`, `lib/report-ui/loader.js`, `app/report.css` | `tests/e2e/v2.py` — 21 checks |
| **Behaviour layer** | ~70 trading signals → 100 data-triggered traits (each: score, your numbers, the psychology, the ideal) + per-tile hover text; stored in report JSON as `behaviour` | `lib/engine/behaviour.js` | `tests/behaviour.test.ts` — unique names/explanations, no broken text, varied per trader, ≥40 distinct traits across fixtures |
| **PDF / Word input** | PDF via pdf.js text positions (rows by y, cells by x gaps, repeated page headers dropped); DOCX from document.xml tables; legacy Word 97 .doc via piece table; RTF; HTML-as-.doc via SheetJS | `lib/engine/extract.js`, `workers/analyze.worker.ts`, `components/UploadClient.tsx`, `public/pdf.worker.min.mjs` (copied on postinstall) | `tests/extract.test.ts` — each format matches its CSV original |
| **Offline single file** | Landing + full upload → report tool in one HTML, no server/internet; pdf.js embedded and loaded only when a PDF is dropped | `offline/` (`build_offline.py` rebuilds it from a running server) | 23 browser checks |
| **Database** | 6 tables, least-privilege `lens_app` role (no DELETE, no DDL), transactional SQL functions, auto-created credits row for new users, migration runner | `db/migrations/0001–0004`, `scripts/migrate.mjs` | `db/tests/01_functions.sql` on a fresh Postgres 16; runner idempotent |
| **Engine** | Broker-agnostic parser, statement + tradebook, India / US / CME / crypto / FX, currency detection, clusters, behaviour stats, leaks, rules, patterns, versioned report JSON | `lib/engine/` | 31 tests, 7 broker formats |
| **Storage** | `PgStore` (RDS, SSL, pooled, user-scoped) and `FileStore` (local) | `lib/store/`, `lib/db.ts` | 7 integration tests incl. cross-user isolation |
| **Upload → report** | 3 files / 10MB, Web Worker parsing, SHA-256, preview, column mapper, currency override, atomic save, 4-tab report | `components/UploadClient.tsx`, `workers/`, `app/(app)/*`, `app/api/reports` | 21 browser checks |
| **Dashboard & exports** | Report list, credits, expiry countdown, delete, expired page, CSV, PDF | `app/(app)/dashboard`, `components/ReportView.tsx` | included above |
| **Sign-in** | One page for new and returning users. **Google** (OpenID Connect, PKCE, state, nonce, ID-token signature/issuer/audience/expiry checks, verified email required). **Email code** (6 digits, HMAC-hashed, 10-min expiry, single use, 5-attempt lockout, 5 codes/email/hour, 20/IP/hour). Same email via either method → same account. 30-day httpOnly session cookie, logout, return to the requested page after sign-in. Mail via **Amazon SES**, Resend, or local file | `lib/auth/`, `lib/mail/`, `app/api/auth/*`, `app/(auth)/login`, `components/auth/` | 4 unit tests + **20 browser checks** against a mock Google provider that issues real RS256 tokens: happy paths, wrong/reused/expired codes, lockout, rate limit, tampered state, unverified Google email, missing cookie, account linking |
| **AWS packaging** | Dockerfile (standalone, non-root, RDS CA), compose, `/api/health`, purge script, deploy guide incl. SES + Google setup, GitHub Actions (OIDC → ECR → migrate → ECS) | `Dockerfile`, `docker-compose.yml`, `scripts/`, `docs/DEPLOYMENT_AWS_ALTERNATIVE.md`, `.github/workflows/deploy.yml` | Standalone server + scripts run directly; security checks passed |

**Not tested here** (no Docker daemon, AWS account or Google project in the build environment): `docker build`, compose, the GitHub workflow, real SES delivery and real Google consent. The code paths they use were all tested directly or against mocks.

---

## 2. What is left

| Phase | Work | Est. |
|---|---|---|
| **0 · AWS provisioning** | VPC, RDS, ECR, ECS, ALB, ACM, Route 53, CloudFront, Secrets Manager, EventBridge, alarms, GitHub OIDC role | 1.5–2 days |
| **3b · Sign-in go-live** | SES domain + production access; Google OAuth consent screen + client; set env | 0.5 day |
| **5 · Payments** | Razorpay order + checkout + webhook + credits; pricing page | 3–4 days |
| **7 · Hardening** | Report rate limit, CSP, SheetJS upgrade, account deletion, WAF | 2 days |
| **9 · Launch** | Checklist, live payment smoke tests | 1 day |
| | **Total** | **~8–10 dev days** |

---

## 3. Roadmap

### Phase 0 — AWS provisioning
Follow `docs/DEPLOYMENT_AWS_ALTERNATIVE.md` steps 1–5 and 7–9. Put **CloudFront in front of the ALB** so the app receives `CloudFront-Viewer-Country` (used for ₹ vs $ pricing; without it everyone is priced in USD).

**Done when:** a staging stack passes `tests/e2e/flow.py` (with `AUTH_MODE=dev` + `ALLOW_DEV_AUTH_IN_PROD=true`, staging only, IP-restricted) and the purge task logs a run.

### Phase 3b — Sign-in go-live
Follow `docs/DEPLOYMENT_AWS_ALTERNATIVE.md` step 6.
1. SES: verify domain (DKIM, SPF, DMARC), request production access, grant the task role `ses:SendEmail`.
2. Google: OAuth consent screen (published, `openid email profile`), web client with redirect `{APP_URL}/api/auth/google/callback`.
3. Env: `AUTH_MODE=jwt`, `APP_URL`, `SESSION_SECRET`, `OTP_PEPPER`, `MAIL_DRIVER=ses`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**Done when:** a real Gmail account signs in with Google; a non-Gmail address receives a code in its inbox (not spam) and signs in; `/dashboard` without a cookie redirects to `/login`.

### Phase 5 — Payments (Razorpay)
- **`POST /api/payments/order`:** charge exactly what the visitor was shown: `priceFor(clientCountry(req) || session.country)` from `lib/pricing.ts` (the landing and pricing pages use the same function). Never take the amount from the client. Create the Razorpay order, insert a `payments` row with status `created`, and return `{ order_id, amount, currency, key_id }`.
- **Pricing page:** load Razorpay Checkout; on success only redirect to `/dashboard?paid=1`.
- **`POST /api/payments/webhook`:**
  - Verify `X-Razorpay-Signature` (HMAC-SHA256 of the raw body via `await req.text()`).
  - On `payment.captured`: add migration `0005` with a `grant_credits(p_order_id, p_payment_id, p_payload)` function that marks the payment paid and increments credits in one transaction, idempotent on `gateway_payment_id`; `grant execute … to lens_app`.
  - Handle `payment.failed` and `refund.processed`. Return 200 fast.
- Pre-fill Razorpay's email field from the signed-in user (the user's email is in `users.email`).

**Done when:** a test payment adds exactly one credit; a replayed webhook adds none; a bad signature → 401; IN users see ₹499, others $19.

### Phase 7 — Hardening
| Task | Detail |
|---|---|
| Report rate limit | `POST /api/reports` 10/user/day (TODO in the route); count rows in `reports` for the last 24 h |
| CSP | `style-src 'self' 'unsafe-inline'`; `script-src` + `frame-src` allow `checkout.razorpay.com`; `worker-src 'self' blob:`; `form-action 'self' accounts.google.com` |
| SheetJS | npm `xlsx@0.18.5` has known advisories (browser-only, user's own files). Upgrade: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, then `npm test` |
| Next.js | Pinned to patched `14.2.35`; keep patched |
| WAF | AWS managed common rules on CloudFront/ALB + rate-based rule on `/api/auth/*` |
| Account deletion | `DELETE /api/me`: null report payloads, anonymise email/name, clear `google_sub`, keep payments |
| OTP housekeeping | Add `delete from otp_codes where created_at < now() - interval '7 days'` to the nightly purge |
| Backups | Test an RDS point-in-time restore |

### Phase 9 — Launch checklist
- [ ] `AUTH_MODE=jwt`, `STORE_DRIVER=pg`, `DATABASE_SSL=require`, `ALLOW_DEV_AUTH_IN_PROD` absent
- [ ] App connects as `lens_app`; `seed.sql` never applied in production
- [ ] SES out of the sandbox; test codes land in the inbox for Gmail, Outlook and Yahoo
- [ ] Google consent screen published (not "Testing", which limits you to 100 test users)
- [ ] Razorpay live keys, webhook on the production domain
- [ ] Purge task logged a successful run; alarms go to an inbox you read
- [ ] Production E2E with a real ₹ and a real $ payment

---

## 4. Design decisions — do not reverse without discussion

| Decision | Why |
|---|---|
| Parsing in the browser; only report JSON stored | Raw tradebooks never reach AWS |
| Email + Google only, no SMS | Works in every country with no telecom registration; email is also the identity Razorpay needs |
| One sign-in page; accounts keyed by email | Google and email-code sign-ins for the same address land in the same account |
| Codes stored as HMAC(email:code), single use, 5 attempts | A database leak doesn't expose usable codes |
| Credit + report insert in one SQL function | No double-spend |
| App connects as `lens_app` (no DELETE, no DDL) | A compromised app server can't drop tables |
| Credits only via verified webhook | Browser callbacks can be forged |
| Purge nulls payloads, keeps rows; runs as an ECS task | Billing history survives; no public maintenance endpoint |

## 5. Open product questions

| Item | Note |
|---|---|
| Preview before paying | Upload preview shows position count, period, market, currency and net P&L before spending a credit |
| Delete doesn't refund | Stated in the confirm dialog |
| Pricing when country is unknown | Falls back to `PRICING_DEFAULT_COUNTRY` (US → $19). Only one price is ever shown to a visitor |
| Broker logos | Drop official files into `public/brokers/<slug>.svg` (slugs in `public/brokers/README.md`) and they replace the names automatically. Use each company's official brand kit and get permission where their guidelines require it |
| Broker coverage (internal) | Zerodha, Dhan, Groww, Interactive Brokers and Binance layouts are covered by fixtures; the landing page lists more brokers without badges. Before launch, run a real export from each other listed broker through the upload page and add a fixture + test for any that need a new column synonym |
| Landing page figures | The example ledger, rules and what-if numbers are illustrative and labelled so. Update the SEBI statistic when SEBI publishes a newer study |
| Legal pages | The footer links to Sign in, FAQ and Pricing only. Add Privacy Policy, Terms and Refund Policy pages before launch — Razorpay and Google's OAuth consent screen both require a privacy policy URL |
| Report numbers come from the client | Server validates structure, not arithmetic; fine for self-analysis |
| Scanned PDFs | No text layer, so they can't be read; the user gets a message asking for Excel/CSV. OCR (e.g. Tesseract.js) could be added later but is slow in the browser |
| Old .doc edge cases | Fast-saved or unusual Word 97 files may not parse; same fallback message |
| pdf.js + Next 14 | Next 14's minifier can't process pdf.js's worker, so the legacy build is imported and the worker is served from `public/` (see `scripts/copy-pdf-worker.mjs`). Upgrading to Next 15 would allow the standard build |
| Behaviour wording | Traits describe habits from the trader's own data and are deliberately non-diagnostic. Review the 100 texts in `lib/engine/behaviour.js` with whoever owns the brand voice before launch |

## 6. Plans, progress and file rules (added)

| Item | Where | Developer action |
|---|---|---|
| Four plans (Single ₹99/$4.99 · 1 report, Snapshot ₹499/$19 · 5 reports, Progress ₹1,499/$49 · 25 reports in 3 months, Discipline ₹3,999/$129 · 90 reports in 12 months) | `lib/pricing.ts` (`PLANS`, `planPrice`) | Razorpay order must charge `planPrice(plan, country)`. Add `plan_id`, `reports_total`, `reports_used`, `files_per_report`, `ends_at` to a `subscriptions` table; grant report credits per plan in the webhook |
| Progress tab (score, six habits, mistake tracker, monthly trends, check-up history) | `lib/engine/engine.js` (`buildProgress`), `lib/report-ui/render.js` | Website: pass `history` to `mountReport` from the user's saved reports (`progress.overall.score`, period, created date) |
| One report = a fixed set of files | Offline tool enforces it locally (trade fingerprints in `offline/app_offline.js`) | **Enforce server-side**: when a report is saved, store each file's trade fingerprint; adding files to an existing report must reject new fingerprints once `files_per_report` is reached; removing a file never frees a place. Local enforcement can be bypassed by clearing browser data |
| Retention by plan | `PLANS[].retentionDays` | Set `reports.expires_at` from the plan instead of a fixed 30 days |
| No-refund + support notice | Landing pricing, FAQ, footer; upload screen | Keep `support@pnllens.com` monitored |

## 7. Two sites and plan-to-report mapping (added)

| Item | Where | Developer action |
|---|---|---|
| India site vs Global site | `regionFor()` in `lib/pricing.ts`; `region` prop in `components/landing/Landing.tsx` and `Showcase.tsx` | Chosen from `CloudFront-Viewer-Country` (IN → India, everything else → Global); `/?region=in` or `/?region=global` overrides. Optionally serve `pnllens.in` and `pnllens.com` from the same app by mapping each domain to a region |
| Plan → reports | Offline tool: `offline/app_offline.js` (`PLANS`, plan card, month-grouped history) | Website: on report creation, decrement `subscriptions.reports_used`; refuse when used ≥ total or `ends_at` passed; show the same plan card ("2 of 90 used · Till OCT-27") and list reports grouped by month (`MON-YY`) on the dashboard |
| Report history | Offline: IndexedDB (`pnllens` → `reports`) + `pnllens.reports` index | Website: the `reports` table already stores each report; add `GET /api/reports?group=month` or group client-side |

## 8. Hosting on DigitalOcean + admin console (added)

| Item | Where | Notes |
|---|---|---|
| **Hosting target: DigitalOcean** (replaces AWS as primary) | `docs/DEPLOYMENT_DIGITALOCEAN.md`, `.do/app.yaml` | App Platform (Docker, 2 instances, BLR) + Managed PostgreSQL 16 + Cloudflare DNS for pnllens.com + Resend email. Migrations run as a PRE_DEPLOY job; nightly purge is a SCHEDULED job. `docs/DEPLOYMENT_AWS_ALTERNATIVE.md` kept as an alternative |
| Country detection | `lib/auth/country.ts`, `lib/auth/request.ts` | Reads Cloudflare `CF-IPCountry` (also CloudFront / `X-Country`) |
| DB certificate | `lib/db.ts`, `scripts/migrate.mjs`, `scripts/purge.mjs` | `DATABASE_CA_CERT` (PEM text, DigitalOcean `${db.CA_CERT}`) or `DATABASE_CA_PATH` |
| **Roles** owner / admin / support / finance / analyst | `lib/admin/rbac.ts`, migration `0005_admin.sql` | Role read from DB on every admin request; server returns 403 for anything outside the role. Admins can't create owners; nobody can change their own role. First owner: `UPDATE users SET role='owner' WHERE email=...` |
| **Admin console** `/admin` — Users · Finance · Errors · Support · Product | `app/admin`, `components/admin/AdminConsole.tsx`, `lib/admin/queries.ts`, `app/api/admin/*` | DAU/WAU/MAU, stickiness, new & repeat users, retention, countries; revenue ₹/$, plan mix, refunds, gateway fees, running costs, monthly margin; grouped error center; ticket queue + user lookup with likely cause and timeline; reports, upload failure reasons, tab usage |
| Telemetry | `lib/admin/telemetry.ts`, `app/api/events`, `app/api/errors`, `components/ErrorReporter.tsx` | Daily activity, logins, report creation, upload failures, browser + server errors. Costs: insert monthly rows into `costs` (hosting, database, email, marketing…) |
| Demo data (local only) | `scripts/seed-admin-demo.mjs` | Refuses to run with NODE_ENV=production |
| Tests | `tests/rbac.test.ts`, `tests/e2e/admin.py` | 6 unit + 19 browser checks across all roles |
