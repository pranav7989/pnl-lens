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
| 8 | `docs/BACKEND_V2_PLAN.md` | Plan for moving parsing/analysis to the server (backend-v2, approved; phase status inside) |
| 9 | `docs/INFRA.md` | Docker Compose stack: services, networks, least privilege, secrets, commands |

## 2. Folder map

npm workspaces monorepo (backend-v2). Run every command from the repo root.

| Folder | Contains |
|---|---|
| `apps/web/` | The Next.js app (unchanged behaviour; the engine still runs in the browser until Phase 6) |
| `apps/web/app/` | Next.js routes: pages (`page.tsx`) and API endpoints (`api/**/route.ts`), global CSS, `icon.svg` |
| `apps/web/components/` | React components: landing, upload, report view, admin console, auth, payments |
| `apps/web/lib/report-ui/` | Report renderer + "analysing" loader (shared by website and offline tool) |
| `apps/web/lib/auth/` | Sessions, email codes, Google sign-in, country detection |
| `apps/web/lib/payments/` | Payment mode switch and Razorpay provider |
| `apps/web/lib/admin/` | Roles/permissions, telemetry, admin SQL |
| `apps/web/lib/store/` | Report storage (Postgres in production, JSON file locally) |
| `apps/web/workers/` | Web Worker that parses files off the main thread |
| `apps/web/offline/` | Builders for the single-file offline HTML (sites, tool, admin demo) |
| `apps/web/tests/` | Web unit tests (sign-in codes, payments, roles, Postgres store) |
| `packages/engine/` | The analysis engine, **moved unchanged** (`src/`), its Node runner (`src/node.ts`), tests, fixtures and **golden parity files** (`test/golden/`) |
| `packages/shared/` | Plans and prices (`src/pricing.ts`), app limits (`src/limits.ts`) |
| `apps/api/` | Fastify API (`/api/v1`). Phase 2 skeleton: health + readiness only |
| `apps/worker/` | Job worker (BullMQ from Phase 5). Phase 2 skeleton: dependency checks only |
| `packages/db/` | SQL migrations (run in order), seed for local dev, SQL tests, migrate / role-setup / purge / demo-data scripts |
| `infra/` | Docker Compose stack (`compose.dev.yml`), Dockerfiles (`docker/`), `caddy/Caddyfile`, `garage/garage.toml`, setup scripts (`scripts/`) — see `docs/INFRA.md` |
| `scripts/` | Index generator |
| `tests/e2e/` | Browser end-to-end tests (`*.py`) for the whole system |
| `tests/stack/` | Stack tests against the running Docker stack (`npm run test:stack`) |
| `.do/app.yaml` | DigitalOcean App Platform spec (stale; retired in backend-v2 Phase 8) |
| `docs/` | All documentation |

## 3. Where do I change…?

| I want to… | Edit |
|---|---|
| Prices, plans, reports per plan, statements per report | `packages/shared/src/pricing.ts` (and `apps/web/offline/app_offline.js` → `PLANS` for the offline tool) |
| Turn payments on / paste Razorpay links | Environment: `PAYMENTS_MODE`, `PAYMENT_LINK_*` (see `docs/PAYMENTS_RAZORPAY.md`; link mode is removed in backend-v2) |
| Landing page text (India / Global) | `apps/web/components/landing/Landing.tsx`, sample dashboard `apps/web/components/landing/Showcase.tsx` |
| Landing look | `apps/web/app/landing.css` |
| Report tabs, hover cards, Progress tab | `apps/web/lib/report-ui/render.js`, styles in `apps/web/app/report.css` |
| Insight / leak / rule wording ⚠ engine | `packages/engine/src/engine.js` (search `buildLeaks`, `buildRules`) — any engine edit changes the goldens; see `docs/TESTING.md` |
| Behavioural traits (100) ⚠ engine | `packages/engine/src/behaviour.js` |
| Progress score, goals, badges ⚠ engine | `packages/engine/src/engine.js` → `buildProgress` |
| Broker column names / detection ⚠ engine | `packages/engine/src/engine.js` → `SYN`, `matchHeader`, `inferTable` |
| PDF / Word reading ⚠ engine | `packages/engine/src/extract.js` |
| Sign-in emails | `apps/web/lib/mail/index.ts` |
| Roles and who sees which admin tab | `apps/web/lib/admin/rbac.ts` |
| Admin metrics | `apps/web/lib/admin/queries.ts` (SQL), `apps/web/components/admin/AdminConsole.tsx` (UI) |
| Database tables | Add a new file in `packages/db/migrations/` (never edit 0001–0007 or any applied migration) |

