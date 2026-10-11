# PnL Lens — Master Index

Start here. Every source file starts with a 3-line header (`@file`, `@area`, `@what`); the table at the bottom is generated from those headers.

## 1. Read in this order

| # | Document | What you get |
|---|---|---|
| 1 | `docs/INDEX.md` (this file) | Map of the code and where to change things |
| 2 | `docs/ARCHITECTURE.md` | How the pieces fit, request flows, security model |
| 3 | `docs/DEPLOYMENT_DIGITALOCEAN.md` | Step-by-step deployment for pnllens.com |
| 4 | `docs/ENVIRONMENT.md` | Every environment variable |
| 5 | `docs/PAYMENTS_RAZORPAY.md` | Payment modes and the Razorpay integration (with official doc links) |
| 6 | `docs/TESTING.md` | How to run every test suite |
| 7 | `docs/HANDOFF_HISTORY.md` | Detailed change log and decisions |
| 8 | `docs/BACKEND_V2_PLAN.md` | Plan for moving parsing/analysis to the server (backend-v2, draft) |

## 2. Folder map

| Folder | Contains |
|---|---|
| `app/` | Next.js routes: pages (`page.tsx`) and API endpoints (`api/**/route.ts`), global CSS, `icon.svg` |
| `components/` | React components: landing, upload, report view, admin console, auth, payments |
| `lib/engine/` | The analysis engine (runs in the browser): parsing, trades, insights, behaviour, progress |
| `lib/report-ui/` | Report renderer + "analysing" loader (shared by website and offline tool) |
| `lib/auth/` | Sessions, email codes, Google sign-in, country detection |
| `lib/payments/` | Payment mode switch and Razorpay provider |
| `lib/admin/` | Roles/permissions, telemetry, admin SQL |
| `lib/store/` | Report storage (Postgres in production, JSON file locally) |
| `workers/` | Web Worker that parses files off the main thread |
| `db/` | SQL migrations (run in order), seed for local dev, SQL tests |
| `scripts/` | Migrations runner, nightly purge, demo data, index generator |
| `offline/` | Builders for the single-file offline HTML (sites, tool, admin demo) |
| `tests/` | Unit tests (`*.test.ts`) and browser end-to-end tests (`e2e/*.py`) |
| `.do/app.yaml` | DigitalOcean App Platform spec |
| `docs/` | All documentation |

## 3. Where do I change…?

| I want to… | Edit |
|---|---|
| Prices, plans, reports per plan, statements per report | `lib/pricing.ts` (and `offline/app_offline.js` → `PLANS` for the offline tool) |
| Turn payments on / paste Razorpay links | Environment: `PAYMENTS_MODE`, `PAYMENT_LINK_*` (see `docs/PAYMENTS_RAZORPAY.md`) |
| Landing page text (India / Global) | `components/landing/Landing.tsx`, sample dashboard `components/landing/Showcase.tsx` |
| Landing look | `app/landing.css` |
| Report tabs, hover cards, Progress tab | `lib/report-ui/render.js`, styles in `app/report.css` |
| Insight / leak / rule wording | `lib/engine/engine.js` (search `buildLeaks`, `buildRules`) |
| Behavioural traits (100) | `lib/engine/behaviour.js` |
| Progress score, goals, badges | `lib/engine/engine.js` → `buildProgress` |
| Broker column names / detection | `lib/engine/engine.js` → `SYN`, `matchHeader`, `inferTable` |
| PDF / Word reading | `lib/engine/extract.js` |
| Sign-in emails | `lib/mail/index.ts` |
| Roles and who sees which admin tab | `lib/admin/rbac.ts` |
| Admin metrics | `lib/admin/queries.ts` (SQL), `components/admin/AdminConsole.tsx` (UI) |
| Database tables | Add a new file in `db/migrations/` (never edit an applied migration) |

## 4. Main flows (one line each)

| Flow | Path through the code |
|---|---|
| Analyse statements | `UploadClient` → `workers/analyze.worker.ts` → `lib/engine` → preview → `POST /api/reports` (spends a credit) |
| View a report | `/report/[id]` → `ReportView` → `lib/report-ui/render.js` |
| Sign in | `/login` → `/api/auth/otp/*` or `/api/auth/google/*` → session cookie (`lib/auth/session.ts`) |
| Buy a plan | `/pricing` → `BuyButton` → `/api/payments/order` → Razorpay Checkout → `/api/payments/verify` → **webhook** `/api/payments/webhook` → `grant_plan()` |
| Admin | `/admin` → `AdminConsole` → `/api/admin/metrics?tab=` (role checked) → `lib/admin/queries.ts` |
| Nightly clean-up | DigitalOcean scheduled job → `scripts/purge.mjs` → `purge_expired_reports()` |

