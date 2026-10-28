# API (apps/api)

Fastify 5, served under `/api/v1` behind Caddy. The machine-readable spec is `apps/api/openapi.json`. Regenerate it with `npm run openapi -w @pnl-lens/api`; a test fails if the committed file is stale. In dev it is also served at `/api/v1/openapi.json` (`EXPOSE_OPENAPI=true`).

Built in backend-v2 Phase 4. The web app still uses its own Next routes until the Phase 6 cutover.

## Conventions

| Topic | Rule |
|---|---|
| Session | httpOnly, Secure, SameSite=Lax cookie `lens_session` (HS256 JWT, `SESSION_SECRET`). Same cookie, secret and claims as the web app, so one sign-in works on both during the cutover. `AUTH_MODE=dev` makes every request the seeded dev user (dev stack only). |
| Errors | `{ "error": "<code>", "message": "<text for the user>" }` with `Cache-Control: no-store`. Codes and texts of the old routes are unchanged. The webhook answers in plain text, as before. |
| CSRF | Every POST, PUT, PATCH and DELETE must carry an `Origin` (or `Referer`) from `APP_URL`, or from `EXTRA_ALLOWED_ORIGINS`. Otherwise the API answers `403 csrf`. The Razorpay webhook is exempt because it is signature-checked. |
| Rate limits | 300 requests a minute per IP overall (Redis-backed in the stack). Sign-in routes: 20 a minute. Uploads: 30 a minute. Email codes: 5 an hour per email and 20 per IP (database). Analyses (D11): 20 a day and 3 running at once per user. |
| Body limits | JSON bodies up to 64 KB. Uploads: multipart, up to 3 files of 10 MB each. Caddy caps any request at 35 MB. |
| Database | Connects as `lens_app` only, and refuses to start as any other role or as a superuser (`assertRole`). Plans, credits and reports change only through the SQL functions (rule 5). |

## Endpoints