## 4. Main flows (one line each)

| Flow | Path through the code |
|---|---|
| Analyse statements | `UploadClient` → `workers/analyze.worker.ts` → `lib/engine` → preview → `POST /api/reports` (spends a credit) |
| View a report | `/report/[id]` → `ReportView` → `lib/report-ui/render.js` |
| Sign in | `/login` → `/api/auth/otp/*` or `/api/auth/google/*` → session cookie (`lib/auth/session.ts`) |
| Buy a plan | `/pricing` → `BuyButton` → `/api/payments/order` → Razorpay Checkout → `/api/payments/verify` → **webhook** `/api/payments/webhook` → `grant_plan()` |
| Admin | `/admin` → `AdminConsole` → `/api/admin/metrics?tab=` (role checked) → `lib/admin/queries.ts` |
| Nightly clean-up | DigitalOcean scheduled job → `packages/db/scripts/purge.mjs` → `purge_expired_reports()` |

## 5. Every file

<!-- FILES:START -->
_Generated from file headers by `npm run docs:index` — 120 files._

### Pages

| File | What it does |
|---|---|
| `apps/web/app/layout.tsx` | Root layout: fonts (Manrope + ₹ glyph), header with logo and credits, browser error reporter. |
| `apps/web/app/not-found.tsx` | 404 page. |
| `apps/web/components/nav/NavLinks.tsx` | Header navigation links (active-state aware). |

### Landing

| File | What it does |
|---|---|
| `apps/web/app/page.tsx` | Home page route. Picks India or Global site from the visitor country (?region= overrides) and renders <Landing>. |
| `apps/web/components/landing/Landing.tsx` | Landing page markup for India and Global sites (hero ledger, patterns, sample dashboard, brokers, plans, FAQ). |
| `apps/web/components/landing/Showcase.tsx` | Animated 5-tab sample dashboard on the landing page (illustrative numbers, ₹ or $ by region). |

### Brand

| File | What it does |
|---|---|
| `apps/web/components/brand/Logo.tsx` | Logo mark (three rising bars + growth arrow) and wordmark. Same artwork as app/icon.svg. |

### Auth

| File | What it does |
|---|---|
| `apps/web/app/(auth)/login/page.tsx` | Sign-in page: Google button + email one-time code (LoginForm). New users are created on first sign-in. |
| `apps/web/app/(auth)/signup/page.tsx` | Redirects /signup to /login (one page for new and returning users). |
| `apps/web/app/api/auth/google/callback/route.ts` | GET — finishes Google sign-in, verifies the ID token, links by verified email, sets the session. |
| `apps/web/app/api/auth/google/start/route.ts` | GET — starts Google sign-in (OIDC + PKCE + state + nonce). |
| `apps/web/app/api/auth/logout/route.ts` | POST — clears the session cookie. |
| `apps/web/app/api/auth/otp/request/route.ts` | POST — emails a 6-digit sign-in code (rate-limited per email and per IP). |
| `apps/web/app/api/auth/otp/verify/route.ts` | POST — checks the code (5 attempts, single use), creates/loads the user, sets the session cookie. |
| `apps/web/app/api/me/route.ts` | GET /api/me — current user + credits; also records daily activity for DAU/MAU. |
| `apps/web/components/auth/LoginForm.tsx` | Sign-in form: Google button + email code (two steps). |
| `apps/web/components/auth/LogoutButton.tsx` | Log-out button. |
| `apps/web/lib/auth/file-auth-store.ts` | Auth store on a local JSON file (development only). |
| `apps/web/lib/auth/google.ts` | Google OpenID Connect flow (PKCE, state, nonce, ID-token verification). |
| `apps/web/lib/auth/origin.ts` | Public origin for redirects behind the load balancer (APP_URL). |
| `apps/web/lib/auth/otp.ts` | Email one-time codes: generation, hashing (HMAC), checks, email normalisation. |
| `apps/web/lib/auth/pg-auth-store.ts` | Auth store on PostgreSQL (users, OTP codes, audit log). |
| `apps/web/lib/auth/session.ts` | Session cookie (signed JWT) read/write; dev bypass for local development only. |
| `apps/web/lib/auth/store.ts` | Picks the auth store (file for local dev, Postgres in production). |
| `apps/web/lib/auth/types.ts` | Auth store interface and user/OTP types. |