## 5. Every file

<!-- FILES:START -->
_Generated from file headers by `npm run docs:index` — 111 files._

### Pages

| File | What it does |
|---|---|
| `app/layout.tsx` | Root layout: fonts (Manrope + ₹ glyph), header with logo and credits, browser error reporter. |
| `app/not-found.tsx` | 404 page. |
| `components/nav/NavLinks.tsx` | Header navigation links (active-state aware). |

### Landing

| File | What it does |
|---|---|
| `app/page.tsx` | Home page route. Picks India or Global site from the visitor country (?region= overrides) and renders <Landing>. |
| `components/landing/Landing.tsx` | Landing page markup for India and Global sites (hero ledger, patterns, sample dashboard, brokers, plans, FAQ). |
| `components/landing/Showcase.tsx` | Animated 5-tab sample dashboard on the landing page (illustrative numbers, ₹ or $ by region). |

### Brand

| File | What it does |
|---|---|
| `components/brand/Logo.tsx` | Logo mark (three rising bars + growth arrow) and wordmark. Same artwork as app/icon.svg. |

### Auth

| File | What it does |
|---|---|
| `app/(auth)/login/page.tsx` | Sign-in page: Google button + email one-time code (LoginForm). New users are created on first sign-in. |
| `app/(auth)/signup/page.tsx` | Redirects /signup to /login (one page for new and returning users). |
| `app/api/auth/google/callback/route.ts` | GET — finishes Google sign-in, verifies the ID token, links by verified email, sets the session. |
| `app/api/auth/google/start/route.ts` | GET — starts Google sign-in (OIDC + PKCE + state + nonce). |
| `app/api/auth/logout/route.ts` | POST — clears the session cookie. |
| `app/api/auth/otp/request/route.ts` | POST — emails a 6-digit sign-in code (rate-limited per email and per IP). |
| `app/api/auth/otp/verify/route.ts` | POST — checks the code (5 attempts, single use), creates/loads the user, sets the session cookie. |
| `app/api/me/route.ts` | GET /api/me — current user + credits; also records daily activity for DAU/MAU. |
| `components/auth/LoginForm.tsx` | Sign-in form: Google button + email code (two steps). |
| `components/auth/LogoutButton.tsx` | Log-out button. |
| `lib/auth/file-auth-store.ts` | Auth store on a local JSON file (development only). |
| `lib/auth/google.ts` | Google OpenID Connect flow (PKCE, state, nonce, ID-token verification). |
| `lib/auth/origin.ts` | Public origin for redirects behind the load balancer (APP_URL). |
| `lib/auth/otp.ts` | Email one-time codes: generation, hashing (HMAC), checks, email normalisation. |
| `lib/auth/pg-auth-store.ts` | Auth store on PostgreSQL (users, OTP codes, audit log). |
| `lib/auth/session.ts` | Session cookie (signed JWT) read/write; dev bypass for local development only. |
| `lib/auth/store.ts` | Picks the auth store (file for local dev, Postgres in production). |
| `lib/auth/types.ts` | Auth store interface and user/OTP types. |

### Reports

| File | What it does |
|---|---|
| `app/(app)/dashboard/page.tsx` | Signed-in dashboard: list of saved reports, expiry countdown, credits. |
| `app/(app)/report/[id]/page.tsx` | One saved report: loads the report JSON (owner only) and renders ReportView; shows an expiry page when purged. |
| `app/(app)/upload/page.tsx` | Upload page wrapper: renders UploadClient (browser-side parsing and analysis). |
| `app/api/reports/[id]/route.ts` | GET one report / DELETE (soft-delete: payload nulled, row kept for billing history). |
| `app/api/reports/route.ts` | GET list / POST create report. POST validates the JSON and spends one credit atomically (create_report_with_credit). |
| `components/DeleteReportButton.tsx` | Delete-report button with confirmation. |
| `components/ReportView.tsx` | Mounts the shared report renderer (lib/report-ui/render.js) and adds CSV/PDF/delete actions. |
| `components/UploadClient.tsx` | Upload flow: pick files, parse in a Web Worker (PDFs via pdf.js), preview, save (spends a credit). |
| `lib/api/validate.ts` | Validates report JSON posted by the browser before it is stored. |
| `lib/store/file-store.ts` | Report store on a local JSON file (development only). |
| `lib/store/index.ts` | Picks the report store (file or Postgres). |
| `lib/store/pg-store.ts` | Report store on PostgreSQL (credits, reports, purge, delete). |
| `lib/store/types.ts` | Report store interface. |

