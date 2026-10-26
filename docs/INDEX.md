# PnL Lens — Master Index

Start here. Every source file starts with a 3-line header (`@file`, `@area`, `@what`); the table at the bottom is generated from those headers.

## 1. Read in this order

| # | Document | What you get |
|---|---|---|
| 1 | `docs/INDEX.md` (this file) | Map of the code and where to change things |
| 2 | `docs/ARCHITECTURE.md` | How the pieces fit, request flows, security model |
| 3 | `docs/BACKEND_V2_PLAN.md` | The approved backend-v2 plan, decisions and the result of every phase |
| 4 | `docs/ENVIRONMENT.md` | Every environment variable |
| 5 | `docs/TESTING.md` | How to run every test suite |
| 6 | `docs/INFRA.md` | Docker Compose stacks: services, networks, least privilege, secrets, commands |
| 7 | `docs/API.md` | The API (`/api/v1`): conventions, every endpoint, upload fields, code map |
| 8 | `docs/WORKER.md` | The worker: one job step by step, failure rules, schedules, settings |
| 9 | `docs/DEPLOYMENT_VM.md` | Production: DigitalOcean Droplet + Spaces + Cloudflare, step by step |
| 10 | `docs/RUNBOOK.md` | Operating production: deploy, roll back, backups, restore, rotate secrets and keys, faults |
| 11 | `docs/GO_LIVE_CHECKLIST.md` | What is left before launch (owner tasks, dated items, legal) |
| 12 | `docs/PRIVACY_NOTES.md` | What is stored, where, for how long, who can read it (basis for the privacy policy) |
| 13 | `docs/PAYMENTS_RAZORPAY.md` | Payment modes and the Razorpay integration |
| 14 | `docs/LOAD_TEST.md` · `docs/RESTORE_DRILL.md` | Load-test results and the backup/restore rehearsal |
| 14b | `docs/DESIGN.md` | The visual system: colour tokens, type scale, spacing, motion and component rules |
| 15 | `docs/legal/` | **Drafts, not in force:** Privacy Policy and Terms of Service, with LAWYER CHECK / BUILD CHECK markers |
| 16 | `docs/HANDOFF_HISTORY.md` | Change log and decisions from before backend-v2 |

## 2. Folder map

npm workspaces monorepo (backend-v2). Run every command from the repo root.