### Reports

| File | What it does |
|---|---|
| `apps/web/app/(app)/dashboard/page.tsx` | Signed-in dashboard: list of saved reports, expiry countdown, credits. |
| `apps/web/app/(app)/report/[id]/page.tsx` | One saved report: loads the report JSON (owner only) and renders ReportView; shows an expiry page when purged. |
| `apps/web/app/(app)/upload/page.tsx` | Upload page wrapper: renders UploadClient (browser-side parsing and analysis). |
| `apps/web/app/api/reports/[id]/route.ts` | GET one report / DELETE (soft-delete: payload nulled, row kept for billing history). |
| `apps/web/app/api/reports/route.ts` | GET list / POST create report. POST validates the JSON and spends one credit atomically (create_report_with_credit). |
| `apps/web/components/DeleteReportButton.tsx` | Delete-report button with confirmation. |
| `apps/web/components/ReportView.tsx` | Mounts the shared report renderer (lib/report-ui/render.js) and adds CSV/PDF/delete actions. |
| `apps/web/components/UploadClient.tsx` | Upload flow: pick files, parse in a Web Worker (PDFs via pdf.js), preview, save (spends a credit). |
| `apps/web/lib/api/validate.ts` | Validates report JSON posted by the browser before it is stored. |
| `apps/web/lib/store/file-store.ts` | Report store on a local JSON file (development only). |
| `apps/web/lib/store/index.ts` | Picks the report store (file or Postgres). |
| `apps/web/lib/store/pg-store.ts` | Report store on PostgreSQL (credits, reports, purge, delete). |
| `apps/web/lib/store/types.ts` | Report store interface. |

### Engine

| File | What it does |
|---|---|
| `apps/web/workers/analyze.worker.ts` | Web Worker: parses spreadsheets/Word files and runs the engine off the main thread. |
| `packages/engine/src/behaviour.js` | 100 behavioural traits (data-triggered) and per-tile "now vs ideal" hover text. |
| `packages/engine/src/engine.js` | Analysis engine: column detection (incl. automatic inference), trade rebuilding, clusters, leaks, rules, progress. Runs in the browser. |
| `packages/engine/src/extract.js` | Reads PDF (pdf.js), Word .docx/.doc and RTF into table rows for the engine. |
| `packages/engine/src/index.ts` | Typed entry points: run analysis, serialise the versioned report JSON. |
| `packages/engine/src/node.ts` | Node runner: reads files exactly like the browser worker did (fileToRawSheets per file), then analyzeRaw. |
| `packages/engine/src/types.ts` | TypeScript types for raw sheets and the report JSON (version 1). |

### Report UI

| File | What it does |
|---|---|
| `apps/web/lib/report-ui/loader.js` | "Analysing…" overlay shown while a report is built. |
| `apps/web/lib/report-ui/render.js` | Report renderer shared by website and offline tool: Overview, Progress, Insights, Clusters, Positions + hover cards. |

### Payments

| File | What it does |
|---|---|
| `apps/web/app/api/payments/config/route.ts` | GET — active payment mode and per-plan link availability for the pricing page. |
| `apps/web/app/api/payments/order/route.ts` | POST { planId } — off: 503 · link: pasted Razorpay URL · razorpay: creates an Order for Checkout. |
| `apps/web/app/api/payments/verify/route.ts` | POST — verifies the Checkout signature and marks the payment authorized (plan is granted by the webhook). |
| `apps/web/app/api/payments/webhook/route.ts` | POST — Razorpay webhook. Verifies signature; payment.captured/order.paid grant the plan (idempotent). |
| `apps/web/app/pricing/page.tsx` | Pricing page: 4 plans priced by country, each with a BuyButton (off / link / razorpay modes). |
| `apps/web/components/payments/BuyButton.tsx` | Buy button for every payment mode: opening soon / Razorpay link / Razorpay Checkout. |
| `apps/web/lib/payments/config.ts` | PAYMENTS_MODE switch (off \| link \| razorpay) and pasted Razorpay links. |
| `apps/web/lib/payments/razorpay.ts` | Razorpay Orders API, Checkout signature and webhook signature verification (no SDK). |
| `packages/shared/src/pricing.ts` | Plans and prices (single source of truth): reports, statements per report, validity, ₹/$ by country. |