### Engine

| File | What it does |
|---|---|
| `lib/engine/behaviour.js` | 100 behavioural traits (data-triggered) and per-tile "now vs ideal" hover text. |
| `lib/engine/engine.js` | Analysis engine: column detection (incl. automatic inference), trade rebuilding, clusters, leaks, rules, progress. Runs in the browser. |
| `lib/engine/extract.js` | Reads PDF (pdf.js), Word .docx/.doc and RTF into table rows for the engine. |
| `lib/engine/index.ts` | Typed entry points: run analysis, serialise the versioned report JSON. |
| `lib/engine/types.ts` | TypeScript types for raw sheets and the report JSON (version 1). |
| `workers/analyze.worker.ts` | Web Worker: parses spreadsheets/Word files and runs the engine off the main thread. |

### Report UI

| File | What it does |
|---|---|
| `lib/report-ui/loader.js` | "Analysing…" overlay shown while a report is built. |
| `lib/report-ui/render.js` | Report renderer shared by website and offline tool: Overview, Progress, Insights, Clusters, Positions + hover cards. |

### Payments

| File | What it does |
|---|---|
| `app/api/payments/config/route.ts` | GET — active payment mode and per-plan link availability for the pricing page. |
| `app/api/payments/order/route.ts` | POST { planId } — off: 503 · link: pasted Razorpay URL · razorpay: creates an Order for Checkout. |
| `app/api/payments/verify/route.ts` | POST — verifies the Checkout signature and marks the payment authorized (plan is granted by the webhook). |
| `app/api/payments/webhook/route.ts` | POST — Razorpay webhook. Verifies signature; payment.captured/order.paid grant the plan (idempotent). |
| `app/pricing/page.tsx` | Pricing page: 4 plans priced by country, each with a BuyButton (off / link / razorpay modes). |
| `components/payments/BuyButton.tsx` | Buy button for every payment mode: opening soon / Razorpay link / Razorpay Checkout. |
| `lib/payments/config.ts` | PAYMENTS_MODE switch (off \| link \| razorpay) and pasted Razorpay links. |
| `lib/payments/razorpay.ts` | Razorpay Orders API, Checkout signature and webhook signature verification (no SDK). |
| `lib/pricing.ts` | Plans and prices (single source of truth): reports, statements per report, validity, ₹/$ by country. |

### Admin

| File | What it does |
|---|---|
| `app/admin/page.tsx` | Admin console route (/admin). Staff only; role read from the database; renders AdminConsole with the role's tabs. |
| `app/api/admin/metrics/route.ts` | GET ?tab=users\|finance\|errors\|support\|product — metrics for one admin tab (permission checked per tab). |
| `app/api/admin/roles/route.ts` | POST — assign a role (owners: any; admins: not owner; nobody changes their own). |
| `app/api/admin/tickets/route.ts` | PATCH — update a support ticket status/notes. |
| `app/api/admin/user/route.ts` | GET ?email= — support lookup: profile, likely cause and full timeline for one user. |
| `app/api/errors/route.ts` | POST — browser errors for the admin error center. |
| `app/api/events/route.ts` | POST — allow-listed product events from the browser (upload failures, tab views…). |
| `components/admin/AdminConsole.tsx` | Admin console UI: Users, Finance, Errors, Support, Product tabs (shown per role). |
| `components/ErrorReporter.tsx` | Sends browser errors to /api/errors (max 5 per page load). |
| `lib/admin/queries.ts` | SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product). |
| `lib/admin/rbac.ts` | Roles and permissions (owner, admin, support, finance, analyst) and the requirePerm() guard. |
| `lib/admin/telemetry.ts` | Product events and error capture (best-effort; never breaks a request). |

### Core

| File | What it does |
|---|---|
| `lib/api/http.ts` | API helpers: json(), fail(), requireUser(). |
| `lib/auth/country.ts` | Visitor country for server components (Cloudflare CF-IPCountry / CloudFront / X-Country). |
| `lib/auth/request.ts` | Client IP and country for API routes. |
| `lib/config.ts` | App-wide limits (max files, file types, report lifetime). |
| `lib/db.ts` | PostgreSQL connection pool with SSL + CA certificate support (DigitalOcean / RDS). |
| `lib/mail/index.ts` | Email sender: Resend (DigitalOcean), Amazon SES, or a local log file. |

