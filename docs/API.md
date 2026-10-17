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
| Me | `GET /me` | `{ user, credits, role }` (role read from the DB; the web uses it for the admin page) |
| Plans | `GET /plans` | Prices for the visitor's country (server-side); `mine` = the signed-in user's plans with usage and validity |
| Uploads | `POST /analyses` (alias `POST /uploads`) | Multipart fields below. Answers `202 { analysisId, status: "queued" }` |
| | `GET /analyses/:id` | `status`: `queued` → `parsing` → `analysing` → `storing` → `ready`, or `failed`. When ready, a `preview` with the numbers the upload screen shows. When failed, `message` is the engine's own sentence or the upload screen's text |
| Reports | `GET /reports` | History, newest first. Each item has `monthLabel` (`MON-YY`), `title`, `progressScore`, and `expiresAt: null` for v2 reports (D4) |
| | `POST /reports { analysisId, title? }` | Saves an analysis and spends one report from a valid plan. 402 `no_plan` / `plan_used_up` / `plan_expired` / `too_many_files` |
| | `POST /reports/:id/files { analysisId }` | The "+" button: the report now shows the new analysis of its old and new statements. Spends nothing. 402 `report_files_full` (file-set lock) |
| | `GET /reports/:id` | `{ summary, report, history, files, places }`: `files` = the statements with each one's own dashboard (2+ files), `places` = statements allowed / ever used (file-set lock); 410 `{ error: "expired" }` once deleted |
| | `POST /reports/:id/files/remove { fileId }` | × in the workspace: re-analyses the other statements (202 + analysisId); apply with `POST /reports/:id/files`. The removed statement keeps its place |
| | `GET /reports/:id/status` | The latest job for that report |
| | `PATCH /reports/:id { title }` | Rename (history only) |
| | `DELETE /reports/:id` | Removes the payload, trades and metrics, and shreds the files |
| Payments | `GET /payments/config`, `POST /payments/order`, `POST /payments/verify`, `POST /payments/webhook` | Modes `off \| razorpay` (link mode removed, D5). Only the webhook grants a plan, and it is idempotent. `POST /payments/order` takes an optional `source: "journey"` (REQ-2): it goes into the Razorpay order notes, and the webhook records `upgrade_from_journey` when that payment grants the plan |
| Admin | `GET /admin/metrics?tab=`, `POST /admin/roles`, `PATCH /admin/tickets`, `GET /admin/user?email=` | Role read from the DB on every request; every read is written to `audit_log` |
| | `POST /admin/grants { email, planId, reason }` | Owner only (`plans:grant`, D5). Plan values come from `PLANS`; the DB re-checks the owner role and the reason, and writes an audit row |
| Privacy | `GET /me/consents`, `POST /me/consents { purpose: "research", granted }` | Research consent is opt-in, off by default, append-only |
| | `POST /me/export` | 202; one open request at a time (the worker builds the archive in Phase 6) |
| | `POST /me/delete` or `DELETE /me` with `{ confirm: true }` | Deletes the account now: reports, trades and files are removed; payments and consent proof are kept |
| Telemetry | `POST /events`, `POST /errors` | Always 204. Event names must be in `CLIENT_EVENTS` (`packages/shared/src/admin/telemetry.ts`); visitors without a session may send only the landing events (`pricing_viewed`, `landing_scroll_depth`, `social_click`, `ig_section_view`, `ig_card_play`, `ig_card_click`, `ig_follow_click`; stored without a user) |

The old external URLs `/api/payments/webhook` and `/api/auth/google/callback` are registered too, so the Razorpay dashboard and the Google console need no change. Since the Phase 6 cutover Caddy sends every `/api/*` path to the API; the website has no API routes.

### Upload fields (`POST /analyses`)

| Field | Required | Meaning |
|---|---|---|
| `files` | 1–3 | `.xlsx .xls .csv .pdf .docx .doc`, each 10 MB or less. The real type is checked from the bytes, using the engine's own `detectKind()` plus a reject list |
| `consent` | `true` | "I agree to PnL Lens processing these files to build my report." Stored in `consents` with the policy version and a hash of the text |
| `research` | optional `true` | The separate research opt-in (unticked by default) |
| `currency` | optional | Currency override, as in today's app |
| `reportId` | optional | The "+" flow: the report's current statements are analysed again together with the new ones. 409 `files_expired` once those were deleted after 30 days |

What happens: the API checks the files, encrypts each one with its own key (AES-256-GCM; the key is wrapped by `FILE_KEK_<id>`) and stores it under a random key with a write-only storage key. It then writes the analysis, file and access-log rows in one transaction, records consent, and queues BullMQ job `analysis-<id>` on queue `analyses` (3 attempts, exponential backoff, failed jobs kept 7 days).

## Code map

| File | What |
|---|---|
| `src/main.ts` | Process entry: config, DB role check, Redis, storage, queue |
| `src/app.ts` | Plugins, CSRF hook, error handler, route registration, legacy aliases |
| `src/config.ts` | Env checks (fails fast) |
| `src/lib/sniff.ts` | Upload type check |
| `src/lib/storage.ts`, `src/lib/queue.ts` | S3 (Garage) and BullMQ adapters, with in-memory versions for tests |
| `src/routes/*.ts` | One file per area |
| `scripts/build.mjs` | esbuild bundle into `dist/main.js`. Workspace packages are inlined; npm packages stay external |

Shared code lives in `packages/shared` (auth, payments, RBAC rules, telemetry, mail, consent text, file encryption, job names), moved from `apps/web/lib` in Phase 4. The web app imports it through thin re-exports, so its behaviour is unchanged. Database access goes through `packages/db`.