### Admin

| File | What it does |
|---|---|
| `apps/web/app/admin/page.tsx` | Admin console route (/admin). Staff only; role read from the database; renders AdminConsole with the role's tabs. |
| `apps/web/app/api/admin/metrics/route.ts` | GET ?tab=users\|finance\|errors\|support\|product — metrics for one admin tab (permission checked per tab). |
| `apps/web/app/api/admin/roles/route.ts` | POST — assign a role (owners: any; admins: not owner; nobody changes their own). |
| `apps/web/app/api/admin/tickets/route.ts` | PATCH — update a support ticket status/notes. |
| `apps/web/app/api/admin/user/route.ts` | GET ?email= — support lookup: profile, likely cause and full timeline for one user. |
| `apps/web/app/api/errors/route.ts` | POST — browser errors for the admin error center. |
| `apps/web/app/api/events/route.ts` | POST — allow-listed product events from the browser (upload failures, tab views…). |
| `apps/web/components/admin/AdminConsole.tsx` | Admin console UI: Users, Finance, Errors, Support, Product tabs (shown per role). |
| `apps/web/components/ErrorReporter.tsx` | Sends browser errors to /api/errors (max 5 per page load). |
| `apps/web/lib/admin/queries.ts` | SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product). |
| `apps/web/lib/admin/rbac.ts` | Roles and permissions (owner, admin, support, finance, analyst) and the requirePerm() guard. |
| `apps/web/lib/admin/telemetry.ts` | Product events and error capture (best-effort; never breaks a request). |

### Core

| File | What it does |
|---|---|
| `apps/web/lib/api/http.ts` | API helpers: json(), fail(), requireUser(). |
| `apps/web/lib/auth/country.ts` | Visitor country for server components (Cloudflare CF-IPCountry / CloudFront / X-Country). |
| `apps/web/lib/auth/request.ts` | Client IP and country for API routes. |
| `apps/web/lib/db.ts` | PostgreSQL connection pool with SSL + CA certificate support (DigitalOcean / RDS). |
| `apps/web/lib/mail/index.ts` | Email sender: Resend (DigitalOcean), Amazon SES, or a local log file. |
| `packages/shared/src/limits.ts` | App-wide limits (max files, file types, report lifetime). |

### Styles

| File | What it does |
|---|---|
| `apps/web/app/globals.css` | Base app styles: colours, header, panels, buttons, forms, print rules. |
| `apps/web/app/landing.css` | Landing page styles: one system of centred titles, equal cards, sample dashboard, plans. |
| `apps/web/app/report.css` | Report, Progress tab, analysing loader and admin console styles (shared by website and offline tool). |

### Database

| File | What it does |
|---|---|
| `packages/db/migrations/0001_schema.sql` | Core tables: users, otp_codes, payments, credits, reports, audit_log. |
| `packages/db/migrations/0002_app_role.sql` | Least-privilege lens_app role (no DELETE, no DDL). |
| `packages/db/migrations/0003_functions.sql` | create_report_with_credit(), purge_expired_reports(), delete_report(). |
| `packages/db/migrations/0004_auth.sql` | Email + Google sign-in columns; credits row created for every new user. |
| `packages/db/migrations/0005_admin.sql` | Roles, events, error_events, support_tickets, costs (admin console). |
| `packages/db/migrations/0006_admin_read_audit.sql` | Lets the app read the audit log for the support timeline. |
| `packages/db/migrations/0007_payments_plans.sql` | subscriptions table and grant_plan() used by the Razorpay webhook. |
| `packages/db/optional/pg_cron.sql` | Optional: schedule the purge inside Postgres if pg_cron is available. |
| `packages/db/scripts/seed-dev.mjs` | Applies seed.sql (dev user with credits) — only when SEED_DEV_DATA=true (set by infra/compose.dev.yml only). |
| `packages/db/scripts/setup-roles.mjs` | Creates/updates the login roles lens_app and lens_worker with passwords from env (runs after migrations, as superuser). |
| `packages/db/seed.sql` | Local development seed (dev user with credits). Never run in production. |

