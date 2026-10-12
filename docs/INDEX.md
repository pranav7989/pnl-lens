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
| 10 | `docs/API.md` | The API (`/api/v1`): conventions, every endpoint, upload fields, code map |
| 11 | `docs/WORKER.md` | The worker: one job step by step, failure rules, schedules, settings |
| 12 | `docs/legal/` | **Drafts, not in force:** Privacy Policy and Terms of Service for backend-v2, with LAWYER CHECK / BUILD CHECK markers |

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
| `packages/shared/` | Plans and prices, limits, auth (codes, Google, sessions), payments, RBAC rules, telemetry, mail, consent text, file encryption, job names — used by web and api |
| `apps/api/` | Fastify API (`/api/v1`): sign-in, uploads, reports, plans, payments, admin, privacy. See `docs/API.md` and `apps/api/openapi.json` |
| `apps/worker/` | Job worker (BullMQ): decrypt, engine in an isolated child process, store; nightly purge and storage sweep. See `docs/WORKER.md` |
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
_Generated from file headers by `npm run docs:index` — 200 files._

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
| `apps/api/src/routes/auth.ts` | Sign-in, ported 1:1 from apps/web/app/api/auth/*: email code request/verify, Google start/callback, logout. |
| `apps/api/src/routes/me.ts` | GET /me (ported), GET /plans, consents (GET/POST /me/consents), POST /me/export, POST /me/delete and DELETE /me. |
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
| `apps/web/lib/auth/google.ts` | Re-export of @pnl-lens/shared/auth/google (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `apps/web/lib/auth/origin.ts` | Re-export of @pnl-lens/shared/auth/origin (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `apps/web/lib/auth/otp.ts` | Re-export of @pnl-lens/shared/auth/otp (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `apps/web/lib/auth/pg-auth-store.ts` | Auth store on PostgreSQL: the shared PgAuthStore bound to the web app's pool. |
| `apps/web/lib/auth/session.ts` | Session cookie (signed JWT) read/write for Next route handlers; token logic lives in packages/shared/src/auth/session.ts. |
| `apps/web/lib/auth/store.ts` | Picks the auth store (file for local dev, Postgres in production). |
| `apps/web/lib/auth/types.ts` | Re-export of @pnl-lens/shared/auth/types (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `packages/shared/src/auth/google.ts` | Google OpenID Connect flow (PKCE, state, nonce, ID-token verification). |
| `packages/shared/src/auth/origin.ts` | Public origin for redirects behind the load balancer (APP_URL). |
| `packages/shared/src/auth/otp.ts` | Email one-time codes: generation, hashing (HMAC), checks, email normalisation. |
| `packages/shared/src/auth/pg-auth-store.ts` | Auth store on PostgreSQL (users, OTP codes, audit log); the connection is passed in (web pool or API pool). |
| `packages/shared/src/auth/session.ts` | Session token (signed JWT in the lens_session cookie): create, verify, cookie options, dev bypass. Used by apps/web and apps/api. |
| `packages/shared/src/auth/types.ts` | Auth store interface and user/OTP types. |

### Reports

| File | What it does |
|---|---|
| `apps/api/src/routes/analyses.ts` | POST /analyses (alias /uploads): consent, type sniffing, size/plan/D11 limits, encrypt, store, queue. GET /analyses/:id and /reports/:id/status. |
| `apps/api/src/routes/reports.ts` | Reports: list (MON-YY history), save an analysis (spends one report from a valid plan), "+" add files (file-set lock), get, rename, delete. |
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
| `apps/api/src/routes/payments.ts` | Payments ported from apps/web/app/api/payments/*: config, order, verify, and the Razorpay webhook (the ONLY place a plan is granted). |
| `apps/web/app/api/payments/config/route.ts` | GET — active payment mode and per-plan link availability for the pricing page. |
| `apps/web/app/api/payments/order/route.ts` | POST { planId } — off: 503 · link: pasted Razorpay URL · razorpay: creates an Order for Checkout. |
| `apps/web/app/api/payments/verify/route.ts` | POST — verifies the Checkout signature and marks the payment authorized (plan is granted by the webhook). |
| `apps/web/app/api/payments/webhook/route.ts` | POST — Razorpay webhook. Verifies signature; payment.captured/order.paid grant the plan (idempotent). |
| `apps/web/app/pricing/page.tsx` | Pricing page: 4 plans priced by country, each with a BuyButton (off / link / razorpay modes). |
| `apps/web/components/payments/BuyButton.tsx` | Buy button for every payment mode: opening soon / Razorpay link / Razorpay Checkout. |
| `apps/web/lib/payments/config.ts` | PAYMENTS_MODE switch (off \| link \| razorpay) and pasted Razorpay links. |
| `apps/web/lib/payments/razorpay.ts` | Re-export of @pnl-lens/shared/payments/razorpay (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `packages/shared/src/payments/config.ts` | PAYMENTS_MODE for backend v2 (off \| razorpay; link mode removed, plan D5) and the Razorpay keys. |
| `packages/shared/src/payments/razorpay.ts` | Razorpay Orders API, Checkout signature and webhook signature verification (no SDK). |
| `packages/shared/src/pricing.ts` | Plans and prices (single source of truth): reports, statements per report, validity, ₹/$ by country. |

### Admin

| File | What it does |
|---|---|
| `apps/api/src/routes/admin.ts` | Admin console API ported from apps/web/app/api/admin/* (role read from the DB each request, every read audited) plus the owner-only manual plan grant (D5). |
| `apps/api/src/routes/telemetry.ts` | POST /events (allow-listed product events) and POST /errors (browser errors), ported from apps/web; always 204. |
| `apps/web/app/admin/page.tsx` | Admin console route (/admin). Staff only; role read from the database; renders AdminConsole with the role's tabs. |
| `apps/web/app/api/admin/metrics/route.ts` | GET ?tab=users\|finance\|errors\|support\|product — metrics for one admin tab (permission checked per tab). |
| `apps/web/app/api/admin/roles/route.ts` | POST — assign a role (owners: any; admins: not owner; nobody changes their own). |
| `apps/web/app/api/admin/tickets/route.ts` | PATCH — update a support ticket status/notes. |
| `apps/web/app/api/admin/user/route.ts` | GET ?email= — support lookup: profile, likely cause and full timeline for one user. |
| `apps/web/app/api/errors/route.ts` | POST — browser errors for the admin error center. |
| `apps/web/app/api/events/route.ts` | POST — allow-listed product events from the browser (upload failures, tab views…). |
| `apps/web/components/admin/AdminConsole.tsx` | Admin console UI: Users, Finance, Errors, Support, Product tabs (shown per role). |
| `apps/web/components/ErrorReporter.tsx` | Sends browser errors to /api/errors (max 5 per page load). |
| `apps/web/lib/admin/queries.ts` | SQL behind each admin tab, from packages/shared/src/admin/queries.ts, bound to the web app's pool. |
| `apps/web/lib/admin/rbac.ts` | requirePerm() guard for web admin routes; the roles and permissions live in packages/shared/src/admin/rbac.ts. |
| `apps/web/lib/admin/telemetry.ts` | Product events and error capture (best-effort; never breaks a request), bound to the web app's pool. |
| `packages/shared/src/admin/queries.ts` | SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product). |
| `packages/shared/src/admin/rbac.ts` | Roles and permissions (owner, admin, support, finance, analyst): the rules only. The guards live in apps/web and apps/api. |
| `packages/shared/src/admin/telemetry.ts` | Product events and error capture over an injected connection (best-effort; never breaks a request). |

### API

| File | What it does |
|---|---|
| `apps/api/src/app.ts` | Builds the Fastify app (/api/v1): cookies, multipart limits, rate limits, CSRF origin check, zod validation, OpenAPI, every route. |
| `apps/api/src/config.ts` | API configuration from env, checked once at startup (fails fast on missing secrets). |
| `apps/api/src/lib/http.ts` | Response helpers with the same JSON shapes as the old Next routes ({ error, message }), session lookup, request adapters. |
| `apps/api/src/lib/queue.ts` | Enqueues analysis jobs on BullMQ (Redis) for apps/worker; job id = analysis id, so a repeat is a no-op. |
| `apps/api/src/lib/sniff.ts` | Upload type check: the real file type from its bytes (the engine's own detectKind) plus a reject list for non-statements. |
| `apps/api/src/lib/storage.ts` | Object storage for encrypted statement files (S3 API on Garage). The api's key is write-only by design. |
| `apps/api/src/main.ts` | API process entry: config, Postgres (lens_app only), Redis, storage, queue; listens on PORT; graceful shutdown. |
| `apps/api/src/routes/health.ts` | GET /health (liveness) and GET /ready (Postgres as lens_app, Redis, storage). |

### Worker

| File | What it does |
|---|---|
| `apps/worker/src/config.ts` | Worker configuration from env: lens_worker DB URL, Redis, storage (read + delete), file keys, engine limits. |
| `apps/worker/src/engine-child.ts` | Child process that runs the engine on one job's decrypted files (memory-capped, killed on timeout); returns the report, per-file fingerprints, fills and parse info. |
| `apps/worker/src/engine-runner.ts` | Starts engine-child.js per job with a memory cap and a timeout; a hung or crashing parse fails that file, not the worker (plan D10). |
| `apps/worker/src/engine-version.ts` | engine_version written on every derived row: a hash of the engine's source files and package.json (fixed at build time in the image). |
| `apps/worker/src/main.ts` | Worker process: BullMQ consumer for analysis jobs (retries, dead-letter on final failure), schedules for nightly purge and storage sweep, local health endpoint. |
| `apps/worker/src/maintenance.ts` | Scheduled jobs: nightly purge (raw files after 30 days, unsaved drafts after 24 h, old sign-in codes) and the storage sweep that deletes shredded objects. |
| `apps/worker/src/pipeline.ts` | One analysis job: fetch + decrypt files (logged) → engine in a child process → store payload, trades, fills, metrics, traits, parse runs in one transaction. |
| `apps/worker/src/queue-worker.ts` | BullMQ consumer for analysis jobs: runs the pipeline, retries infrastructure errors, and on the final failure marks the analysis failed (dead letter). |
| `apps/worker/src/storage.ts` | Object storage for the worker (S3 API on Garage): read encrypted files, delete shredded ones. In-memory version for tests. |

### Core

| File | What it does |
|---|---|
| `apps/web/lib/api/http.ts` | API helpers: json(), fail(), requireUser(). |
| `apps/web/lib/auth/country.ts` | Visitor country for server components (Cloudflare CF-IPCountry / CloudFront / X-Country). |
| `apps/web/lib/auth/request.ts` | Re-export of @pnl-lens/shared/auth/request (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `apps/web/lib/db.ts` | PostgreSQL connection pool with SSL + CA certificate support (DigitalOcean / RDS). |
| `apps/web/lib/mail/index.ts` | Re-export of @pnl-lens/shared/mail (moved to packages/shared in backend-v2 Phase 4 so apps/api uses the same code). |
| `packages/shared/src/auth/request.ts` | Client IP and country for API routes. |
| `packages/shared/src/consent.ts` | Upload consent wording (plan D2, W9/W10) and its version; the hash of the exact text is stored with each consent row. |
| `packages/shared/src/db.ts` | Minimal query interface (pg.Pool / pg.Client satisfy it) so shared SQL helpers work with the web pool and the API pool. |
| `packages/shared/src/file-crypto.ts` | Envelope encryption for raw statement files: AES-256-GCM with a random key per file, wrapped by a KEK from env (rule 7). |
| `packages/shared/src/jobs.ts` | Queue names and job payloads shared by apps/api (producer) and apps/worker (consumer). |
| `packages/shared/src/limits.ts` | App-wide limits (max files, file types, report lifetime). |
| `packages/shared/src/mail.ts` | Email sender: Resend (DigitalOcean), Amazon SES, or a local log file. |

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
| `packages/db/migrations/0008_roles_v2.sql` | Backend v2 roles: lens_worker (job worker) and lens_research (no login, for later). Base grants only. |
| `packages/db/migrations/0009_files_analyses.sql` | Uploaded statement files (encrypted, 30-day life), analyses (server jobs), file links, file access log, parse runs. |
| `packages/db/migrations/0010_trades_metrics.sql` | Normalised engine output: trades, fills, report_metrics, report_traits; new reports columns (title, MON-YY, file-set lock). |
| `packages/db/migrations/0011_consents.sql` | Append-only consent history (processing / research), current-consent view, and data export/delete requests. |
| `packages/db/migrations/0012_plans_v2.sql` | Server-side plan enforcement: create_report_from_analysis(), add_analysis_to_report() (file-set lock), owner-only admin_grant_plan(). |
| `packages/db/migrations/0013_purge_v2.sql` | Retention and deletion: purge_raw_files() (30 days), purge_drafts() (24 h), purge_otp_codes(), delete_report_v2(), delete_account(). |
| `packages/db/migrations/0014_research_ready.sql` | research schema: pseudonymised views over trades, metrics and traits, for users with research consent only. No ML. |
| `packages/db/migrations/0015_analysis_error_message.sql` | analyses.error_message: the engine's own user-facing text for a failed file (e.g. scanned PDF), shown word for word. |
| `packages/db/migrations/0016_analysis_file_reports.sql` | Per-file dashboards: each statement's own report (ReportV1) for analyses with 2+ files, shown as file tabs next to "All files". |
| `packages/db/optional/pg_cron.sql` | Optional: schedule the purge inside Postgres if pg_cron is available. |
| `packages/db/scripts/seed-dev.mjs` | Applies seed.sql (dev user with credits) — only when SEED_DEV_DATA=true (set by infra/compose.dev.yml only). |
| `packages/db/scripts/setup-roles.mjs` | Creates/updates the login roles lens_app and lens_worker with passwords from env (runs after migrations, as superuser). |
| `packages/db/seed.sql` | Local development seed (dev user with a Snapshot plan and matching credits). Never run in production. |
| `packages/db/src/client.ts` | Kysely connection factory per role (lens_app for the api, lens_worker for the worker) with the existing SSL/CA env handling. |
| `packages/db/src/errors.ts` | Typed errors for the business-rule codes raised by the SQL functions (P0001 'no_plan', 'report_files_full', …). |
| `packages/db/src/index.ts` | Public entry of @pnl-lens/db: connection factory, table types, typed queries and errors for the api and worker. |
| `packages/db/src/normalise.ts` | Maps one engine ReportV1 to rows for trades, report_metrics and report_traits (pure; used by the worker store step), plus the file-set fingerprint. |
| `packages/db/src/queries/analyses.ts` | Uploads and analysis jobs: create an upload (api, lens_app), D11 counters, job status and the idempotent store step (worker, lens_worker). |
| `packages/db/src/queries/plans.ts` | Plans: the user's plan card (allowance, validity, statements per report) and the owner-only manual grant (D5). |
| `packages/db/src/queries/privacy.ts` | Consent history, data export/delete requests, account deletion, and the scheduled purge/sweep jobs (worker). |
| `packages/db/src/queries/reports.ts` | Reports (api, lens_app): claim an analysis, add files (file-set lock), rename, delete, MON-YY history, Progress history, trades. |
| `packages/db/src/types.ts` | Kysely table types for the schema after migration 0016 (hand-written; every table is exercised through these types by test/db/*). |

### Ops

| File | What it does |
|---|---|
| `apps/api/scripts/build.mjs` | Bundles apps/api with esbuild into dist/main.js: workspace packages (db, shared, engine/extract) inlined, npm dependencies left external. |
| `apps/web/app/api/cron/purge/route.ts` | POST /api/cron/purge — optional HTTP trigger for the nightly purge (needs CRON_SECRET). The scheduled job uses scripts/purge.mjs. |
| `apps/web/app/api/health/route.ts` | GET /api/health — liveness check used by DigitalOcean App Platform. |
| `apps/web/scripts/copy-pdf-worker.mjs` | postinstall: copies the pdf.js worker into public/. |
| `apps/worker/scripts/build.mjs` | Bundles the worker (dist/main.js) and the engine child process (dist/engine-child.js) with esbuild; engine_version fixed from the engine sources. |
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
| `apps/api/test/auth.test.ts` | Sign-in (email code), session cookie, /me, /plans, CSRF origin check, consents, export and account deletion, health/ready — on real Postgres. |
| `apps/api/test/helpers.ts` | API test helpers: app on a fresh migrated database (lens_app connection), session cookies, multipart bodies, captured mail. |
| `apps/api/test/openapi-doc.ts` | Builds the app with placeholder dependencies (no database connection is opened) to read its OpenAPI document. |
| `apps/api/test/openapi.test.ts` | apps/api/openapi.json matches the routes (regenerate: npm run openapi -w @pnl-lens/api); global and sign-in rate limits. |
| `apps/api/test/payments-admin.test.ts` | Payments (off mode, Checkout verify, webhook signature, replay idempotency, legacy path) and admin RBAC (tabs, roles, audit, owner-only grant). |
| `apps/api/test/sniff.test.ts` | Upload type check: every engine fixture is accepted with the engine's kind; executables, images, wrong ZIPs and binaries posing as CSV are refused. |
| `apps/api/test/uploads.test.ts` | Uploads and reports on real Postgres: consent, type/size/plan/D11 limits, encryption at rest, queueing, status, save (credits), "+" lock, rename, delete. |
| `apps/web/tests/otp.test.ts` | Email one-time code helpers. |
| `apps/web/tests/payments.test.ts` | Razorpay checkout and webhook signature verification. |
| `apps/web/tests/pg-store.test.ts` | PostgreSQL store integration (needs TEST_DATABASE_URL). |
| `apps/web/tests/rbac.test.ts` | Role permissions and error fingerprinting. |
| `apps/worker/test/global-setup.ts` | Builds the worker bundles once before the tests (the engine child process runs from dist/, as in the image). |
| `apps/worker/test/helpers.ts` | Worker test helpers: encrypted uploads of real fixtures (as the API stores them), pipeline deps with the real engine child, golden cases. |
| `apps/worker/test/hostile.test.ts` | Hostile files: a parse that runs too long is killed, one that exhausts memory crashes only its child; the worker carries on and the job fails cleanly. |
| `apps/worker/test/pipeline.test.ts` | Every golden case through the real pipeline (encrypted storage → engine child → DB): stored report equals the parity output; failures cost no credit. |
| `apps/worker/test/queue.test.ts` | Real sample files through the real queue (API producer → Redis → worker consumer); retries then dead letter; nightly purge and storage sweep. |
| `packages/db/test/db/harness.ts` | DB test harness: fresh database per suite on the throwaway test Postgres, real migrate + setup-roles scripts, role-scoped clients, fixtures. |
| `packages/db/test/db/migrations.test.ts` | Migrations apply from 0001 on an empty database and on top of a 0007 database with old data; the old web flow keeps working. |
| `packages/db/test/db/plans.test.ts` | Server-side plan rules: create_report_from_analysis (all refusal reasons, races), file-set lock, owner-only manual grant, webhook replay. |
| `packages/db/test/db/privacy.test.ts` | Rule 7 in the database: consents, 30-day file purge with key shredding, draft purge, report delete, account delete, research views. |
| `packages/db/test/db/roles.test.ts` | Least privilege (rule 4): what lens_app, lens_worker, lens_research and PUBLIC can and cannot do after migration 0014. |
| `packages/db/test/db/store.test.ts` | Worker store step on a real database: every golden report stored as payload + trades + metrics + traits in one transaction, idempotent. |
| `packages/db/test/normalise.test.ts` | Engine output -> table rows, for every golden report (no database needed); file fingerprint matches the offline tool. |
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
| `tests/visual/capture.mjs` | Screenshots of every page at 1440 and 390 px (before/after comparisons for "keep the UI exactly", rule 8). |
| `tests/visual/compare.mjs` | Pixel comparison of two screenshot folders (from capture.mjs); writes diff images and prints the share of changed pixels per page. |

<!-- FILES:END -->