### Styles

| File | What it does |
|---|---|
| `app/globals.css` | Base app styles: colours, header, panels, buttons, forms, print rules. |
| `app/landing.css` | Landing page styles: one system of centred titles, equal cards, sample dashboard, plans. |
| `app/report.css` | Report, Progress tab, analysing loader and admin console styles (shared by website and offline tool). |

### Database

| File | What it does |
|---|---|
| `db/migrations/0001_schema.sql` | Core tables: users, otp_codes, payments, credits, reports, audit_log. |
| `db/migrations/0002_app_role.sql` | Least-privilege lens_app role (no DELETE, no DDL). |
| `db/migrations/0003_functions.sql` | create_report_with_credit(), purge_expired_reports(), delete_report(). |
| `db/migrations/0004_auth.sql` | Email + Google sign-in columns; credits row created for every new user. |
| `db/migrations/0005_admin.sql` | Roles, events, error_events, support_tickets, costs (admin console). |
| `db/migrations/0006_admin_read_audit.sql` | Lets the app read the audit log for the support timeline. |
| `db/migrations/0007_payments_plans.sql` | subscriptions table and grant_plan() used by the Razorpay webhook. |
| `db/optional/pg_cron.sql` | Optional: schedule the purge inside Postgres if pg_cron is available. |
| `db/seed.sql` | Local development seed (dev user with credits). Never run in production. |

### Ops

| File | What it does |
|---|---|
| `app/api/cron/purge/route.ts` | POST /api/cron/purge — optional HTTP trigger for the nightly purge (needs CRON_SECRET). The scheduled job uses scripts/purge.mjs. |
| `app/api/health/route.ts` | GET /api/health — liveness check used by DigitalOcean App Platform. |
| `scripts/copy-pdf-worker.mjs` | postinstall: copies the pdf.js worker into public/. |
| `scripts/gen-index.mjs` | Regenerates the file table in docs/INDEX.md from the @file/@area/@what headers. Run: npm run docs:index |
| `scripts/migrate.mjs` | Applies db/migrations in order (runs as the pre-deploy job). |
| `scripts/purge.mjs` | Nightly purge of expired reports (DigitalOcean scheduled job). |
| `scripts/seed-admin-demo.mjs` | Fills a local database with demo admin data (refuses production). |

### Offline

| File | What it does |
|---|---|
| `offline/admin_console.js` | Standalone admin dashboard renderer with a "view as role" switcher. |
| `offline/app_offline.css` | Offline tool styles (workspace, plan card, history, upload notices). |
| `offline/app_offline.js` | Offline tool logic: plans, report library (IndexedDB), month-grouped history with rename, workspace. |
| `offline/build_admin.py` | Builds the standalone admin dashboard HTML from the demo database. |
| `offline/build_offline.py` | Builds the single-file offline sites/tool from a running server (--country, --other, --tool). |

### Tests

| File | What it does |
|---|---|
| `db/tests/01_functions.sql` | SQL tests for the database functions and the app role restrictions. |
| `tests/behaviour.test.ts` | 100-trait library: uniqueness, wording, variety. |
| `tests/e2e/admin.py` | Browser E2E: admin console across all five roles. |
| `tests/e2e/auth.py` | Browser E2E: email code + Google sign-in (with mock provider). |
| `tests/e2e/flow.py` | Browser E2E: upload → report → dashboard → credits → delete → expiry. |
| `tests/e2e/mock-google.mjs` | Mock Google OpenID provider used by the sign-in E2E. |
| `tests/e2e/payments.py` | Payments E2E: off / link modes and the signed webhook path. |
| `tests/e2e/v2.py` | Browser E2E: report tabs, hover cards, behaviour, clusters, PDF/Word uploads. |
| `tests/engine.test.ts` | Engine: formats, accounting, symbols, auto-detection, combining files, progress. |
| `tests/extract.test.ts` | PDF, DOCX and legacy DOC reading matches the CSV originals. |
| `tests/otp.test.ts` | Email one-time code helpers. |
| `tests/payments.test.ts` | Razorpay checkout and webhook signature verification. |
| `tests/pg-store.test.ts` | PostgreSQL store integration (needs TEST_DATABASE_URL). |
| `tests/rbac.test.ts` | Role permissions and error fingerprinting. |

<!-- FILES:END -->