### Ops

| File | What it does |
|---|---|
| `apps/web/app/api/cron/purge/route.ts` | POST /api/cron/purge — optional HTTP trigger for the nightly purge (needs CRON_SECRET). The scheduled job uses scripts/purge.mjs. |
| `apps/web/app/api/health/route.ts` | GET /api/health — liveness check used by DigitalOcean App Platform. |
| `apps/web/scripts/copy-pdf-worker.mjs` | postinstall: copies the pdf.js worker into public/. |
| `infra/scripts/gen-env.mjs` | Fills .env with random secrets for every stack variable that is missing. Never changes or prints existing values. |
| `infra/scripts/storage-init.mjs` | One-off, idempotent Garage setup via its admin API: node layout, private bucket, and least-privilege S3 keys. |
| `packages/db/scripts/migrate.mjs` | Applies packages/db/migrations in order (runs as the pre-deploy job). |
| `packages/db/scripts/purge.mjs` | Nightly purge of expired reports (DigitalOcean scheduled job). |
| `packages/db/scripts/seed-admin-demo.mjs` | Fills a local database with demo admin data (refuses production). |
| `scripts/gen-index.mjs` | Regenerates the file table in docs/INDEX.md from the @file/@area/@what headers. Run: npm run docs:index |

### Offline

| File | What it does |
|---|---|
| `apps/web/offline/admin_console.js` | Standalone admin dashboard renderer with a "view as role" switcher. |
| `apps/web/offline/app_offline.css` | Offline tool styles (workspace, plan card, history, upload notices). |
| `apps/web/offline/app_offline.js` | Offline tool logic: plans, report library (IndexedDB), month-grouped history with rename, workspace. |
| `apps/web/offline/build_admin.py` | Builds the standalone admin dashboard HTML from the demo database. |
| `apps/web/offline/build_offline.py` | Builds the single-file offline sites/tool from a running server (--country, --other, --tool). |

### Tests

| File | What it does |
|---|---|
| `apps/web/tests/otp.test.ts` | Email one-time code helpers. |
| `apps/web/tests/payments.test.ts` | Razorpay checkout and webhook signature verification. |
| `apps/web/tests/pg-store.test.ts` | PostgreSQL store integration (needs TEST_DATABASE_URL). |
| `apps/web/tests/rbac.test.ts` | Role permissions and error fingerprinting. |
| `packages/db/tests/01_functions.sql` | SQL tests for the database functions and the app role restrictions. |
| `packages/engine/test/behaviour.test.ts` | 100-trait library: uniqueness, wording, variety. |
| `packages/engine/test/engine.test.ts` | Engine: formats, accounting, symbols, auto-detection, combining files, progress. |
| `packages/engine/test/extract.test.ts` | PDF, DOCX and legacy DOC reading matches the CSV originals. |
| `packages/engine/test/golden.test.ts` | Engine parity: every fixture through the Node runner must equal the stored golden JSON byte for byte. |
| `tests/e2e/admin.py` | Browser E2E: admin console across all five roles. |
| `tests/e2e/auth.py` | Browser E2E: email code + Google sign-in (with mock provider). |
| `tests/e2e/flow.py` | Browser E2E: upload → report → dashboard → credits → delete → expiry. |
| `tests/e2e/mock-google.mjs` | Mock Google OpenID provider used by the sign-in E2E. |
| `tests/e2e/payments.py` | Payments E2E: off / link modes and the signed webhook path. |
| `tests/e2e/v2.py` | Browser E2E: report tabs, hover cards, behaviour, clusters, PDF/Word uploads. |
| `tests/stack/stack.test.ts` | Dev stack checks: all services healthy, only Caddy published, internal network isolated, least-privilege DB/Redis/storage. |

<!-- FILES:END -->