| Folder | Contains |
|---|---|
| `apps/web/` | Next.js website. **No database access and no API routes**: pages call the API (`lib/api-client.ts` on the server with the visitor's cookie, `lib/api-browser.ts` in the browser) |
| `apps/web/app/` | Pages: landing, pricing, login/signup, dashboard, upload (workspace), report, admin; global CSS and fonts |
| `apps/web/components/` | React components: landing, workspace (upload, loader, file tabs, history, plan card, your data), admin console, auth, payments |
| `apps/web/lib/report-ui/` | Report renderer + "analysing" loader (shared by website and offline tool) |
| `apps/web/offline/` | Builders for the single-file offline HTML (sites, tool, admin demo) |
| `apps/api/` | Fastify API (`/api/v1`): sign-in, uploads, reports, plans, payments, admin, privacy. See `docs/API.md` and `apps/api/openapi.json` |
| `apps/worker/` | Job worker (BullMQ): decrypt, engine in an isolated child process, store; data exports; nightly purge and storage sweep. See `docs/WORKER.md` |
| `packages/engine/` | The analysis engine, **moved unchanged** (`src/`), its Node runner (`src/node.ts`), tests, fixtures and **golden parity files** (`test/golden/`) |
| `packages/db/` | SQL migrations (run in order), typed queries (Kysely), migrate / role-setup / purge / key-rotation / demo-data scripts, DB tests |
| `packages/shared/` | Plans and prices, limits, auth (codes, Google, sessions, safe redirects), payments, RBAC rules, telemetry, mail, consent text, file encryption, job names |
| `infra/` | Compose files (`compose.dev.yml`, `compose.prod.yml`, overlays for tests/e2e/load), Dockerfiles, Caddy (dev + prod), Garage, server scripts (`scripts/`: provision, deploy, backup, restore, healthcheck), audit allow-list and gitleaks config (`security/`) |
| `.github/workflows/` | `ci.yml` (every push) and `deploy.yml` (`v*` tag → GHCR → server) |
| `tests/` | `stack/` (running Docker stack), `e2e-web/` (Playwright), `load/` (k6), `visual/` (screenshot comparison) |
| `scripts/` | Index generator |
| `docs/` | All documentation |

## 3. Where do I change…?

| I want to… | Edit |
|---|---|
| Prices, plans, reports per plan, statements per report | `packages/shared/src/pricing.ts` (and `apps/web/offline/app_offline.js` → `PLANS` for the offline tool) |
| Turn payments on | `.env`: `PAYMENTS_MODE=razorpay` + `RAZORPAY_*` (`docs/PAYMENTS_RAZORPAY.md`) |
| Landing page text (India / Global) | `apps/web/components/landing/Landing.tsx`, sample dashboard `apps/web/components/landing/Showcase.tsx` |
| Landing look | `apps/web/app/landing.css` |
| Report tabs, hover cards, Progress tab | `apps/web/lib/report-ui/render.js`, styles in `apps/web/app/report.css` |
| Workspace (upload, "+", file tabs, history) | `apps/web/components/workspace/` |
| Insight / leak / rule wording ⚠ engine | `packages/engine/src/engine.js` (search `buildLeaks`, `buildRules`). Any engine edit changes the goldens; see `docs/TESTING.md` |
| Behavioural traits (100) ⚠ engine | `packages/engine/src/behaviour.js` |
| Progress score, goals, badges ⚠ engine | `packages/engine/src/engine.js` → `buildProgress` |
| Broker column names / detection ⚠ engine | `packages/engine/src/engine.js` → `SYN`, `matchHeader`, `inferTable` |
| PDF / Word reading ⚠ engine | `packages/engine/src/extract.js` |
| Upload limits, file types | `packages/shared/src/limits.ts`, `apps/api/src/routes/analyses.ts` (daily/running limits), `apps/api/src/lib/sniff.ts` |
| Sign-in emails | `packages/shared/src/mail.ts` |
| Roles and who sees which admin tab | `packages/shared/src/admin/rbac.ts` |
| Admin metrics | `packages/shared/src/admin/queries.ts` (SQL), `apps/web/components/admin/AdminConsole.tsx` (UI) |
| Security headers / CSP | `infra/caddy/Caddyfile` (dev) and `infra/caddy/Caddyfile.prod` |
| Database tables or rules | A new file in `packages/db/migrations/` (never edit 0001–0007 or any applied migration) |
| Retention periods | `.env` `RETENTION_*`; raw files 30 days in `packages/db/migrations/0013_purge_v2.sql` (new migration to change) |

## 4. Main flows (one line each)

| Flow | Path through the code |
|---|---|
| Analyse statements | workspace → `POST /api/v1/analyses` (consent, sniff, encrypt, Garage, queue) → worker (`pipeline.ts` → `engine-child.ts`) → one-transaction store → `GET /analyses/:id` → `POST /reports` (`create_report_from_analysis()`) |
| Add / remove a statement | "+" → upload with `reportId` → `POST /reports/:id/files` (file-set lock) · × → `POST /reports/:id/files/remove` |
| View a report | `/report/[id]` → `GET /api/v1/reports/:id` → `lib/report-ui/render.js` |
| Sign in | `/login` → `/api/v1/auth/otp/*` or `/api/v1/auth/google/*` → `lens_session` cookie (`packages/shared/src/auth/session.ts`) |
| Buy a plan | `/pricing` → `BuyButton` → `/api/v1/payments/order` → Razorpay Checkout → **webhook** `/api/v1/payments/webhook` → `grant_plan()` |
| Admin | `/admin` → `AdminConsole` → `/api/v1/admin/*` (role checked in the API and the DB) |
| Your data | dashboard → `/api/v1/me/consents`, `/me/export` (worker builds an encrypted ZIP), `/me/delete` |
| Nightly clean-up | worker schedule 02:00 IST → `purge_raw_files`, `purge_drafts`, `purge_otp_codes`, `purge_logs`; storage sweep every 15 minutes |
| Deploy | tag `v*` → `deploy.yml` → GHCR → `infra/scripts/deploy.sh` (migrate, start, ready check, rollback) |

## 5. Every file

<!-- FILES:START -->
_Generated from file headers by `npm run docs:index` — 262 files._

### Pages

| File | What it does |
|---|---|
| `apps/web/app/layout.tsx` | Root layout: fonts (Manrope + ₹ glyph), html lang (en-IN / en by site), header with logo and reports left (from the API), browser error reporter. |
| `apps/web/app/not-found.tsx` | 404 page. |
| `apps/web/components/nav/NavLinks.tsx` | Header navigation links (active-state aware). |

### Landing

| File | What it does |
|---|---|
| `apps/web/app/page.tsx` | Home page route. Picks India or Global site from the visitor country (?region= overrides) and renders <Landing>. |
| `apps/web/components/landing/BlogPreview.tsx` | REQ-7 landing section 9 "Read your trades better": the latest 3 published posts for the site; renders nothing when there are none. |
| `apps/web/components/landing/Instagram.tsx` | REQ-6 Instagram section: 3 posts/reels and a follow card in one row that slides sideways on scroll (landing.js). Self-hosted media only, no Meta resources. |
| `apps/web/components/landing/Landing.tsx` | Landing page markup for India and Global sites: hero, steps, sample dashboard, benefits, plans, Instagram, privacy, brokers, blog preview, FAQ (pricing early for mobile, REQ-4). |
| `apps/web/components/landing/Showcase.tsx` | Animated 5-tab sample dashboard on the landing page (illustrative numbers, ₹ or $ by region). |
| `apps/web/components/landing/Social.tsx` | X and Instagram icon buttons (REQ-5) for the landing header and footer; links come from the per-site config. |
| `packages/shared/src/site.ts` | Per-site settings (India / Global): social profile links and the Instagram section cards. One place to point a site at its own accounts. |

### Brand

| File | What it does |
|---|---|
| `apps/web/components/brand/Logo.tsx` | Logo mark (three rising bars + growth arrow) and wordmark. Same artwork as app/icon.svg. |

### Auth

| File | What it does |
|---|---|
| `apps/api/src/routes/auth.ts` | Sign-in: email + password (a one-time code proves the email first and resets a forgotten password), email code request/verify, Google start/callback, logout. |
| `apps/api/src/routes/me.ts` | GET /me (ported), GET /plans, consents (GET/POST /me/consents), POST /me/export, POST /me/delete and DELETE /me. |
| `apps/web/app/(app)/layout.tsx` | Signed-in area (dashboard, upload, report): an email account without a password is sent to set one first. |
| `apps/web/app/(auth)/login/page.tsx` | Sign-in page: one card (Continue with Google · OR · Continue with email → password, or a code for a new email → set a password). One account per email. |
| `apps/web/app/(auth)/signup/page.tsx` | Redirects /signup to /login (one page for new and returning users). |
| `apps/web/components/auth/LoginForm.tsx` | Sign-in card steps: email (Continue with Google · OR · Continue with email) → password, or a one-time code for a new email → set a password; Forgot password → code → new password. |
| `apps/web/components/auth/LogoutButton.tsx` | Log-out button. |
| `apps/web/lib/auth/session.ts` | The signed-in user for server components, asked from the API (GET /api/v1/me with the visitor's cookie). |
| `packages/shared/src/auth/google.ts` | Google OpenID Connect flow (PKCE, state, nonce, ID-token verification). |
| `packages/shared/src/auth/next.ts` | safeNext(): the only way a "next" URL after sign-in is accepted — a path on this site, never another host. |
| `packages/shared/src/auth/origin.ts` | Public origin for redirects behind the load balancer (APP_URL). |
| `packages/shared/src/auth/otp.ts` | Email one-time codes: generation, hashing (HMAC), checks, email normalisation. |
| `packages/shared/src/auth/password.ts` | Password hashing (scrypt, Node built-in), checking in constant time, and the "is this password acceptable" rule. |
| `packages/shared/src/auth/pg-auth-store.ts` | Auth store on PostgreSQL (users, OTP codes, audit log); the connection is passed in (web pool or API pool). |
| `packages/shared/src/auth/session.ts` | Session token (signed JWT in the lens_session cookie): create, verify, cookie options, dev bypass. Used by apps/web and apps/api. |
| `packages/shared/src/auth/types.ts` | Auth store interface and user/OTP types. |

### Reports

| File | What it does |
|---|---|
| `apps/api/src/lib/plan-pdf.ts` | Renders a 30-day plan (packages/shared/src/plan) as the 2-page A4 PDF of the owner's sample: Do/Don't cards, scorecard, weekly check-in, check-up box with links. |
| `apps/api/src/lib/reminders.ts` | Sends due 30-day plan check-up reminders (from 09:00 IST, once each): claim first, then email. Runs on a timer in the api process. |
| `apps/api/src/routes/analyses.ts` | POST /analyses (alias /uploads): consent, type sniffing, size/plan/D11 limits, encrypt, store, queue. GET /analyses/:id and /reports/:id/status. |
| `apps/api/src/routes/plan.ts` | 30-day plan: the report owner's PDF download (the one download a report has), the check-up calendar file, and check-up email reminders. |
| `apps/api/src/routes/reports.ts` | Reports: list (MON-YY history), save an analysis (spends one report from a valid plan), "+" add files (file-set lock), get, rename, delete. |
| `apps/web/app/(app)/dashboard/page.tsx` | Signed-in dashboard: plan card, reports (search, sort, rename); your data (research opt-in, export, delete account). |
| `apps/web/app/(app)/reminders/new/page.tsx` | "Remind me on <date>" from the 30-day plan PDF: confirms and turns on one check-up email (signs in first if needed). |
| `apps/web/app/(app)/report/[id]/page.tsx` | One report in the workspace: file tabs, All files, +, ×, the five dashboard tabs; a "deleted" page once removed. |
| `apps/web/app/(app)/upload/page.tsx` | New report: the workspace upload view (consent, files, loader; the API and worker read the files). |
| `apps/web/components/workspace/DataRights.tsx` | "Your data" panel: password (set or change), 30-day plan check-up reminder (cancel), research opt-in (off by default, change anytime), export my data (ZIP, kept 7 days), delete my account. |
| `apps/web/components/workspace/History.tsx` | Report history (report page sidebar) grouped by month (MON-YY) with Progress score and an always-visible rename (PATCH /api/v1/reports/:id); RenameRow is shared with the dashboard list. |
| `apps/web/components/workspace/JourneyBar.tsx` | REQ-2 journey bar above the workspace and dashboard: 5 steps (done / locked with the unlocking plan), score line, next action; one line on phones. |
| `apps/web/components/workspace/model.ts` | Workspace data types (from the API) and the offline tool's wording, labels and plan rules, kept word for word. |
| `apps/web/components/workspace/PlanButton.tsx` | "30-day plan" button at the top right of a report: downloads the server-built PDF of 5 Do and 5 Don't rules (the one download a report has). |
| `apps/web/components/workspace/PlanCard.tsx` | Plan card (sidebar) and plan strip (upload view): "Snapshot · 2 of 5 reports used · use by 19-Jan-27", statements per report (credits spec wording). |
| `apps/web/components/workspace/ReminderConfirm.tsx` | Confirms a check-up reminder: "Remind me on 20 Nov 2026?" → Turn on reminder → "Done. We'll email you on 20 Nov." |
| `apps/web/components/workspace/ReportList.tsx` | Dashboard report list: search (name, files, month, market, dates), sort (newest, oldest, name), clear cards with trades and net P&L, always-visible Rename. |
| `apps/web/components/workspace/Workspace.tsx` | The report workspace (ported from the offline tool, now on the API): upload with consent, loader, file tabs + All files, "+" and ×, plan card, MON-YY history. |
| `apps/web/lib/workspace-data.ts` | Server-side loaders for the workspace pages: my plans and my report history from the API, in the shapes the workspace uses. |
| `packages/db/src/queries/plan-snapshots.ts` | 30-day plan snapshots (0026): saved when the plan PDF is downloaded; the newest one made before a report is what that report's check-up scores. |
| `packages/db/src/queries/reminders.ts` | 30-day plan check-up reminders: set (replaces the active one), read, cancel (app); due list and claim-before-send (api sender, via 0024 functions). |
| `packages/shared/src/journey.ts` | REQ-2 "trading journey": which of the 5 steps are done or locked, the score line and the next action, from real plans and saved reports only. |
| `packages/shared/src/plan/build.ts` | 30-day plan from a stored report: 5 Do and 5 Don't rules (each with Why and Now → Target), a scorecard, a weekly check-in and the check-up date. Habits only, no buy/sell advice. |
| `packages/shared/src/plan/score.ts` | 30-day plan check-up: scores each measurable rule of an earlier plan against a newer report (Met / Missed / not measurable), on the trades since the plan when there are enough. |

### Engine

| File | What it does |
|---|---|
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
| `apps/web/app/pricing/page.tsx` | Pricing page: 4 plans priced by country, each with a BuyButton; ?plan= highlights the plan a journey step needs (REQ-2). |
| `apps/web/components/payments/BuyButton.tsx` | Buy button for both payment modes: opening soon / Razorpay Checkout (link mode removed, plan D5). |
| `packages/shared/src/payments/config.ts` | PAYMENTS_MODE for backend v2 (off \| razorpay; link mode removed, plan D5) and the Razorpay keys. |
| `packages/shared/src/payments/razorpay.ts` | Razorpay Orders API, Checkout signature and webhook signature verification (no SDK). |
| `packages/shared/src/pricing.ts` | Plans and prices (single source of truth): reports, statements per report, validity, ₹/$ by country. |

### Admin

| File | What it does |
|---|---|
| `apps/api/src/routes/admin.ts` | Admin console API ported from apps/web/app/api/admin/* (role read from the DB each request, every read audited) plus the owner-only manual plan grant (D5). |
| `apps/api/src/routes/research.ts` | Research datasets (owner only): list, "Build now", download (decrypted from the exports bucket, every download audited), and find who a subject or report code belongs to (reason required, audited). |
| `apps/api/src/routes/telemetry.ts` | POST /events (allow-listed product events; two landing events also from visitors) and POST /errors (browser errors); always 204. |
| `apps/api/src/routes/users-admin.ts` | Admin user management: user list with research status, "Request reports" email (owner), restrict / unrestrict (owner, admin), delete (owner); the public one-click consent link. |
| `apps/web/app/admin/blog/preview/[id]/page.tsx` | REQ-7 private article preview (any status) for owner/admin: the public article layout with a "Preview" banner; never indexed. |
| `apps/web/app/admin/page.tsx` | Admin console page: staff only (role from the API, read from the database on every request). |
| `apps/web/components/admin/AdminConsole.tsx` | Admin console UI: Users, User management, Finance, Errors, Support, Product, Blog and Research tabs (shown per role). |
| `apps/web/components/admin/BlogAdmin.tsx` | REQ-7 admin "Blog" tab (owner/admin): post list with views, Markdown editor with live preview, cover upload, SEO panel, publish/schedule/unpublish/archive/delete. |
| `apps/web/components/admin/ResearchAdmin.tsx` | Admin "Research" tab (owner only): research datasets built on the 1st and 16th from opted-in users, Build now, download; find who a subject or report code belongs to (reason required, audited). |
| `apps/web/components/admin/UserAdmin.tsx` | Admin "User management" tab: search and filter users, see whose reports are in the research dataset, Request reports (owner), Restrict / Unrestrict (owner, admin), Delete (owner). |
| `apps/web/components/ErrorReporter.tsx` | Sends browser errors to /api/v1/errors (max 5 per page load). |
| `packages/shared/src/admin/queries.ts` | SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product). |
| `packages/shared/src/admin/rbac.ts` | Roles and permissions (owner, admin, support, finance, analyst): the rules only. The guards live in apps/web and apps/api. |
| `packages/shared/src/admin/telemetry.ts` | Product events and error capture over an injected connection (best-effort; never breaks a request). |

### API

| File | What it does |
|---|---|
| `apps/api/src/app.ts` | Builds the Fastify app (/api/v1): cookies, multipart limits, rate limits, CSRF origin check, zod validation, OpenAPI, every route. |
| `apps/api/src/config.ts` | API configuration from env, checked once at startup (fails fast on missing secrets). |
| `apps/api/src/lib/http.ts` | Response helpers with the same JSON shapes as the old Next routes ({ error, message }), session lookup, request adapters. |
| `apps/api/src/lib/markdown.ts` | REQ-7 blog: Markdown → safe HTML on the server (no raw HTML, no scripts/iframes, safe links), reading time and slugs. |
| `apps/api/src/lib/queue.ts` | Enqueues analysis jobs on BullMQ (Redis) for apps/worker; job id = analysis id, so a repeat is a no-op. |
| `apps/api/src/lib/sniff.ts` | Upload type check: the real file type from its bytes (the engine's own detectKind) plus a reject list for non-statements. |
| `apps/api/src/lib/storage.ts` | Object storage (S3 API on Garage): encrypted statements (api key write-only), export archives (read-only), blog media (read/write, public via the API). |
| `apps/api/src/main.ts` | API process entry: config, Postgres (lens_app only), Redis, storage, queue, check-up reminder timer; listens on PORT; graceful shutdown. |
| `apps/api/src/routes/blog.ts` | REQ-7 blog API: public posts/feed/media (cacheable) and owner/admin-only writing, publishing, live preview and image upload (WebP via sharp). |
| `apps/api/src/routes/health.ts` | GET /health (liveness) and GET /ready (Postgres as lens_app, Redis, storage). |

### Worker

| File | What it does |
|---|---|
| `apps/worker/src/config.ts` | Worker configuration from env: lens_worker DB URL, Redis, storage (read + delete), file keys, engine limits. |
| `apps/worker/src/engine-child.ts` | Child process that runs the engine on one job's decrypted files (memory-capped, killed on timeout); returns the report, per-file fingerprints, fills and parse info. |
| `apps/worker/src/engine-runner.ts` | Starts engine-child.js per job with a memory cap and a timeout; a hung or crashing parse fails that file, not the worker (plan D10). |
| `apps/worker/src/engine-version.ts` | engine_version written on every derived row: a hash of the engine's source files and package.json (fixed at build time in the image). |
| `apps/worker/src/export.ts` | "Export my data": builds the user's archive (all data as JSON + original statements still stored), encrypts it, stores it for 7 days; expiry sweep. |
| `apps/worker/src/main.ts` | Worker process: BullMQ consumer for analysis jobs (retries, dead-letter on final failure), data exports and research datasets, schedules (nightly purge, storage sweep, research dataset on the 1st and 16th), local health endpoint. |
| `apps/worker/src/maintenance.ts` | Scheduled jobs: nightly purge (raw files after 30 days, unsaved drafts after 24 h, old sign-in codes) and the storage sweep that deletes shredded objects. |
| `apps/worker/src/pipeline.ts` | One analysis job: fetch + decrypt files (logged) → engine in a child process → store payload, trades, fills, metrics, traits, parse runs in one transaction. |
| `apps/worker/src/queue-worker.ts` | BullMQ consumer for analysis jobs: runs the pipeline, retries infrastructure errors, and on the final failure marks the analysis failed (dead letter). |
| `apps/worker/src/research.ts` | Research dataset (every 1st and 16th, or "Build now"): CSVs from the pseudonymised research views (opted-in users only), zipped, encrypted, kept 90 days; report links kept for the owner's lookup; expiry sweep. |
| `apps/worker/src/storage.ts` | Object storage for the worker (S3 API on Garage): read encrypted files, delete shredded ones. In-memory version for tests. |
| `apps/worker/src/zip.ts` | Minimal ZIP writer (deflate, CRC-32 from node:zlib) for the data-export archive; no third-party dependency. |

### Core

| File | What it does |
|---|---|
| `apps/web/lib/api-browser.ts` | Browser-side calls to the API (/api/v1 on the same site): JSON helper and multipart upload; errors keep the API's { error, message }. |
| `apps/web/lib/api-client.ts` | How the website talks to the API: server components call it over the private network with the visitor's cookie; the browser calls /api/v1 on the same site. |
| `apps/web/lib/auth/country.ts` | Visitor country for server components (Cloudflare CF-IPCountry / CloudFront / X-Country). |
| `packages/shared/src/auth/request.ts` | Client IP and country for API routes. |
| `packages/shared/src/consent-text.ts` | The exact consent sentences shown to users and their policy version (no Node imports, so the website can use them too). |
| `packages/shared/src/consent.ts` | Consent wording and version (from consent-text.ts) plus the SHA-256 of the exact text, stored with each consent row. |
| `packages/shared/src/db.ts` | Minimal query interface (pg.Pool / pg.Client satisfy it) so shared SQL helpers work with the web pool and the API pool. |
| `packages/shared/src/file-crypto.ts` | Envelope encryption for raw statement files: AES-256-GCM with a random key per file, wrapped by a KEK from env (rule 7). |
| `packages/shared/src/jobs.ts` | Queue names and job payloads shared by apps/api (producer) and apps/worker (consumer). |
| `packages/shared/src/limits.ts` | App-wide limits (max files, file types, report lifetime). |
| `packages/shared/src/mail.ts` | Email sender (SMTP / Google Workspace, Resend, Amazon SES, or a local log file) and the email templates (sign-in code, research invite). |

### Styles

| File | What it does |
|---|---|
| `apps/web/app/blog.css` | REQ-7 blog: list, cards (also the landing preview), article typography, CTA card, editor preview. Uses the design tokens in globals.css. |
| `apps/web/app/globals.css` | Base app styles: colours, header, panels, buttons, forms, print rules. |
| `apps/web/app/landing.css` | Landing page styles: one system of centred titles, equal cards, sample dashboard, plans. |
| `apps/web/app/motion.css` | Motion system (19 Oct 2026): easing/duration tokens, a CSS spring, page and view transitions, entrances, reveal-on-scroll, press/lift, sliding tab ink, shimmer, sheets. Reduced motion turns it all off. |
| `apps/web/app/report.css` | Report, Progress tab, analysing loader and admin console styles (shared by website and offline tool). |
| `apps/web/app/template.tsx` | Route transition: every navigation fades in and rises 10px (motion.css .mo-page); static with reduced motion. |
| `apps/web/app/workspace.css` | Workspace styles (file tabs, All files, +, plan card, MON-YY history with rename, lock message), ported from the offline tool. |
| `apps/web/components/motion/Loading.tsx` | Loading placeholder: a shimmering skeleton for sighted users; screen readers still hear "Loading…". |
| `apps/web/components/motion/MotionRuntime.tsx` | One small runtime for the motion system: reveal-on-scroll ([data-reveal] → .in), stagger indexes, sliding tab ink under every .tabs bar, count-ups ([data-count-up]), header glass on scroll, smooth in-page anchors. |
| `apps/web/lib/motion/viewTransition.ts` | withViewTransition(): runs a DOM/React update inside document.startViewTransition when available (cross-fade + slide, motion.css), otherwise directly. Never with reduced motion. |

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
| `packages/db/migrations/0017_data_export.sql` | "Export my data": export_user_data(request) for the worker (only for a real export request in progress) and the archive's key columns. |
| `packages/db/migrations/0018_log_retention.sql` | Retention for logs (privacy policy draft): product/error events after 12 months, audit and file-access logs after 24 months. |
| `packages/db/migrations/0019_blog.sql` | REQ-7 blog: posts, slug redirects, a public view (the only thing the app role can read), and owner/admin-only SECURITY DEFINER functions that write the audit log. |
| `packages/db/migrations/0020_passwords.sql` | Email + password sign-in: password hash (scrypt), lockout counters, and sessions_valid_after (a password change signs out other devices). |
| `packages/db/migrations/0021_research_exports.sql` | Research datasets every 15 days: research_exports records, and read access for the worker to the pseudonymised research views (0014) only. |
| `packages/db/migrations/0022_user_admin.sql` | Admin user management: restrict / unrestrict (owner, admin) and delete (owner) as role-checked, audited functions; research consent invites sent by email. |
| `packages/db/migrations/0023_credits_spec.sql` | Credits spec (19 Oct 2026): "+" refused once the report's plan window has ended; user_reports_left() = usable reports (active plans only). |
| `packages/db/migrations/0024_plan_reminders.sql` | 30-day plan check-up reminders: one active reminder per user (a date), sent once from 09:00 IST by the api (the only service with mail egress). |
| `packages/db/migrations/0025_research_links.sql` | Research datasets stay pseudonymised for download, but PnL Lens keeps the link: research_export_reports (report pseudonym → report) and an owner-only, audited research_lookup(). |
| `packages/db/migrations/0026_plan_snapshots.sql` | The 30-day plan as it was given to the user (rules, metrics, targets), kept so the next report can score it (check-up: Met / Missed per rule). |
| `packages/db/optional/pg_cron.sql` | Optional: schedule the purge inside Postgres if pg_cron is available. |
| `packages/db/scripts/seed-dev.mjs` | Applies seed.sql (dev user with credits) — only when SEED_DEV_DATA=true (set by infra/compose.dev.yml only). |
| `packages/db/scripts/setup-roles.mjs` | Creates/updates the login roles lens_app and lens_worker with passwords from env (runs after migrations, as superuser). |
| `packages/db/seed.sql` | Local development seed (dev user with a Snapshot plan and matching credits). Never run in production. |
| `packages/db/src/client.ts` | Kysely connection factory per role (lens_app for the api, lens_worker for the worker) with the existing SSL/CA env handling. |
| `packages/db/src/errors.ts` | Typed errors for the business-rule codes raised by the SQL functions (P0001 'no_plan', 'report_files_full', …). |
| `packages/db/src/index.ts` | Public entry of @pnl-lens/db: connection factory, table types, typed queries and errors for the api and worker. |
| `packages/db/src/normalise.ts` | Maps one engine ReportV1 to rows for trades, report_metrics and report_traits (pure; used by the worker store step), plus the file-set fingerprint. |
| `packages/db/src/queries/analyses.ts` | Uploads and analysis jobs: create an upload (api, lens_app), D11 counters, job status and the idempotent store step (worker, lens_worker). |
| `packages/db/src/queries/blog.ts` | REQ-7 blog: public reads (published posts per site, redirects, feed) and owner/admin writes through the blog_admin_* SQL functions. |
| `packages/db/src/queries/plans.ts` | Plans: the user's plan card (allowance, validity, statements per report) and the owner-only manual grant (D5). |
| `packages/db/src/queries/privacy.ts` | Consent history, data export/delete requests, account deletion, and the scheduled purge/sweep jobs (worker). |
| `packages/db/src/queries/reports.ts` | Reports (api, lens_app): claim an analysis, add files (file-set lock), rename, delete, MON-YY history, Progress history, trades. |
| `packages/db/src/queries/users-admin.ts` | Admin user management: restrict / unrestrict and delete through the role-checked database functions (0022). |
| `packages/db/src/types.ts` | Kysely table types for the schema after migration 0019 (hand-written; every table is exercised through these types by test/db/*). |

### Ops

| File | What it does |
|---|---|
| `apps/api/scripts/build.mjs` | Bundles apps/api with esbuild into dist/main.js: workspace packages (db, shared, engine/extract) inlined, npm dependencies left external. |
| `apps/web/app/healthz/route.ts` | Liveness of the web container (Docker healthcheck). The web app has no database; readiness of the system is GET /api/v1/ready. |
| `apps/worker/scripts/build.mjs` | Bundles the worker (dist/main.js) and the engine child process (dist/engine-child.js) with esbuild; engine_version fixed from the engine sources. |
| `infra/scripts/audit.mjs` | Production dependency audit for CI: fails on high/critical advisories unless allow-listed with a reason and an end date (infra/security/audit-allowlist.json). |
| `infra/scripts/gen-env.mjs` | Fills .env with random secrets for every stack variable that is missing. Never changes or prints existing values. |
| `infra/scripts/storage-init.mjs` | One-off, idempotent Garage setup via its admin API: node layout, private bucket, and least-privilege S3 keys. |
| `packages/db/scripts/migrate.mjs` | Applies packages/db/migrations in order (runs as the pre-deploy job). |
| `packages/db/scripts/purge.mjs` | Nightly purge of expired reports (DigitalOcean scheduled job). |
| `packages/db/scripts/rewrap-keys.mjs` | Key rotation: re-wraps every file and export key from older FILE_KEK_<ID>s to the current FILE_KEK_ID. Objects in storage are not touched. |
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
| `apps/api/test/blog.test.ts` | REQ-7 blog API: roles (403 for support/finance/analyst/user), CRUD, publish visibility, Markdown sanitising, slug redirects, image upload checks (WebP + 1200×630), cache headers, sign-up/upload attribution. |
| `apps/api/test/events.test.ts` | POST /events: allow-listed names only; visitors may send only the landing events (REQ-4); journey events from signed-in users (REQ-2). |
| `apps/api/test/helpers.ts` | API test helpers: app on a fresh migrated database (lens_app connection), session cookies, multipart bodies, captured mail. |
| `apps/api/test/openapi-doc.ts` | Builds the app with placeholder dependencies (no database connection is opened) to read its OpenAPI document. |
| `apps/api/test/openapi.test.ts` | apps/api/openapi.json matches the routes (regenerate: npm run openapi -w @pnl-lens/api); global and sign-in rate limits. |
| `apps/api/test/password.test.ts` | Email + password sign-in: start → code for new emails, required password after the first code, password login, lockout, forgot, change needs a fresh sign-in, other devices signed out, no hash leaks. |
| `apps/api/test/payments-admin.test.ts` | Payments (off mode, Checkout verify, webhook signature, replay idempotency, legacy path) and admin RBAC (tabs, roles, audit, owner-only grant). |
| `apps/api/test/plan.test.ts` | 30-day plan: owner-only PDF (2 pages, links, audited, no-store), plan snapshot + check-up on the next report, public .ics, reminders (set/replace/cancel/validate), sender claims before sending and sends once. |
| `apps/api/test/research.test.ts` | Research dataset routes: owner only (403 for admin, support, finance, analyst, user), Build now (one at a time), download decrypts and is audited, expired → 404. |
| `apps/api/test/sniff.test.ts` | Upload type check: every engine fixture is accepted with the engine's kind; executables, images, wrong ZIPs and binaries posing as CSV are refused. |
| `apps/api/test/uploads.test.ts` | Uploads and reports on real Postgres: consent, type/size/plan/D11 limits, encryption at rest, queueing, status, save (credits), "+" lock, rename, delete. |
| `apps/api/test/users-admin.test.ts` | User management API: permissions, list + research statuses, "Request reports" rules and email, one-click consent link (single use, expiry), restrict ends sessions and sign-in, delete with typed email. |
| `apps/worker/test/export.test.ts` | "Export my data" on a real database: complete archive (JSON + original statements), encrypted at rest, access logged, expires after 7 days. |
| `apps/worker/test/global-setup.ts` | Builds the worker bundles once before the tests (the engine child process runs from dist/, as in the image). |
| `apps/worker/test/helpers.ts` | Worker test helpers: encrypted uploads of real fixtures (as the API stores them), pipeline deps with the real engine child, golden cases. |
| `apps/worker/test/hostile.test.ts` | Hostile files: a parse that runs too long is killed, one that exhausts memory crashes only its child; the worker carries on and the job fails cleanly. |
| `apps/worker/test/pipeline.test.ts` | Every golden case through the real pipeline (encrypted storage → engine child → DB): stored report equals the parity output; failures cost no credit. |
| `apps/worker/test/queue.test.ts` | Real sample files through the real queue (API producer → Redis → worker consumer); retries then dead letter; nightly purge and storage sweep. |
| `apps/worker/test/research.test.ts` | Research dataset: only opted-in users, encrypted at rest, 4 CSVs + README, no emails/names/file names/internal ids, per-export report pseudonyms, links kept for the owner's audited lookup, consent withdrawal, expiry sweep, worker role limits. |
| `packages/db/test/db/blog.test.ts` | REQ-7 blog in the database: app role reads the public view only, owner/admin-only functions, audit rows, visibility rules, slug redirects. |
| `packages/db/test/db/credits.test.ts` | Credits spec (19 Oct 2026) acceptance checks in the database: reports left, "+" free up to the limit, failed files and deletes spend/return nothing, plan window, soonest-expiring first. |
| `packages/db/test/db/harness.ts` | DB test harness: fresh database per suite on the throwaway test Postgres, real migrate + setup-roles scripts, role-scoped clients, fixtures. |
| `packages/db/test/db/migrations.test.ts` | Migrations apply from 0001 on an empty database and on top of a 0007 database with old data; the old web flow keeps working. |
| `packages/db/test/db/plan-reminders.test.ts` | Check-up reminders (0024): one active per user, lens_app may only cancel (not change dates or mark sent), worker has no access, claim is once-only. |
| `packages/db/test/db/plan-snapshots.test.ts` | Plan snapshots (0026): app may save and read but not change; one per report and day; the check-up picks the newest plan made before a report; closing the account removes plans and reminders. |
| `packages/db/test/db/plans.test.ts` | Server-side plan rules: create_report_from_analysis (all refusal reasons, races), file-set lock, owner-only manual grant, webhook replay. |
| `packages/db/test/db/privacy.test.ts` | Rule 7 in the database: consents, 30-day file purge with key shredding, draft purge, report delete, account delete, research views. |
| `packages/db/test/db/research-links.test.ts` | Research links (0025): worker may insert but not read report links; research_lookup is owner-only, needs a reason, needs the dataset for report codes, audits every lookup, shows deleted accounts as deleted. |
| `packages/db/test/db/rewrap.test.ts` | Key rotation: rewrap-keys.mjs moves every file key from k1 to k2; files still decrypt; dry run changes nothing; re-running is safe. |
| `packages/db/test/db/roles.test.ts` | Least privilege (rule 4): what lens_app, lens_worker, lens_research and PUBLIC can and cannot do after migration 0014. |
| `packages/db/test/db/store.test.ts` | Worker store step on a real database: every golden report stored as payload + trades + metrics + traits in one transaction, idempotent. |
| `packages/db/test/db/user-admin.test.ts` | User management functions (0022): who may restrict or delete whom, sessions end on restrict, delete anonymises, audit rows; research_invites grants. |
| `packages/db/test/normalise.test.ts` | Engine output -> table rows, for every golden report (no database needed); file fingerprint matches the offline tool. |
| `packages/db/tests/01_functions.sql` | SQL tests for the database functions and the app role restrictions. |
| `packages/engine/test/behaviour.test.ts` | 100-trait library: uniqueness, wording, variety. |
| `packages/engine/test/engine.test.ts` | Engine: formats, accounting, symbols, auto-detection, combining files, progress. |
| `packages/engine/test/extract.test.ts` | PDF, DOCX and legacy DOC reading matches the CSV originals. |
| `packages/engine/test/golden.test.ts` | Engine parity: every fixture through the Node runner must equal the stored golden JSON byte for byte. |
| `packages/shared/test/journey.test.ts` | REQ-2 journey rules: steps done only when really met and included in the plan, locks name the unlocking plan, score line, next action. |
| `packages/shared/test/mail.test.ts` | Email drivers: console writes the log; smtp (Google Workspace) connects with TLS and the App password from env, and sends the code email. |
| `packages/shared/test/next.test.ts` | safeNext(): same-site paths pass; every off-site trick (//, /\, tabs/newlines, schemes) falls back. |
| `packages/shared/test/otp.test.ts` | Email one-time code helpers. |
| `packages/shared/test/password.test.ts` | scrypt password hashing: round trip, wrong password, unique salts, the dummy hash never matches, and the password rules. |
| `packages/shared/test/payments.test.ts` | Razorpay checkout and webhook signature verification. |
| `packages/shared/test/plan-score.test.ts` | 30-day plan check-up scoring on the golden reports: metrics match the plan's own numbers, better trading scores Met, habit-only rules are not measurable, trades since the plan are used when there are enough. |
| `packages/shared/test/plan.test.ts` | 30-day plan generator on every golden report: always 5 Do + 5 Don't, real numbers, deterministic, habits only. |
| `packages/shared/test/pricing.test.ts` | REQ-3: plan durations and prices from the single source of truth, the wording built from them, and no stale copy left in the repo. |
| `packages/shared/test/rbac.test.ts` | Role permissions and error fingerprinting. |
| `tests/e2e-web/blog.spec.ts` | REQ-7 blog end to end: owner drafts, previews, publishes, unpublishes, schedules; /blog, article, landing preview, sitemap; raw-HTML SEO; sanitising; support sees no Blog tab; events. |
| `tests/e2e-web/credits.spec.ts` | Credits spec (19 Oct 2026) in the browser: "N reports left" pill and "Plans" menu, plan card wording, free preview (3 numbers, 2 insights, blurred, from ₹99/$9), plan window end, no "credit" on customer screens. |
| `tests/e2e-web/helpers.ts` | E2E helpers: sign in (password, or an emailed code from the API's console mail log then the required password), give a user a plan, run SQL as the admin. |
| `tests/e2e-web/instagram.spec.ts` | REQ-6 Instagram section: scroll-linked row (card 1 → 4), manual takeover, reduced motion, video play rules, exact copy, no Meta requests, no layout shift. |
| `tests/e2e-web/journey.spec.ts` | REQ-2 journey bar and "What's next" card end to end: Single 2/5 with locks, later month completes step 3, locked step opens pricing, phone view, events in admin. |
| `tests/e2e-web/landing.spec.ts` | REQ-4: on a 390x844 phone pricing starts within 4 screen-heights; See plans / nav / pill reach it; mobile card order; no section lost; landing events stored. |
| `tests/e2e-web/login.spec.ts` | Sign-in card: new email → code → required password → dashboard; password sign-in sends no code; wrong password; forgot → code → new password; the set step can't be skipped; layout at 320/390/1440. |
| `tests/e2e-web/motion.spec.ts` | Motion system (19 Oct 2026): reduced motion = no animation and everything visible; reveal-on-scroll ends visible; sliding tab ink follows the selected tab; sign-in steps work with View Transitions. |
| `tests/e2e-web/plan.spec.ts` | 30-day plan: "30-day plan" button at the top right of a report downloads the PDF; "Remind me" turns on a check-up email, shown in Your data, sent once when due; the next report's Progress tab scores the plan. |
| `tests/e2e-web/privacy.spec.ts` | Data rights in the browser: research opt-in toggle, export my data (worker builds the ZIP, download works), delete my account. |
| `tests/e2e-web/reports.spec.ts` | Consent boxes (Terms/Privacy links, research unticked) and finding/renaming reports: dashboard search, sort, rename; rename on the report page; the dashboard is one centred column. |
| `tests/e2e-web/research.spec.ts` | Research datasets end to end: the owner builds one now (the real worker, storage and encryption), downloads the ZIP; finds who a subject or report code belongs to (audited); an admin has no Research tab. |
| `tests/e2e-web/score-card.spec.ts` | REQ-1: the Progress score card's level labels never overlap, at every level and width, in Chromium (Chrome/Edge) and WebKit (Safari). |
| `tests/e2e-web/user-admin.spec.ts` | User management end to end: owner requests reports → email → one-click Yes → Included; restrict signs the user out; delete with typed email; admin and support limits. |
| `tests/e2e-web/workspace.spec.ts` | Browser end to end on the stack: sign in → upload with consent → loader → report (5 tabs) → "+" → file tabs/All files → rename in history → second device → remove → delete. |
| `tests/load/prepare.mjs` | Load test setup: creates N test accounts (load-NN@load.invalid) in the running dev stack and writes a session token for each to .load/tokens.json. |
| `tests/load/uploads.js` | k6 scenario: N users each upload statements at the same moment and follow their analysis to ready (latency, time to ready, failures). |
| `tests/stack/stack.test.ts` | Dev stack checks: all services healthy, only Caddy published, internal network isolated, least-privilege DB/Redis/storage. |
| `tests/visual/capture.mjs` | Screenshots of every page at 1440 and 390 px (before/after comparisons for "keep the UI exactly", rule 8). |
| `tests/visual/compare.mjs` | Pixel comparison of two screenshot folders (from capture.mjs); writes diff images and prints the share of changed pixels per page. |

### Blog

| File | What it does |
|---|---|
| `apps/web/app/blog/[slug]/page.tsx` | REQ-7 article page: server-rendered text, SEO metadata (canonical, Open Graph/Twitter, robots, hreflang), JSON-LD BlogPosting + BreadcrumbList, 301 for old slugs. |
| `apps/web/app/blog/page.tsx` | REQ-7 /blog: published posts for the visitor's site, newest first, 12 per page, tag filter; server-rendered. |
| `apps/web/app/blog/rss.xml/route.ts` | REQ-7 RSS 2.0 feed of published, indexable posts for the visitor's site (?region= switches). |
| `apps/web/app/robots.ts` | /robots.txt: public pages open to crawlers; admin, API and signed-in areas closed; points to the sitemap. |
| `apps/web/app/sitemap.ts` | /sitemap.xml: home, pricing, blog and every published, indexable post (both sites); follows publish/unpublish on the next request. |
| `apps/web/components/blog/Article.tsx` | REQ-7 article body (H1, date, read time, tag, cover, sanitised HTML) with the automatic footer: CTA card and "Not investment advice." |
| `apps/web/components/blog/BlogTrack.tsx` | REQ-7 article events: blog_view once per page view and blog_cta_click on "Analyse my trades" (anonymous, allow-listed by the API). |
| `apps/web/components/blog/PostCard.tsx` | REQ-7 article card (tag, read time, title, excerpt, "Read article →") used on /blog and in the landing preview. |
| `apps/web/lib/blog.ts` | REQ-7 blog data for server components: which site (India/Global) the visitor sees, public posts from the API, image URLs, dates in IST. |

### Legal

| File | What it does |
|---|---|
| `apps/web/app/privacy/page.tsx` | Privacy Policy page (public): renders docs/legal/PRIVACY_POLICY.md; shows a draft notice while the text is under legal review. |
| `apps/web/app/terms/page.tsx` | Terms of Service page (public): renders docs/legal/TERMS_OF_SERVICE.md; shows a draft notice while the text is under legal review. |
| `apps/web/lib/legal.ts` | Reads a legal text from docs/legal (bundled into the image via outputFileTracingIncludes) and renders it to safe HTML. |

### Privacy

| File | What it does |
|---|---|
| `apps/web/app/research/consent/page.tsx` | The link in the "Request reports" email: the exact research consent wording with Yes / No thanks; works without signing in; never indexed. |
| `apps/web/components/privacy/ConsentChoice.tsx` | Research consent from the email link: shows the exact wording, records Yes / No thanks once, then a thank-you; expired / answered / invalid states. |

<!-- FILES:END -->