| Area | Method and path | Notes |
|---|---|---|
| Ops | `GET /health`, `GET /ready` | Ready checks Postgres (and that the role is `lens_app`), Redis and storage |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET /auth/google/start`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/providers` | Ported 1:1; providers tells the login page whether Google sign-in is configured |
| | `POST /auth/start { email }` | First step of the sign-in card: `{ method: "password" }` when the account has a password, otherwise a code is emailed now and `{ method: "code", sent, masked }`. (It tells whether an email has a password; per-IP limits slow probing.) |
| | `POST /auth/password/login { email, password, source? }` | Email + password → session cookie. One message for a wrong password or unknown email (`invalid_password`, 401); 10 failures lock password sign-in for 15 minutes (429 `locked`; codes still work). Audit: `password_failed`, login method `password` |
| | `POST /auth/password/set { password }` | Signed in. First password: right after the code (or for a Google user). Changing one needs a sign-in in the last 10 minutes (the "Forgot password?" code), else 403 `reauth_required`. Rules: 8–128 characters, not a common password, not the email (400 `weak_password` with the sentence). Other devices are signed out (`sessions_valid_after`); this one gets a fresh cookie |
| | `POST /auth/password/forgot { email }` | Emails a code to an existing account; the same `{ sent, masked }` for unknown emails (no account is created) |
| | `POST /auth/otp/verify` | Also returns `needsPassword: true` for an email account without a password (the page then asks for one) |
| Me | `GET /me` | `{ user, credits, reportsLeft, role, hasPassword, needsPassword }`: `reportsLeft` = unused reports of plans whose window is open (`user_reports_left()`, what customers see); `credits` is the internal mirror (admin only); (role read from the DB; `needsPassword` = an email account that must still set its password; never the hash) |
| Plans | `GET /plans` | Prices for the visitor's country (server-side); `mine` = the signed-in user's plans with usage and validity |
| Uploads | `POST /analyses` (alias `POST /uploads`) | Multipart fields below. Answers `202 { analysisId, status: "queued" }` |
| | `GET /analyses/:id` | The ready `preview` also carries `charges` and `insights` (titles of the 2 biggest insights) and `insightCount` for the free preview (credits spec rule 9). `status`: `queued` → `parsing` → `analysing` → `storing` → `ready`, or `failed`. When ready, a `preview` with the numbers the upload screen shows. When failed, `message` is the engine's own sentence or the upload screen's text |
| Reports | `GET /reports` | History, newest first. Each item has `monthLabel` (`MON-YY`), `title`, `progressScore`, and `expiresAt: null` for v2 reports (D4) |
| | `POST /reports { analysisId, title? }` | Saves an analysis and spends one report from a valid plan. 402 `no_plan` / `plan_used_up` / `plan_expired` / `too_many_files` |
| | `POST /reports/:id/files { analysisId }` | The "+" button: the report now shows the new analysis of its old and new statements. Spends nothing. 402 `report_files_full` (file-set lock) |
| | `PUT /reports/:id/capital { capital }` | Optional capital used for one of my reports (0028), > 0 and up to 100 billion, in the report's currency; `null` clears it. `GET /reports/:id` returns it as `capital`. Event `capital_set` |
| | `GET /me/prefs`, `PUT /me/prefs { weeklyDigest }` | Weekly summary email opt-in (0029, off by default). Event `weekly_digest_set` |
| | `POST /digest/unsubscribe { u, t }` | No sign-in: the "Stop these emails" link (`/unsubscribe?u=&t=`, the page posts this). `t` = HMAC of the user id with `IP_HASH_SECRET`; 400 `bad_link` otherwise. The sender is `src/lib/digest.ts` (Mondays from 09:00 IST, once a week, claimed in `digest_sends` before sending) |
| | `GET /reports/:id/benchmarks` | Owner only. `{ segment, segmentTraders, allTraders, minTraders: 50, enough, metrics: [{ key, label, value, higherIsBetter, better (0–1) \| null, group, traders }] }` from the nightly `benchmarks` table (0030): the report's segment if it has 50+ traders, else all traders, else `better: null` |
| | `GET /reports/:id/market` | Owner only, **India only**: `{ available: false, reason: "not_india" \| "no_dates" \| "no_market_data" }` or `{ available: true, from, to, nifty: { start, end, changePct }, bankNifty, yourPct, byVix, byMove, coverage }` from `market_daily` (0031), filled automatically by `src/lib/market-sync.ts` (Upstox public history, NSE fallback, hourly, gaps filled) |
| | `GET /me/journal`, `PUT /me/journal { tradeKey, setup?, tags?, emotion?, note? }`, `DELETE /me/journal?key=` | Trade journal (0027), the user's own notes only. A note with nothing in it is removed. `emotion` is one of calm, confident, fomo, fear, revenge, bored, tired, greedy; up to 8 tags of 30 characters, setup 60, note 1,000. Event `journal_saved` |
| | `GET /me/lifetime` | Lifetime view: `{ reports: [{ id, title, files, createdAt, currency, trades }] }` for the signed-in user's live reports, oldest first (the browser merges them, `packages/shared/src/insights/lifetime.ts`). `no-store` |
| | `GET /reports/:id` | `{ summary, report, history, files, places, planCheck }`: `files` = the statements with each one's own dashboard (2+ files), `places` = statements allowed / ever used (file-set lock), `planCheck` = the newest 30-day plan downloaded from an earlier report, scored on this one (`packages/shared/src/plan/score.ts`: per rule Met / Missed / not measurable, on the trades since the plan date when there are 5+, else the whole statement), or null; 410 `{ error: "expired" }` once deleted |
| | `POST /reports/:id/files/remove { fileId }` | × in the workspace: re-analyses the other statements (202 + analysisId); apply with `POST /reports/:id/files`. The removed statement keeps its place |
| | `GET /reports/:id/status` | The latest job for that report |
| | `PATCH /reports/:id { title }` | Rename (history only) |
| | `DELETE /reports/:id` | Removes the payload, trades and metrics, and shreds the files |
| Payments | `GET /payments/config`, `POST /payments/order`, `POST /payments/verify`, `POST /payments/webhook` | Modes `off \| razorpay` (link mode removed, D5). Only the webhook grants a plan, and it is idempotent. `POST /payments/order` takes an optional `source: "journey"` (REQ-2): it goes into the Razorpay order notes, and the webhook records `upgrade_from_journey` when that payment grants the plan |
| Admin | `GET /admin/metrics?tab=`, `POST /admin/roles`, `PATCH /admin/tickets`, `GET /admin/user?email=` | Role read from the DB on every request; every read is written to `audit_log` |
| | `POST /admin/grants { email, planId, reason }` | Owner only (`plans:grant`, D5). Plan values come from `PLANS`; the DB re-checks the owner role and the reason, and writes an audit row |
| | `GET /admin/research/exports`, `POST /admin/research/exports`, `GET /admin/research/exports/:id/download` | Owner only (`research:export`, role read from the DB). List with counts and the number of opted-in users; "Build now" (202, 409 `already_building`); download decrypts the ZIP (`no-store`) and writes `research_export_downloaded` to `audit_log`; expired or deleted → 404 |
| | `POST /admin/research/lookup { code, exportId?, reason }` | Owner only (checked again in `research_lookup()`, 0025). A subject code (64 hex) or a report code (24 hex, with the dataset it came from) → `{ kind, user: { id, email, status }, report: { id, name, createdAt, deleted } \| null }`. 400 `reason_required` / `export_required` / `invalid_code`, 404 when nothing matches. Every lookup is written to `audit_log` (`research_lookup`, with the reason); 30 a minute |
| | `GET /admin/users?q=&filter=all\|included\|not_included\|restricted&page=` | User management (owner, admin; each read audited `users_listed`). Per user: sign-in method, plan, live reports, status and restriction reason, research status (`included` = research consent yes + a live report, `opted_in`, `declined`, `asked`, `not_asked`), `canRequest` / `requestBlocked` |
| | `POST /admin/users/:id/research-invite` | Owner only. Emails the "Request reports" message with a personal one-click link (32-byte token; only its SHA-256 is stored; valid 30 days). 409 `not_allowed` with the reason: restricted, already opted in, no reports, link still open, asked < 90 days ago, said no < 6 months ago |
| | `POST /admin/users/:id/restrict { reason }`, `POST /admin/users/:id/unrestrict` | Owner, admin (`admin_set_user_status`, role checked in the DB; never yourself or an owner; admins not other admins). Restricting blocks sign-in and ends every session at once |
| | `POST /admin/users/:id/delete { reason, confirmEmail }` | Owner only (`admin_delete_user` → `delete_account`). The typed email must match; reports, trades and files removed, account anonymised, payments kept; audited with the reason |
| Research consent link | `GET /research/invite/:token`, `POST /research/invite/:token { answer: "yes"\|"no" }` | No sign-in (the email link). State `open` / `answered` / `expired` / `invalid` (never the email). The answer is single use and appends a `consents` row (research, the exact wording's hash, policy version, hashed IP) |
| Blog (public) | `GET /blog/posts?site=india\|global&tag=&page=` | Published posts for that site (posts marked for it or for `both`), newest first, 12 per page: `{ posts, total, page, pages }`. Scheduled posts appear once their time has passed. `Cache-Control: public, max-age=60` |
| | `GET /blog/posts/:slug?site=` | `{ post }` (with `body_html`, already safe), or `{ redirect: "<new-slug>" }` for an old address of a renamed post (the page answers with a permanent redirect), or 404 |
| | `GET /blog/tags?site=`, `GET /blog/feed?site=` | Tags in use; every published post (sitemap and RSS) |
| | `GET /blog/media/:key` | Blog images (WebP) from the public `media` bucket; immutable cache. Keys are random (`<32 hex>.webp`, `<32 hex>-og.webp`) |
| Blog (admin) | `GET /admin/blog/posts`, `GET /admin/blog/posts/:id`, `POST /admin/blog/posts`, `PATCH /admin/blog/posts/:id` | Owner and admin only (`blog:publish`; 403 for support, finance, analyst). The database re-checks the role and writes `audit_log`. The API renders the Markdown to safe HTML (`src/lib/markdown.ts`: no raw HTML, only http(s)/mailto/relative links, `rel="noopener"`, external links `nofollow` and new tab, `#` headings become H2) and computes the read time. 409 `slug_taken`, 400 `alt_required` (cover without alt text), 400 `invalid_slug` |
| | `POST /admin/blog/posts/:id/publish\|schedule\|unpublish\|archive\|delete` | `schedule` takes `{ at }` (ISO time with offset; the editor sends IST, `+05:30`); 400 `schedule_in_past`. `unpublish` makes it a draft again; `delete` is a soft delete. Renaming a published post records a redirect from the old slug |
| | `POST /admin/blog/render { markdown }` | Live preview with the same renderer |
| | `POST /admin/blog/media` | Multipart image, JPG/PNG/WebP checked by its bytes, 2 MB or less (413 / 415). sharp re-encodes it to WebP (up to 1600 px wide) plus a 1200×630 crop for cards and social sharing; returns `{ key, ogKey, width, height, url }` and writes an audit row |
| 30-day plan | `GET /reports/:id/plan.pdf` | Owner only (404 for anyone else, 410 for a deleted report; 20 a minute). Builds the plan from the stored report (`packages/shared/src/plan/build.ts`: 5 Do and 5 Don't rules with Why and Now → Target, scorecard, weekly check-in, check-up date = today + 30 days IST) and renders a 2-page A4 PDF (`src/lib/plan-pdf.ts`, pdfkit, fonts in `apps/api/assets/fonts`). `Content-Disposition: attachment; filename="pnl-lens-30-day-plan-DD-Mon-YY.pdf"`, `no-store`. Writes `audit_log` `plan_downloaded` and the event `plan_downloaded`, and saves a **plan snapshot** (`plan_snapshots`, 0026: one per report and IST day) so the next report can score it. When an earlier plan exists, page 1 opens with "Your last plan (date): X of Y measurable rules met." The PDF's links: Remind me → `/reminders/new?report=&date=`, Add to calendar → `/api/v1/plan.ics?date=`, Upload when ready → `/upload`. No email or user id in the file |
| | `GET /plan.ics?date=YYYY-MM-DD` | No sign-in: an all-day calendar event "PnL Lens check-up: upload your new statement" with the upload link; holds no personal data. 400 `bad_date` |
| | `GET /me/reminders`, `POST /me/reminders { reportId?, date }`, `DELETE /me/reminders/:id` | Check-up email reminder: one active per user (a new one replaces it); the date must be 1–60 days ahead (IST), the report the user's own. Sent once by the API from 09:00 IST (`src/lib/reminders.ts`, every 10 minutes; claimed in the DB before sending) |
| Privacy | `GET /me/consents`, `POST /me/consents { purpose: "research", granted }` | Research consent is opt-in, off by default, append-only |
| | `POST /me/export` | 202; one open request at a time (the worker builds the archive in Phase 6) |
| | `POST /me/delete` or `DELETE /me` with `{ confirm: true }` | Deletes the account now: reports, trades and files are removed; payments and consent proof are kept |
| Telemetry | `POST /events`, `POST /errors` | Always 204. Event names must be in `CLIENT_EVENTS` (`packages/shared/src/admin/telemetry.ts`); visitors without a session may send only the landing events (`pricing_viewed`, `landing_scroll_depth`, `social_click`, `ig_section_view`, `ig_card_play`, `ig_card_click`, `ig_follow_click`, `blog_view`, `blog_cta_click`, `blog_preview_click`; stored without a user). The API itself records `signup_from_blog` (first sign-in whose code check or Google `next` came from a blog article) and adds `source: "blog"` to `upload_started` |

The old external URLs `/api/payments/webhook` and `/api/auth/google/callback` are registered too, so the Razorpay dashboard and the Google console need no change. Since the Phase 6 cutover Caddy sends every `/api/*` path to the API; the website has no API routes.

### Upload fields (`POST /analyses`)

| Field | Required | Meaning |
|---|---|---|
| `files` | 1–3 | `.xlsx .xls .csv .pdf .docx .doc`, each 10 MB or less. The real type is checked from the bytes, using the engine's own `detectKind()` plus a reject list |
| `consent` | `true` | "I agree to PnL Lens processing these files to build my report." Stored in `consents` with the policy version and a hash of the text |
| `research` | optional `true` | The separate research opt-in (unticked by default) |
| `currency` | optional | Currency override, as in today's app |
| `source` | optional `blog` | The upload started from a blog article's "Analyse my trades" (`/upload?from=blog`); added to the `upload_started` event (REQ-7) |
| `reportId` | optional | The "+" flow (free, up to the report's plan limit; 402 `plan_expired` once that plan's window has ended, before anything is stored): the report's current statements are analysed again together with the new ones. 409 `files_expired` once those were deleted after 30 days |

What happens: the API checks the files, encrypts each one with its own key (AES-256-GCM; the key is wrapped by `FILE_KEK_<id>`) and stores it under a random key with a write-only storage key. It then writes the analysis, file and access-log rows in one transaction, records consent, and queues BullMQ job `analysis-<id>` on queue `analyses` (3 attempts, exponential backoff, failed jobs kept 7 days).

## Code map

| File | What |
|---|---|
| `src/main.ts` | Process entry: config, DB role check, Redis, storage, queue |
| `src/app.ts` | Plugins, CSRF hook, error handler, route registration, legacy aliases |
| `src/config.ts` | Env checks (fails fast) |
| `src/lib/sniff.ts` | Upload type check |
| `src/lib/markdown.ts` | Blog Markdown → safe HTML (markdown-it 15.0.2), read time, slugs |
| `src/lib/storage.ts`, `src/lib/queue.ts` | S3 (Garage) and BullMQ adapters, with in-memory versions for tests |
| `src/routes/*.ts` | One file per area |
| `scripts/build.mjs` | esbuild bundle into `dist/main.js`. Workspace packages are inlined; npm packages stay external |

Shared code lives in `packages/shared` (auth, payments, RBAC rules, telemetry, mail, consent text, file encryption, job names), moved from `apps/web/lib` in Phase 4. The web app imports it through thin re-exports, so its behaviour is unchanged. Database access goes through `packages/db`.
