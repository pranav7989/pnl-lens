# Backend v2 — Plan

**Status:** APPROVED 2026-10-11, with the changes recorded in §2. **Phase 1 done**, **Phase 2 done** (2026-10-11), **Phase 3 done**, **Phase 4 done**, **Phase 5 done**, **Phase 6 done**, **Phase 7 done**, **Phase 8 done** (2026-10-12, branch `backend-v2`) except the steps that need the owner: `provision.sh` on a real Ubuntu machine and the go-live checklist (`docs/GO_LIVE_CHECKLIST.md`).
**Goal:** move parsing and analysis from the browser to the server, and store raw files, normalised trades and computed metrics. Everything runs on one Ubuntu 24.04 VM with Docker Compose. AI/ML is out of scope; the data model is only made ready for it.

Sections: 1 Findings · 2 Decisions needed · 3 Architecture · 4 Services and network · 5 Engine and parity · 6 Pipeline · 7 Data model · 8 API · 9 Enforcement · 10 Privacy and security · 11 Front end · 12 Infra and operations · 13 Testing · 14 Phases · 15 Risks

---

## 1. What the current code tells us (findings)

| # | Finding | Where | Consequence for v2 |
|---|---|---|---|
| F1 | The engine is plain JS with injected libraries (XLSX, CFB, pdfjs). It already runs in Node; the unit tests do this. | `lib/engine/*`, `tests/extract.test.ts` | It can move to `packages/engine` byte-for-byte. Only a thin Node runner is new. |
| F2 | Output is not fully deterministic: `generatedAt = new Date()`. | `lib/engine/index.ts:43` | Golden tests ignore `generatedAt` only. Every other byte must match. |
| F3 | The date fallback `new Date(s)` parses in the **local timezone**. | `lib/engine/engine.js:58` | Results can differ between a browser in IST and a server in UTC. The worker and tests pin `TZ`. The value is decision D9. **Measured in Phase 1:** under UTC, 9 of 22 golden cases differ (the CSV tradebooks), so this is not an edge case. |
| F4 | The engine has module-level state (`CUR`, set by `setCurrency` inside `analyze`) that is used to format money in leak/rule text. | `engine.js:33–41, 512` | `analyze()` is synchronous, so jobs in one Node process can't interleave inside it. The worker must never `await` between `setCurrency` and the end of `analyze`. This holds today. |
| F5 | Money text uses `toLocaleString('en-IN')`, which depends on ICU. | `engine.js:37` | Node 22 official images ship full ICU. Golden tests run in the same image as the worker. |
| F6 | The server enforces only "credits > 0". `create_report_with_credit` ignores `subscriptions.files_per_report`, `ends_at` and `reports_used`. Expiry is a flat `REPORT_TTL_DAYS`, not the plan's `retentionDays`. | `0003_functions.sql`, `pg-store.ts` | Rule 5 is not met today. New SQL functions are needed (§9). |
| F7 | The server trusts report numbers computed in the browser ("validates structure, not arithmetic"). | `lib/api/validate.ts`, HANDOFF §5 | This goes away: the server computes every report. |
| F8 | UI wording promises files are **never uploaded**, in 5 places. | `Landing.tsx:112,162,231,239`, `upload/page.tsx:20` | It becomes false after v2. This conflicts with rule 8; see D1. |
| F9 | `docker-compose.yml` contains DB passwords (`adminpw`, `apppw`). | repo root | Rule 2: remove them, take values from `.env`, and rotate anything that was ever deployed with them. |
| F10 | **Resolved for the server in Phase 5: the engine uses SheetJS 0.20.3.** `xlsx@0.18.5` has published advisories (prototype pollution, ReDoS). It was "browser-only, user's own files" before; it now parses **strangers' files on our server**. | `package.json` | Sandbox the parser (§10). Upgrading SheetJS may change output, so it is a separate step with its own golden diff (D10). |
| F11 | `link` payment mode says plans "are then granted by an admin". | `lib/payments/config.ts` | This conflicts with rule 6; see D5. |
| F12 | The report validator allows 4-letter currencies (`USDT` is in `CURSYM`), but `reports.currency` is `char(3)`. | `validate.ts:26`, `0001_schema.sql` | Latent insert failure. v2 uses `text` in new tables and will check whether the engine can emit `USDT`. |
| F13 | There is no lint script and no ESLint config. The folder is not a git repo. | `package.json` | Phase 1 adds ESLint and `git init` (D13). |
| F14 | The offline single-file tool uses the browser engine. | `offline/` | It keeps working unchanged: `packages/engine` stays browser-compatible. |
| F15 | The manual column mapper (`remap` in the worker) exists in code but has no UI. | `workers/analyze.worker.ts` | Not exposed by the API (the user is never asked to map columns). |

---

## 2. Decisions (approved 2026-10-11)

| # | Decision |
|---|---|
| **D1** | Rewrite the privacy strings that become untrue. **The new wording is shown to the owner before it is applied** (proposal in §2.1; applied in Phase 6). Tone: simple and reassuring. All other wording stays word-for-word. |
| **D2** | Consent at upload: one required checkbox, plus one optional research checkbox that is unticked by default (default accepted). Exact text in §2.1, for sign-off with D1. |
| **D3** | **Raw files are kept 30 days after upload, then deleted automatically.** Unsaved previews (drafts) are deleted after 24 h. The user can delete files sooner. |
| **D4** | **Reports and trades do not expire.** They stay until the user deletes the report or closes the account. A plan's validity (`ends_at`) and allowance only control creating **new** reports. Plan `retentionDays` is not used for expiry. |
| **D5** | **Link mode is removed.** `PAYMENTS_MODE` becomes `off \| razorpay`; plans are granted by the verified Razorpay webhook. **Approved exception to rule 6:** an **owner-only manual grant** in the admin console for support cases. The role is checked in the DB, a reason is required, and every grant is written to `audit_log` with the acting owner. |
| **D6** | Users with credits but no subscription: the dev seed creates a real subscription, and the new SQL refuses balance-only credits (default). |
| **D7** | **No live users. Fresh start; nothing to migrate** from DigitalOcean. |
| **D8** | Cloudflare stays proxied in front of the VM (default). |
| **D9** | **Server timezone pinned to `Asia/Kolkata`** for the engine, the worker and the golden tests. |
| **D10** | Isolated, memory-limited parsing with no network access. **SheetJS upgrade is a separate step with its own parity check** (Phase 5). |
| **D11** | Free preview stays; 20 analyses per user per day, 3 running at once (default). |
| **D12** | Offsite backups: DigitalOcean Spaces through `restic`, encrypted (default). |
| **D13** | `git init`, commit the current tree to `main`, branch `backend-v2` (default). |
| **F9** | **All passwords move out of `docker-compose.yml` into `.env` (git-ignored); new random ones are generated.** Done in Phase 1. |
| **D14** | **MinIO replaced by Garage** (approved 2026-10-11, Phase 2). MinIO's free Docker images are no longer published: every tag on Docker Hub and quay.io is gone or needs an account. Garage `dxflrs/garage:v2.4.1` is S3-compatible, single-container and built for small self-hosted servers. Per-key bucket permissions give the API **write-only** and the worker read+write. App code is unaffected: files are encrypted by the app and stored through the standard S3 API. Wherever this plan says "MinIO", read "Garage". |
| **D15** | **Master-prompt data items added** (approved 2026-10-12, Phase 3). The first draft of §7 left out `parse_runs`, `fills`, `report_traits`, `data_requests` and `reports.title` / `month_label` / `fingerprint`. They are added in the migration where each belongs (0009–0011), not in a separate 0015. `report_files` is replaced by `analysis_files` plus `reports.used_fingerprints`, which also covers the "+" flow. |
| **D16** | **Phase 4 API choices** (2026-10-12). (a) Uploads are buffered in memory (≤ 10 MB each, at most 3) and type-checked before anything is stored, instead of being streamed into storage. (b) Account deletion (`DELETE /me`) runs at once; `data_requests` is used for exports. (c) "+" on a report whose statements were purged after 30 days answers 409 `files_expired` (safe default until the owner decides; see §15). (d) The API is bundled with esbuild, because the workspace packages ship TypeScript source. (e) Every state-changing request needs a same-site `Origin`/`Referer` (CSRF), in addition to SameSite=Lax cookies. (f) Engine error sentences are kept word for word in `analyses.error_message` (migration 0015). |
| **D17** | **Phase 5 worker choices** (2026-10-12). (a) The engine runs in a child process per job (`--max-old-space-size`, SIGKILL on timeout), instead of BullMQ's sandboxed processor, so each job gets fresh engine state and a hard memory cap. (b) File problems are final (not retried); only infrastructure errors are retried, 3 attempts with exponential backoff, then dead letter. (c) Fills come from the engine's own `parseSheetAuto` (read-only use). (d) `engine_version` is a hash of the engine sources. (e) New user texts for cases the browser never had: parse timeout, parse out of memory, files purged (see `docs/WORKER.md`). |
| **D18** | **Phase 6 web choices** (2026-10-12, owner decisions: port the workspace UI, apply §2.1 as written, refuse "+" after 30 days, backups 14/8/12, production = scripts + local VM). (a) The offline tool's workspace (file tabs, All files, +, ×, plan card, MON-YY history with rename) is now the website's upload and report view; the offline tool keeps its own copy. (b) With a plan that has reports left, analysing creates the report at once (as offline); without one, the website's free preview card is shown (D11). (c) "+" sends `consent=true`: the processing consent ticked when the report was started covers statements added to it (lawyer check in PRIVACY_NOTES). (d) The report renderer says check-ups are saved "in your account" on the website ("on this device" stays in the offline tool). (e) `/dashboard` shows the plan card and the month-grouped history instead of the old table with expiry badges (W6/W8). (f) Next.js 14.2.35 → 15.5.26 + React 19 for critical security fixes, UI pixel-identical. |
| **D19** | **Phase 7 privacy and hardening choices** (2026-10-12). (a) Export: a ZIP with all data as JSON plus the original statements still stored, built by the worker through `export_user_data()` (the only path to accounts/payments for the worker, and only for an export in progress), encrypted, kept 7 days in a separate `exports` bucket (worker write/delete, api read-only). (b) Log retention enforced: usage/error events 12 months, audit/file-access logs 24 months (`purge_logs`, configurable; LAWYER CHECK). (c) Sessions require an active account on every request (blocking or deleting ends sessions at once). (d) A single `safeNext()` for post-sign-in redirects. (e) CSP set in Caddy with `'unsafe-inline'` (Next.js hydration without nonces); nonces are a later step. (f) Dependency audit fails CI except for allow-listed advisories with a reason and an end date. |
| **Location** | The project lives at `C:\Users\drvvl\Documents\pnl-lens`. The Downloads copy is the untouched original. |

### 2.1 Proposed wording (NOT applied; needs owner sign-off before Phase 6)

D1 and D4 change what is true about storage and expiry. Each string below is proposed; nothing in the UI has been changed.

| # | Where | Today | Proposed |
|---|---|---|---|
| W1 | `Landing.tsx:112` FAQ "Are my files stored?" | No. Files are read inside your browser and never uploaded. Only the finished report is saved to your account, and it is removed when your plan’s access period ends. | Yes, safely. Your files are encrypted and processed on our secure servers to build your report. The original files are deleted automatically after 30 days, and you can delete your files, reports or whole account anytime. |
| W2 | `Landing.tsx:162` hero trust line | Private, read in your browser | Private and encrypted |
| W3 | `Landing.tsx:231` how-it-works step | One file per broker statement. Read on your device. | One file per broker statement. Encrypted on upload. |
| W4 | `Landing.tsx:239` card "Private by design" | Files are read in your browser. Reports are removed when your plan ends. | Your files are encrypted, processed on our secure servers, and you can delete them anytime. |
| W5 | `upload/page.tsx:20` | Your files are read in this browser tab and never uploaded. Only the finished report is saved. | Your files are encrypted, processed on our secure servers, and deleted automatically after 30 days. You can delete them anytime. |
| W6 | `dashboard/page.tsx:29` (D4) | Reports stay available for 30 days, then they are deleted automatically. | Your reports stay here until you delete them. |
| W7 | `report/[id]/page.tsx:24–25` (D4; page now shown only for deleted reports) | **This report has expired** · Reports are deleted 30 days after they are created. Upload your files again to generate a fresh one. | **This report was deleted** · Upload your files again to generate a fresh one. |
| W8 | `dashboard/page.tsx:51`, `ReportView.tsx:50` expiry badges (D4) | "N days left" / "Expires in N days" / "Expired" | Badge removed (reports no longer expire); "Expired" becomes "Deleted". |
| W9 | Upload page, new (D2) | — | ☐ *I agree to PnL Lens processing these files to build my report.* (required) |
| W10 | Upload page, new (D2) | — | ☐ *Also let PnL Lens use my data, anonymised, to improve its analysis. Optional — you can change this anytime.* (unticked) |
| W11 | Admin console, new (D5) | — | Owner-only "Grant plan" form on the Support → user lookup panel: plan, reason (required), confirm. |

---

## 3. Target architecture

```
Internet ──► Cloudflare (DNS, proxy, CF-IPCountry)
               │ 443 only
┌──────────────▼──────────────────────── Ubuntu 24.04 VM (ufw: 22, 80, 443) ─────────────────┐
│  caddy  (only container with published ports)                                              │
│    /api/*  ──────────────► api    (Fastify, :4000)                                         │
│    /*      ──────────────► web    (Next.js, :3000) ── server components ─► api (internal)  │
│  ─────────────────────── network: edge ───────────────────────────────────────────────────  │
│  api ─┬─► postgres 16  (lens_app)                                                          │
│       ├─► redis 7      (BullMQ: enqueue)                                                   │
│       └─► minio        (put encrypted raw files)                                           │
│  worker ─► redis (consume) · minio (get) · postgres (lens_worker)                          │
│  ─────────────────────── network: internal (internal: true, no egress) ────────────────────  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
External from api only: Resend/SES (email), Google (OIDC), Razorpay (orders, webhook in)
```

### Monorepo layout (npm workspaces)

| Path | Contents | Comes from |
|---|---|---|
| `apps/web` | Next.js 14 front end: same pages, components, CSS, `lib/report-ui`, `public/`, `offline/`. No `app/api` routes, no direct DB access. | `app/`, `components/`, `lib/report-ui`, `public/`, `offline/` |
| `apps/api` | Fastify REST API under `/api/v1`. OpenAPI generated from zod schemas. Auth, reports, analyses/uploads, payments, admin, events/errors, health. | `app/api/**`, `lib/auth`, `lib/payments`, `lib/admin`, `lib/mail`, `lib/api` |
| `apps/worker` | BullMQ workers: parse → normalise → analyse → store; scheduled purge and cleanup. | `workers/analyze.worker.ts` (logic), `scripts/purge.mjs` |
| `packages/engine` | **The existing engine files, unchanged**, plus `node.ts` (a Node runner that injects XLSX/CFB/pdfjs) and the golden tests. | `lib/engine/*` |
| `packages/db` | Migrations (0001–0007 moved with identical filenames, plus new ones), migration runner, typed queries (Kysely), role setup, SQL tests. | `db/`, `scripts/migrate.mjs`, `lib/db.ts` |
| `packages/shared` | Plans/pricing, zod schemas (API contracts), shared types (`ReportV1`, …), limits. | `lib/pricing.ts`, `lib/config.ts`, `lib/engine/types.ts` (re-exported) |
| `infra/` | `compose.dev.yml`, `compose.prod.yml`, `Caddyfile`, Dockerfiles, Postgres init, MinIO bootstrap, VM provisioning, backup and restore scripts. | new |

Migration filenames stay identical, so `schema_migrations` on an existing database does not re-apply them.

---

## 4. Services

| Service | Image | Networks | Published | Notes |
|---|---|---|---|---|
| caddy | `caddy:2` | edge | **80, 443** | TLS, HSTS and the security headers now in `next.config.mjs`. 35 MB request body limit on upload routes. Real client IP from Cloudflare only. |
| web | `node:22-slim` (Next standalone) | edge | — | Talks to `api` at `http://api:4000` for server-side rendering, forwarding the session cookie. |
| api | `node:22-slim` | edge, internal | — | DB role `lens_app`. The only service that receives user uploads. |
| worker | `node:22-slim` | internal | — | DB role `lens_worker`. Parsers run in sandboxed child processes (§10). `TZ` per D9. |
| postgres | `postgres:16` | internal | — (dev: `127.0.0.1:5432`) | Superuser used only by migrations. Init script creates roles with passwords from env. |
| redis | `redis:7` | internal | — | `requirepass`, AOF on, `maxmemory-policy noeviction` (required by BullMQ). |
| minio | `minio/minio` (pinned) | internal | — (dev console on `127.0.0.1` only) | One private bucket `statements`. Per-service access keys with least-privilege bucket policies. |

`internal` is a Docker network with `internal: true`, so worker, postgres, redis and minio have no internet access. Only `api` reaches the outside (email, Google, Razorpay).

---

## 5. Engine move and parity (rule 1)

1. **Baseline first, before moving anything (Phase 1, step 1).** Using the *current* `lib/engine`, generate golden JSON for every fixture in `tests/fixtures/` (14 files). Also cover:
   - multi-file combinations already used in the tests (tradebook + Groww statement, tradebook + same-account statement)
   - the `currency: 'EUR'` override
   - PDF, DOCX and DOC through `fileToRawSheets`.

   Goldens are stored as `packages/engine/test/golden/*.json`. They contain `report` (the serialised ReportV1) and also `result.m` and `result.trades`, so the parity check covers more than the serialised subset. `generatedAt` is replaced with a constant. `TZ` is pinned per D9.
2. **Move:** `git mv lib/engine/{engine.js,behaviour.js,extract.js,index.ts,types.ts} packages/engine/src/`. The file contents do not change (the `@file` path line in each header is the only edit and is reviewed explicitly). Old import paths are re-exported for the web app.
3. **Parity test:** for each golden, run the moved engine through the **Node runner** (the same code path the worker uses) and assert deep equality, with byte-equal `JSON.stringify`.
4. **Browser equals Node (one-off proof):** a Playwright script runs the same fixtures through the current browser Web Worker and diffs the result against the goldens. This shows that server results equal what users saw before. Any difference is reported (expected only from F3).
5. Parity runs in `npm test` and in CI on every commit. An engine change later needs a deliberate golden update that is reviewed in the diff.

The `packages/engine` public API is unchanged (`runAnalysis`, `analyzeRaw`, `serializeReport`, `formatterFor`, `engine`). New: `analyzeFiles(files, { currency })` in `node.ts`. It calls `fileToRawSheets` for each file, then `analyzeRaw`, which is exactly what the browser did.

---

## 6. Processing pipeline (apps/worker)

```
POST /api/v1/analyses (multipart, ≤3 files, ≤10 MB each, consent=true)
  api: check type by magic bytes and extension · sha256 · encrypt (AES-256-GCM, per-file key)
       · put to MinIO · insert statement_files + analysis(status=queued) · log access(write)
       · enqueue BullMQ flow
          ├─ parse:file  (one child job per file, sandboxed, 60 s timeout, 512 MB memory cap)
          │     get object (logged) → decrypt → fileToRawSheets → raw sheets kept in Redis/temp (not stored)
          └─ analyse (parent, runs when all children finish)
                analyzeRaw(all sheets together)  ← engine needs all files at once (combining logic)
                normalise: engine trades → `trades` rows · m → `report_metrics` · per-file trade fingerprints
                store: one transaction → analysis.status = ready, payload = ReportV1
GET /api/v1/analyses/:id  → status + preview fields (positions, period, market, currency, net, #leaks, #rules)
POST /api/v1/reports {analysisId}  → create_report_from_analysis(): spends the plan allowance (§9)
```

- Stages are recorded in `analyses.stage` (`queued` → `parsing` → `analysing` → `storing` → `ready` | `failed`), so the existing "Analysing…" loader can follow real progress.
- Failures map to the **existing user messages** (scanned PDF, "No closed trades found…", "Word support…") via `error_code`. The browser shows the same text it does today.
- Retries: 2 for infrastructure errors (Redis/MinIO/DB). A parse error is final and is not retried.
- Idempotent: the store step upserts on `analysis_id`, so a re-run job cannot duplicate trades.
- Concurrency: 2 jobs per worker container (D11 caps each user).
- Scheduled jobs (BullMQ repeatable, 02:00 IST): delete raw files older than 30 days (D3) and unclaimed drafts older than 24 h, including their MinIO objects (logged); remove OTP codes older than 7 days (HANDOFF §3 phase 7 item). Reports and trades are never purged by time (D4).

---

## 7. Data model (new migrations 0008+ only; 0001–0007 untouched)

As built in Phase 3 (2026-10-12). Master-prompt items that the first draft of this section left out (`parse_runs`, `fills`, `report_traits`, `data_requests`, `reports.title` / `month_label` / `fingerprint`) were added in the migration where each belongs (decision **D15**).

| Migration | Adds |
|---|---|
| `0008_roles_v2.sql` | `lens_worker`, `lens_research` (both NOLOGIN in SQL; `setup-roles.mjs` turns on LOGIN for `lens_worker` only). Worker may write `error_events`. |
| `0009_files_analyses.sql` | `analyses`, `statement_files`, `analysis_files`, `file_access_log`, `parse_runs` |
| `0010_trades_metrics.sql` | `trades`, `fills`, `report_metrics`, `report_traits`, view `current_trades`; `reports` gains `analysis_id`, `engine_version`, `subscription_id`, `title`, `month_label`, `used_fingerprints`, `fingerprint`; `reports.currency` becomes `text` (F12) |
| `0011_consents.sql` | `consents` (append-only), view `user_consent_current`, `data_requests` |
| `0012_plans_v2.sql` | `create_report_from_analysis()`, `add_analysis_to_report()` (file-set lock), `admin_grant_plan()` (owner-only, D5); `subscriptions.granted_by` / `grant_reason` and a "has a source" check; `lens_app` loses INSERT/UPDATE on `credits` and `reports` (keeps UPDATE of `reports.title`); `grant_plan()` no longer executable by PUBLIC |
| `0013_purge_v2.sql` | `purge_raw_files()` (30 days, D3), `purge_drafts()` (24 h), `purge_otp_codes()` (7 days), `delete_report_v2()`, `delete_account()`; `users.status` may be `deleted` |
| `0014_research_ready.sql` | `research` schema: pseudonymised views for users whose current research consent is granted; HMAC key generated inside the DB; SELECT for `lens_research` (NOLOGIN) only |

### Model in one paragraph
An **upload** creates one `analyses` row (a job) and 1–3 `statement_files`, linked by `analysis_files`. The worker stores the engine output for that analysis (`payload` plus `trades`, `report_metrics`, `report_traits`, `fills`, `parse_runs`) in one transaction. **Saving** calls `create_report_from_analysis()`: one report is spent from a valid plan and the report points at that analysis. The **"+" button** uploads the new file(s) as a new analysis that also reads the report's existing files (`target_report_id`). `add_analysis_to_report()` then swaps the report to the new analysis, enforcing the file-set lock and spending nothing. Derived rows are keyed by analysis and never rewritten. `reports.analysis_id` marks the current analysis, and the view `current_trades` gives "the trades of a user's live reports" without double counting.

### Tables (main columns)

**analyses:** `id`, `user_id`, `target_report_id` ("+" flow), `status` (`queued → parsing → analysing → storing → ready | failed`; one column, the separate `stage` was folded in), `error_code`, `currency_override`, `file_count` (1–3), `engine_version`, `payload jsonb` (ReportV1, nulled once claimed), `attempts`, `created_at`, `started_at`, `finished_at`, `expires_at` (now + 24 h), `report_id`, `claimed_at`.

**statement_files:** `id`, `user_id`, `original_name`, `ext` (allow-list), `detected_kind` (`sheet|pdf|docx|doc|rtf`), `mime`, `size_bytes` (≤ 10 MB), `sha256`, `storage_key` (random), `enc_alg`, `enc_key_id`, `wrapped_dek`, `iv`, `fingerprint` (file-set lock, same rule as the offline tool), `status` (`stored|purged|deleted`), `created_at`, `delete_after` (now + 30 days), `purged_at`, `object_deleted_at`. **Purging deletes the wrapped key** (crypto-shredding), so the object is unreadable everywhere, backups included. The worker then deletes the object itself, because the api's storage key is write-only.

**analysis_files:** `analysis_id`, `file_id`, `user_id`, `position`. Composite foreign keys on `(id, user_id)` mean an analysis can never read another user's file. This replaces the draft's `report_files`: a report's files are those of its current analysis, and its lock is `reports.used_fingerprints`.

**parse_runs:** one row per file per engine run: `engine_version`, `detected_broker`, `detected_format`, `column_mapping` (headers only), `warnings`, `sheet_count`, `trade_count`, `duration_ms`, `outcome` (`ok|no_trades|error|timeout`), `error_code`. Lets old files be re-run when the engine improves, while the raw file still exists.

**trades:** one row per engine trade, all `TRADE_FIELDS` (`numeric(20,6)` for money and quantity, `date` for dates), plus `option_type` (generated from `kind`), `strike` / `broker` / `source_row` (nullable; the engine does not emit them yet), per-trade `fingerprint`, `engine_version`. `unique (analysis_id, seq)` makes the store step idempotent.

**fills:** raw executions from tradebooks (`side`, `qty`, `price`, `fees`, `trade_date`, `trade_time`, `exchange`, `order_ref`, …). The worker fills it in Phase 5 from the parsed sheets, because ReportV1 has no fills.

**report_metrics:** per analysis: the scalar fields of `m` as columns, `progress_score`, `extra jsonb` (the rest of `m`). Feeds Progress history.

**report_traits:** per analysis: `trait_id`, `area`, `name`, `score`, `level`, `is_primary` (traits vs more), `evidence jsonb` (`now`, `why`, `ideal`).

**reports (new columns):** `analysis_id` (current), `engine_version`, `subscription_id`, `title` (rename, ≤ 120 chars), `month_label` (`MON-YY` of creation in IST, e.g. `OCT-26`), `used_fingerprints` (every statement ever accepted: removing a file never frees its place), `fingerprint` (hash of the current file set). New reports get `expires_at = 'infinity'` (D4).

**file_access_log:** `file_id` (no FK, so the log outlives the file), `owner_user_id`, `actor_kind`, `actor_user_id`, `action` (`write|read|decrypt|delete`), `reason`, `job_id`, `ip`. Roles can only INSERT; `lens_app` can also SELECT, for the admin console.

**consents:** `user_id`, `purpose` (`processing|research`), `granted`, `policy_version`, `text_sha256`, `ip_hash` (an HMAC of the IP, never the raw IP), `user_agent`, `created_at`. Never updated; the latest row wins. No research row means off.

**data_requests:** `user_id`, `kind` (`export|delete`), `status` (`pending|processing|done|failed|cancelled`), `result_key`, `error_code`, timestamps. At most one open request of each kind per user.

### Indexes (and the query each one serves)

| Index | Query |
|---|---|
| `analyses (user_id, created_at desc)` | the user's analyses; D11 "20 per day" count |
| `analyses (user_id) where status in (queued…storing)` | D11 "3 running at once" (tiny partial index) |
| `analyses (expires_at) where claimed_at is null` | `purge_drafts()` |
| `analyses (report_id) where report_id is not null` | report → analyses (delete, "+" history) |
| `statement_files (user_id, created_at desc)` | the user's files, export |
| `statement_files (delete_after) where purged_at is null` | `purge_raw_files()` (30 days) |
| `statement_files (purged_at) where purged_at is not null and object_deleted_at is null` | the worker's object sweep |
| `analysis_files (file_id)` | "is this file still used by any analysis?" |
| `file_access_log (file_id, created_at)`, `(owner_user_id, created_at desc)` | a file's access history; the user's access history (admin, export) |
| `parse_runs (file_id, created_at desc)`, `(engine_version, outcome)` | a file's runs; re-run campaigns ("files engine X failed on") |
| `trades (analysis_id)` (+ unique `(analysis_id, seq)`) | a report's trades in order |
| `trades (user_id, exit_date)` | a user's trade history by close date (Progress, analytics) |
| `fills (analysis_id)` | a report's fills |
| `report_metrics (user_id, to_date)` | Progress history |
| `report_traits (user_id, trait_id)` | a trait over time for one user |
| `consents (user_id, purpose, created_at desc, id desc)` | the latest consent per purpose |
| `data_requests (user_id, requested_at desc)`, `(status, requested_at) where open`, unique `(user_id, kind) where open` | the user's requests; the worker queue; one open request per kind |

### Rendering source of truth
`reports.report` (ReportV1 jsonb) stays the payload the UI renders, so the renderer and old reports keep working. `trades`, `report_metrics` and `report_traits` are written from the **same engine run** in the same transaction, so they cannot disagree with the payload. Phase 3 tests check this against all 21 golden reports.

### "Ready for AI" means only this
Stable IDs, `engine_version` on every derived row, normalised numeric trades, per-file links, parse runs, consent history, and a `research` schema whose views include only users whose latest research consent is granted and whose account is active. In those views `user_id` is replaced with an HMAC pseudonym, and there is no email, name, file name, file id, source row or broker client id. No model, feature store or training code. `lens_research` gets no login until a future, separately approved phase.

### Roles

| Role | Used by | Can |
|---|---|---|
| migrator (superuser) | `npm run db:migrate` only | DDL |
| `lens_app` | api (and web until Phase 6) | SELECT on its tables; INSERT on uploads, analyses, consents, data requests, access log; UPDATE of `reports.title` only; EXECUTE on the claim, add-files, delete, delete-account, manual-grant and webhook functions. No DELETE, no DDL, no direct writes to credits, subscriptions or report contents. |
| `lens_worker` | worker | SELECT on jobs, files and links; UPDATE of job status columns, `statement_files.fingerprint` / `object_deleted_at`, `data_requests` status; INSERT on trades, fills, metrics, traits, parse runs, access log, error events; EXECUTE on purge jobs and `delete_account`. Nothing on users, payments, credits, subscriptions, consents or reports. |
| `lens_research` | nobody yet (NOLOGIN) | SELECT on `research.subjects`, `research.trades`, `research.report_metrics`, `research.report_traits` only |

---

## 8. API (apps/api, Fastify)

**As built (Phase 4): see `docs/API.md`** for every endpoint, field and limit; the spec is `apps/api/openapi.json`. Endpoint names follow this section, plus the master-prompt names as aliases (`POST /uploads`, `GET /reports/:id/status`, `GET /plans`, `POST /me/export`, `POST /me/delete`), `PATCH /reports/:id` (rename) and `POST /reports/:id/files` ("+"). The draft below is kept for history.

- `/api/v1/*`, zod schemas through `fastify-type-provider-zod`; OpenAPI from `@fastify/swagger` and written to `apps/api/openapi.json` in CI. The docs UI is served in dev only.
- Plugins: `@fastify/cookie` (same `lens_session` JWT, same secret, so existing sessions stay valid), `@fastify/multipart` (stream, hard limits), `@fastify/rate-limit` (Redis store), pino logging with PII redaction.
- Every existing route is ported with the **same behaviour and response shapes**:

| Area | v1 endpoints |
|---|---|
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET /auth/google/start`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /me` |
| Analyses (new) | `POST /analyses` (multipart + consent), `GET /analyses/:id` |
| Reports | `GET /reports`, `POST /reports {analysisId}`, `GET /reports/:id`, `DELETE /reports/:id` |
| Payments | `GET /payments/config`, `POST /payments/order`, `POST /payments/verify`, `POST /payments/webhook` (modes `off \| razorpay`; link mode removed, D5) |
| Admin | `GET /admin/metrics?tab=`, `POST /admin/roles`, `PATCH /admin/tickets`, `GET /admin/user?email=`, `POST /admin/grants` (owner only, D5) |
| Telemetry / ops | `POST /events`, `POST /errors`, `GET /health` (liveness), `GET /ready` (checks DB, Redis, MinIO) |
| Privacy (new) | `GET/POST /me/consents`, `DELETE /me` (account deletion, HANDOFF phase 7) |

- **External URLs stay valid:** `/api/payments/webhook` and `/api/auth/google/callback` are also registered at their current paths, so the Razorpay dashboard and Google console need no change at cutover.
- `POST /api/reports` with a browser-built report (the old contract) is **removed**. The server never accepts report numbers from a client again.

---

## 9. Server-side enforcement (rule 5, rule 6)

`create_report_from_analysis(p_user, p_analysis)`: one `SECURITY DEFINER` transaction.
1. Lock the analysis: it must be owned by `p_user`, `status = ready`, and not yet claimed.
2. Choose a subscription `FOR UPDATE`: `ends_at > now()`, `reports_used < reports_total`, `files_per_report >= analysis.file_count`. Pick the earliest-ending one.
3. If none matches, raise the specific reason (`no_plan` | `plan_expired` | `plan_used_up` | `too_many_files`). The API maps each reason to the existing 402 message.
4. `reports_used += 1`; `credits.balance -= 1` (kept in sync, because the header and dashboard show credits).
5. Insert the report with `expires_at = 'infinity'` (D4: reports never expire; the column is `NOT NULL` in 0001, and `'infinity'` keeps `purge_expired_reports()` a no-op without editing it). Copy the payload, attach trades/metrics/report_files, mark the analysis claimed, and write an audit row.

Plan validity (`ends_at`) and allowance only gate **creating** a report. Existing reports stay readable after a plan ends (D4).

Plan grants come from two places only:
- **Razorpay webhook** → the existing `grant_plan()` (0007): verified signature, idempotent. Values come from `packages/shared` `PLANS`, never from the request. Link mode is removed from code, env and docs (D5).
- **Owner manual grant** (approved exception, D5) → `admin_grant_plan(p_actor, p_user, p_plan, p_reports, p_files, p_days, p_reason)`. It is `SECURITY DEFINER`, re-checks `users.role = 'owner'` for `p_actor` inside the function, requires a non-empty reason, and inserts the subscription with `payment_id = null`, `granted_by`, `grant_reason`, plus an `audit_log` row (`plan_granted_manual`, actor, target, plan, reason). The API route needs the new owner-only permission `plans:grant`.

Nothing else writes `subscriptions` or `credits`; `lens_app` loses direct UPDATE on `credits` (D6).

Limits are enforced in the API **and** the DB: at most 3 files per upload, 10 MB per file, the extension allow-list plus a magic-byte check, D11 rate limits, and the existing 2 MB report size.

---

## 10. Privacy and security (rule 7)

| Concern | Design |
|---|---|
| Encryption at rest | Envelope encryption in the API before upload to MinIO: a random 256-bit DEK per file, AES-256-GCM; the DEK is wrapped with a KEK from `FILE_KEK_<id>` (in `.env`, never in git). `enc_key_id` allows KEK rotation through a re-wrap script. MinIO never sees plaintext. A LUKS-encrypted data volume is optional (VM provider dependent). |
| Encryption in transit | Cloudflare to Caddy uses TLS (origin certificate). Inside the VM, traffic is on private Docker networks only. |
| Access | Only api (write) and worker (read) hold MinIO keys. No user-facing endpoint returns raw files, and admins have no file download. Every write, read, decrypt and delete goes to `file_access_log`. |
| Consent | The upload is refused unless `consent=true` arrives with it; the `consents` row is written in the same request (policy version and text hash). Research use is a separate opt-in, off by default, and can be withdrawn at any time (append a `granted=false` row). |
| Minimisation | Raw parsed rows are never stored. Drafts are removed after 24 h. Raw files are deleted 30 days after upload (D3). Logs never contain file contents or names (names are redacted in pino). |
| Deletion | `DELETE /reports/:id` nulls the payload, deletes trades/metrics and deletes the object (logged). `DELETE /me` covers everything above for all of a user's data, anonymises the user row, and keeps payment rows (billing law). |
| Hostile files | Parsers run in a BullMQ sandboxed child process with a memory limit, a timeout, no network (internal network) and a read-only filesystem. An oversized sheet range or zip bomb kills the child process, not the worker. SheetJS upgrade per D10. |
| Secrets | `.env` only; `.env.example` complete; `infra/scripts/check-secrets.sh` (gitleaks) in CI; the compose passwords from F9 are removed. |
| Headers / CSP | The current headers move to Caddy. CSP per HANDOFF phase 7 (Razorpay, Google). |

Legal follow-up, outside this plan but blocking launch: the privacy policy must describe server-side storage, which today's FAQ wording does not.

---

## 11. Front end (apps/web): same UI

| Today | v2 |
|---|---|
| `UploadClient`: Web Worker plus pdf.js in the browser, then preview, then `POST /api/reports` with the JSON | Same component and states (`idle → analyzing → preview → saving`) and the same loader. `analyze()` now posts the files to `/api/v1/analyses` and polls the status inside `withAnalysing`; `save()` posts `{analysisId}`. Adds the consent checkbox(es) from D2. |
| Server components call `getStore()` (DB) directly | They call the API with the forwarded cookie through `apps/web/lib/api-client.ts`. The web app has no DB credentials. |
| Report page renders `ReportView` with the stored JSON | Unchanged. `fmt.history` is filled from `report_metrics`, which fixes HANDOFF §6 "pass history". |
| `app/api/**` | Deleted from web; Caddy routes `/api/*` to `api`. |
| pdf.js worker in `public/`, `workers/analyze.worker.ts` | Removed from the web bundle (the offline tool keeps its own copy). |

Wording: identical except the strings approved under D1/D4.

---

## 12. Infrastructure and operations

- **VM:** Ubuntu 24.04 LTS, at least 4 vCPU / 8 GB RAM / 100 GB SSD to start (PDF parsing is the memory peak). Scripted with `infra/scripts/provision.sh`: Docker Engine + compose plugin, ufw (22/80/443), SSH keys only, fail2ban, unattended-upgrades, Docker log rotation, a `deploy` user, swap.
- **compose.dev.yml:** all services, bind mounts and hot reload; Postgres, MinIO console and Redis on `127.0.0.1` only; seed data.
- **compose.prod.yml:** pinned image digests, `restart: unless-stopped`, health checks, resource limits, read-only root filesystems where possible, no published ports except Caddy.
- **Deploy:** GitHub Actions builds and pushes images to GHCR, then SSHes to the VM: `docker compose pull`, a `migrate` one-off container (superuser URL taken from VM env), then `up -d`. Rollback = previous image tag. Fresh start (D7): no data migration. `.do/app.yaml` and the DO workflow are removed.
- **Backups:** nightly `pg_dump` (custom format) plus the `statements` bucket (Garage, D14), both through `restic` to offsite storage (D12), keeping 14 daily, 8 weekly and 12 monthly (owner decision 2026-10-12). **A restore drill is part of Phase 8's definition of done.** Raw files stay encrypted in backups, because they are ciphertext and the KEK is not in the backup.
- **Monitoring:** `/ready` checked by an external uptime monitor; worker queue depth and failed-job count go to `error_events`; the admin console Errors tab works unchanged. Disk-space alert.

---

## 13. Testing strategy

| Suite | What it covers | Where |
|---|---|---|
| Engine goldens (parity) | §5. Runs on every commit. | `packages/engine` |
| Existing unit tests | engine, extract, behaviour, otp, payments, rbac: moved, unchanged, green | per package |
| DB | migrations from empty up to 0014 on Postgres 16; SQL tests for every new function, including races (two parallel claims, last allowance), role denials (`lens_app` cannot DELETE, cannot touch credits; `lens_worker` cannot read users) | `packages/db/test` |
| API | Fastify `inject` tests per route; auth required; cross-user isolation; webhook signature, replay and plan mapping; upload limits and magic bytes; consent required | `apps/api/test` |
| Worker | pipeline on fixtures against real Redis/MinIO/PG (Testcontainers or the compose dev stack): output equals the goldens, trades row count = `m.n`, access log rows written, hostile-file timeout | `apps/worker/test` |
| End to end | existing `tests/e2e/*.py` (flow, v2, auth, admin, payments) adapted to the compose stack; same checks, plus consent and server-side limit cases | `tests/e2e` |
| Visual | before/after screenshots of every page at 1440/390 px to show the UI is unchanged | Phase 6 |

---

## 14. Phases (each ends with a stop, a summary, and your go-ahead)

| Phase | Scope | Done when |
|---|---|---|
| **0 · Plan** | This document. | ✅ Approved 2026-10-11. |
| **1 · Monorepo and parity baseline** ✅ | `git init` / branch; goldens from **current** code (TZ `Asia/Kolkata`); npm workspaces; move the engine (unchanged) to `packages/engine`, pricing/types to `packages/shared`, migrations to `packages/db`; the Next app becomes `apps/web` and still works exactly as today (browser engine); ESLint; root scripts `test`, `typecheck`, `lint`, `docs:index` across workspaces; Node 22; passwords out of `docker-compose.yml` into `.env` with new generated values. | Parity tests are byte-identical; all existing tests pass; the app runs as before; INDEX regenerated. |
| **2 · Infrastructure (dev)** ✅ | `infra/compose.dev.yml`, Dockerfiles, Caddyfile, Postgres init with roles from env, Redis, MinIO bootstrap, networks as in §4, `.env.example`, remove F9 passwords. | `docker compose -f infra/compose.dev.yml up -d` brings everything up healthy; only Caddy is reachable from outside the Docker networks. |
| **3 · Database v2** | Migrations 0008–0014, typed queries (Kysely), seed updated (D6), SQL tests. | Fresh DB and an upgraded 0007 DB both migrate; all role and function tests pass. |
| **4 · API** | Fastify app; port every route 1:1; analyses/upload endpoints; encryption; consent; rate limits; OpenAPI; old-path aliases. | Route tests pass; OpenAPI generated; the old Next routes and the new API produce the same responses for the same requests (contract test). |
| **5 · Worker** | BullMQ flow, sandboxed parse, normalise, store, retries, scheduled purge/cleanup, access logging; SheetJS upgrade (D10) as a separate commit with a golden report. | Fixtures through the full pipeline equal the goldens; purge removes objects; hostile-file tests pass. |
| **6 · Web cutover** | UploadClient and server components switch to the API; consent UI; wording from §2.1 **only after owner sign-off**; owner grant form (W11); remove `app/api` and the browser worker from web; e2e tests on the compose stack; screenshots. | All e2e suites pass on compose; screenshots match apart from approved strings. |
| **7 · Hardening and privacy** | CSP, `DELETE /me`, consent settings, research views, KEK rotation script, gitleaks in CI, dependency audit, security review of the diff. | Security checklist complete; no high/critical findings open. |
| **8 · Production VM** | `provision.sh`, `compose.prod.yml`, GitHub Actions deploy, backups plus a **restore drill**, monitoring, fresh database (D7), DNS cutover runbook and rollback plan. | Staging VM passes e2e; restore drill done; cutover checklist signed off by you. |

---

### Phase 1 result (2026-10-11)

| Item | Result |
|---|---|
| Goldens | 22 cases from the original engine (commit `3bdf976`, TZ Asia/Kolkata), byte-identical after the move through `src/node.ts` |
| Engine files | `engine.js`, `behaviour.js`, `extract.js`, `index.ts`, `types.ts`: only the `@file` header line changed (git rename, 98–99% similarity) |
| Dependencies | Original lockfile kept; engine libraries unchanged (pdf.js 6.3.289, SheetJS 0.18.5, cfb 1.2.2). Added: eslint 9.39.5, typescript-eslint 8.70.1, @eslint/js, globals; `@types/node` 20 → 22.20.4 |
| Checks | `npm test` 86 passed + 7 skipped (Postgres-only); `npm run typecheck` clean; `npm run lint` 0 errors, 11 warnings (existing dead code, left untouched under rule 8) |
| App | `npm run build` succeeds; the built server serves every page; saving and opening a report works (smoke test) |
| Not verified | Docker build/compose (Docker is not installed on the dev PC); browser e2e (`tests/e2e/*.py`, Playwright not installed); the one-off browser-vs-Node diff (§5 step 4), moved to Phase 6 where Playwright is set up |

### Phase 2 result (2026-10-11)

| Item | Result |
|---|---|
| Stack | `infra/compose.dev.yml`: caddy, web, api, worker, postgres 16.14, redis 7.4.11, garage v2.4.1, plus one-off jobs `migrate` and `storage-init`. Guide: `docs/INFRA.md` |
| Storage | **MinIO replaced by Garage** (D14): MinIO's free images are gone. API key is write-only; worker key is read+write |
| Exposure | Only Caddy publishes a port (127.0.0.1:8080 in dev). `internal` network has no internet; the worker cannot reach out, the api can |
| Database | `setup-roles.mjs` sets `lens_app` / `lens_worker` passwords from `.env` on every run; PUBLIC has no CONNECT; scram passwords required for every connection, including inside the container |
| Secrets | `npm run stack:env` generates 11 secrets into `.env`; none are in git, compose files or images |
| Skeletons | `apps/api` (Fastify: `/api/v1/health`, `/api/v1/ready`) and `apps/worker` (dependency checks); real logic in Phases 4–5 |
| Removed | Root `docker-compose.yml` (replaced); root `Dockerfile` moved to `infra/docker/web.Dockerfile` |
| Checks | `npm run test:stack` **44/44**; `npm test` 86 passed + 7 skipped; typecheck clean; lint 0 errors (11 old warnings) |
| Dependencies | New npm packages resolved as of 2026-09-26 (all ≥ 2 weeks old; a batch of Fastify sub-packages released 2026-10-10 was avoided); existing package versions unchanged |
| Transitional | `web` sits on the internal network and uses Postgres directly until the Phase 6 cutover (tested as such) |
| Dev machine | Docker/WSL memory raised to 6 GB + 8 GB swap (`%USERPROFILE%\.wslconfig`); the first build crashed at 4 GB. The PC has 7.8 GB RAM, so builds are tight |

### Phase 3 result (2026-10-12)

Done on macOS (Apple Silicon); Phases 1–2 were re-verified on the same machine first, with no fixes needed.

| Item | Result |
|---|---|
| Migrations | `0008`–`0014` as in §7. They apply on an empty DB from 0001 (`migrate` job: "14 migration(s) applied") and on top of a 0007 DB holding old reports, plans and credits. 0001–0007 unchanged (a test compares them with the baseline commit) |
| Enforcement (rule 5, 6) | `create_report_from_analysis()` refuses `no_plan` (including balance-only credits, D6), `plan_expired`, `plan_used_up` and `too_many_files`; picks the plan that ends first; serialises claims per user. `add_analysis_to_report()` enforces the file-set lock. `admin_grant_plan()`: owner checked in the DB, reason required, audited |
| Privacy (rule 7) | Purge with key shredding, draft purge, report delete, account delete (anonymises the user; keeps payments and consent proof; the email can sign up again), research views (consenting, active users only; pseudonymised) |
| Typed queries | `packages/db/src`: Kysely 0.29.6 types, `createDb()` / `assertRole()` per role, queries for uploads, jobs, the idempotent store step, reports, plans, consents, data requests, purge and sweep; `normalise.ts` maps ReportV1 to rows; `tradeSetFingerprint()` matches the offline tool |
| Seed (D6) | The dev user has a real Snapshot plan plus 5 credits |
| Tests | `packages/db`: **128** (33 without a DB: normalise over 21 goldens and the fingerprint equal to the offline tool; 95 on Postgres: migrations, plan rules, both races, the file-set lock, 33 role denials, purge and delete, research views, the store step for every golden). The web `pg-store` integration test (always skipped before) passes on the new schema, and `tests/01_functions.sql` passes. `test:stack` **46/46** (2 new). `npm test` green; typecheck clean; lint 0 errors (11 old warnings) |
| Test DB | `infra/compose.test.yml`: throwaway Postgres on 127.0.0.1:55432 (tmpfs, separate compose project), password `TEST_POSTGRES_PASSWORD` from `npm run stack:env`. `npm run db:test:up && npm run test:db`. DB tests skip when it is not running |
| Bug caught by the tests | Views in `research` ran their inner security-invoker views and functions with the caller's rights, so `lens_research` was denied. Fixed: the research views now read base tables and compute the HMAC inline |
| Not done here (by design) | Fills extraction and per-trade source file (Phase 5, worker); API routes (Phase 4); the old `create_report_with_credit()` path stays for apps/web until the Phase 6 cutover |

### Phase 4 result (2026-10-12)

| Item | Result |
|---|---|
| API | `apps/api`: every route from §8, ported with the same status codes, error codes and texts as `apps/web/app/api/*`. New: uploads, analyses, reports v2, plans, consents, export, account deletion, owner grant. OpenAPI generated (`apps/api/openapi.json`, 29 paths) and checked by a test |
| Reuse, not rewrite | Auth (codes, Google, sessions, request helpers), payments (Razorpay), RBAC rules, telemetry, mail and admin SQL moved with `git mv` from `apps/web/lib` to `packages/shared`. The web keeps thin re-exports, so its tests and build are unchanged |
| Uploads | Real type from bytes (the engine's `detectKind` plus a reject list), 10 MB and 3-file limits, plan statements-per-report, D11 (20 a day, 3 running), required consent, AES-256-GCM per file with a wrapped key, write-only storage key, access log, BullMQ job |
| Security | CSRF origin check; rate limits (Redis store in the stack); refuses to run as anything but `lens_app`; no secrets in images (5 new secrets generated into `.env`); cookies, auth and signature headers redacted from logs |
| Migration | `0015_analysis_error_message.sql` (D16 f) |
| Tests | `apps/api` **56**: 25 without a DB (type check on every fixture, encryption, OpenAPI, rate limit); 31 on Postgres covering sign-in, CSRF, `/me` and `/plans`, consents, export and deletion, uploads (limits, encryption at rest, consent, queue), status and preview, save and credits, file-set lock, rename and delete, webhook signature, replay and legacy path, RBAC, audit and owner grant. `test:stack` **51/51** (5 new: upload through Caddy, a job in Redis, and the stored object fetched with the worker key and decrypted with the file key). `packages/db` 128; `npm test` green; typecheck clean; lint 0 errors |
| Also fixed | `docs:index` silently dropped files whose area was not in its fixed list (17 API/worker files); it now lists every area |
| Not done here | The worker that processes the jobs (Phase 5); Caddy still sends `/api/*` (other than `/api/v1`) to the web app until the Phase 6 cutover; a byte-level comparison of old Next responses with new API responses was replaced by tests that pin the old shapes and texts, because the Next handlers can't run outside Next |

### Phase 5 result (2026-10-12)

| Item | Result |
|---|---|
| Worker | `apps/worker`: BullMQ consumer (concurrency 2), fetch + decrypt (logged), engine in a memory-capped child process with a timeout, one-transaction store of payload, trades, fills, metrics, traits, parse runs and file fingerprints; retries, dead letter, idempotency; schedules for the nightly purge (02:00 IST) and the storage sweep (15 min). See `docs/WORKER.md` |
| Parity | **All 22 golden cases** (17 single files, 3 combined, 2 currency overrides) go through the real pipeline (encrypted storage → child process → DB). The engine output is **byte-identical** to the golden JSON, and the stored payload, trade count and saved report equal it |
| Credits | A failed file (no closed trades, unreadable, timeout, out of memory, purged, dead-lettered) leaves the plan untouched and can't be saved; tested |
| File-set lock | The worker sets per-file fingerprints with the offline tool's rule: a renamed copy matches, the same statement as PDF and as Word matches, a different statement does not. End to end, "+" then swapping in a third statement is refused |
| Hostile files | A parse past the timeout is killed; a parse past its memory cap crashes only its child, and the worker carries on |
| Tests | `apps/worker` **36** (22 golden pipelines; failures, idempotency, storage outage then retry, purged files, fingerprints, lock; timeout and memory; real Redis: API producer → worker consumer for 3 files with duplicate enqueue, retry ×3 → dead letter; nightly purge + sweep). `test:stack` **55/55** (4 new: worker health, 2 files through Caddy → ready → equal to the golden combined report, access log, save + serve). All earlier suites green; typecheck clean; lint 0 errors |
| Test services | `infra/compose.test.yml` now also has a throwaway Redis (127.0.0.1:56379, `TEST_REDIS_PASSWORD`) |
| SheetJS upgrade (D10) | Separate commit; result below |

### SheetJS upgrade (D10) result (2026-10-12)

| Item | Result |
|---|---|
| Change | The engine's `xlsx` moves from npm 0.18.5 (unmaintained on npm; advisories CVE-2023-30533 prototype pollution and CVE-2024-22363 ReDoS) to **0.20.3**, the current release from the official SheetJS CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned by URL with an integrity hash in the lockfile; no install scripts, no dependencies). Only the engine (server parsing) uses it. apps/web keeps 0.18.5 for the browser path, which Phase 6 removes |
| What the user sees | **The report JSON is byte-identical in all 22 golden cases** (`report` and `m` unchanged) |
| Golden diff (reviewed) | 11 lines in 9 files: `rawSha256` in the 9 CSV cases (raw cells: 0.18.5 shifted CSV dates by +05:30, so `2025-01-06` came out as 05:30 IST; 0.20.3 gives exact midnight and turns time-only text into a fraction of a day), plus the internal-only `exitHour` of one Dhan trade, 11 → 12 (it appears in two cases: `dhan_tradebook_csv` and `combo_three_files`). That field is not in the report JSON. Goldens regenerated with `UPDATE_GOLDENS=1` |
| Bonus | Under `TZ=UTC` all 22 golden cases now pass (before: 9 differed, finding F3). The engine no longer depends on the server timezone for CSV files; the Asia/Kolkata pin (D9) stays as a safety net |
| engine_version | Now also hashes the engine's `package.json`, so a library change gives a new version (`e1-9bfbf94ab2b6`) |
| Image fix found by the stack test | npm nests the engine's SheetJS under `packages/engine/node_modules` (the web app pins another version), and the runtime image did not copy it, so the child crashed on start-up. The worker image now places the engine's own dependencies next to the bundle. The same run showed that a non-memory child crash was being treated as a file problem; it is now an infrastructure error (retried, then dead letter), and the worker's health includes an engine self-test |

### Phase 6 result (2026-10-12)

| Item | Result |
|---|---|
| Audit fixes | Dashboard crash on never-expiring reports (`new Date(Infinity)`) fixed; Next.js 15.5.26 + React 19 (critical/high advisories gone; build-time postcss/source-map-js and next 15.5.27 wait for the 2-week rule until 2026-10-14) |
| Cutover | The website has **no database access, no API routes, no browser parsing**: `apps/web/app/api/**`, `lib/store`, `lib/db.ts`, the Web Worker, pdf.js copy and web SheetJS/pg/jose/SES dependencies are gone. Pages read from the API (`lib/api-client.ts` server-side with the visitor's cookie; `lib/api-browser.ts` in the browser). Caddy sends every `/api/*` to the API; web is on the edge network only |
| Workspace | Ported from the offline tool (`components/workspace/*`, `app/workspace.css`): plan card and strip, drop zone, consent W9/W10, loader following the worker, file tabs with each statement's own dashboard, All files, "+" (file-set lock, nothing spent), × (place kept), MON-YY history with rename, CSV/PDF/Delete. Backend: migration 0016 per-file reports, `POST /reports/:id/files/remove`, `places` and `files` on `GET /reports/:id`, `role` on `/me`, `GET /auth/providers` |
| Wording | §2.1 W1–W11 applied word for word (landing W1–W4, upload W5, dashboard W6, deleted page W7, no expiry badges W8, consent W9/W10, owner grant form W11); link payment mode removed from the web (D5) |
| Tests | **Playwright e2e** (`npm run stack:e2e && npm run test:e2e`, real email-code sign-in): free preview without a plan; upload → loader → report → 5 tabs → "+" → All files (101 positions = golden) → rename in history → **second device sees the same report** → remove (place kept) → delete → "deleted" page; no old privacy claim on the landing page. Visual check: pricing and admin pixel-identical; landing changes start exactly at W2/W3/W4/W1. `test:stack` 55/55 (web edge-only, no DB/secret env); api 57; db 129; worker 38; engine 74; shared 12 (tests moved with the code). Old Python e2e scripts retired |
| Found and fixed | SheetJS: the worker had been resolving the web's old 0.18.5 locally (the image used 0.20.3); 0.20.3 is now hoisted at the root so dev and image match |

### Phase 7 result (2026-10-12)

| Item | Result |
|---|---|
| Export my data | Worker job (own ZIP writer, no dependency) via `export_user_data()` (0017); encrypted archive in the new `exports` bucket for 7 days, then swept; API `POST /me/export`, `GET /me/exports`, `GET /me/export/:id` (owner only, audited); Dashboard → **Your data** (research toggle, export + download, delete account with type-to-confirm). E2E: the downloaded ZIP holds the JSON (96 trades) and the original statement |
| Retention | `purge_logs()` (0018) in the nightly job: events/errors 12 months, audit/file-access 24 months |
| Security headers | Caddy: HSTS, nosniff, frame-deny, referrer and permissions policy, COOP, CSP (self + Razorpay + Google form post); zero CSP violations in the e2e runs |
| Containers | Read-only root fs, cap_drop ALL, no-new-privileges, tmpfs, memory limits; non-root web/api/worker (stack tests) |
| Key rotation | `packages/db/scripts/rewrap-keys.mjs` (dry run, idempotent, audited) with a test |
| CI checks | `npm run audit:prod` (dated allow-list: postcss and source-map-js until 2026-10-28, build-time only); `npm run check:secrets` (gitleaks v8.30.1: no leaks in history or tree) |
| Security review | Branch-wide review: no high-confidence findings. Two pre-existing low items fixed anyway: open redirect on `next` (`safeNext()`), and sessions of blocked/deleted accounts (now refused at once) |
| Fixes | Playwright output had been committed (synthetic test data only, never pushed): untracked and git-ignored |
| Docs | `docs/PRIVACY_NOTES.md` (what, where, how long, who, plus 11 lawyer items); legal drafts: BUILD CHECKs marked BUILT ✓ where true (13 genuinely open items remain); `ARCHITECTURE.md` and `ENVIRONMENT.md` rewritten for v2; `.env.example`, `PAYMENTS_RAZORPAY.md` (link mode removed), `README`, `TESTING` updated |
| Tests | api 59, worker 41, db 132 (99 on Postgres, incl. rewrap and retention), shared 14, engine 74; stack 66/66; e2e 4/4 |

### Phase 8 result (2026-10-12)

| Item | Result |
|---|---|
| Production compose | `infra/compose.prod.yml`: same services and networks as dev; TLS on 80/443 only; `AUTH_MODE=jwt`, no seed, no OpenAPI; restart policies, health checks, log rotation, hardening and memory limits; optional second file key for rotation; images from GHCR (`IMAGE_REGISTRY`) or built on the server |
| Caddy | `infra/caddy/Caddyfile.prod`: Cloudflare origin certificate (`TLS_MODE=cloudflare`) or self-signed (`internal`); client IP only from Cloudflare ranges; same headers and CSP; `www` and `http` → `https://pnllens.com`. Validated in both modes |
| Scripts | `provision.sh` (Ubuntu 24.04 hardening, Docker, deploy user, ufw, fail2ban, swap, cron), `deploy.sh` (tag checkout, pull/build, migrate, Caddy reload, ready check through Caddy, automatic rollback), `backup.sh` (dump + statements → restic, 14/8/12, weekly partial verify), `restore.sh`, `healthcheck.sh` (ready + disk, one email per change via Resend). shellcheck clean |
| CI/CD | `.github/workflows/ci.yml`: lint, typecheck, docs index, all unit/DB/API/worker tests on real Postgres 16 + Redis 7, audit, gitleaks, full Docker stack + stack tests + Playwright e2e, prod compose check, shellcheck. `deploy.yml`: `v*` tag → 4 images to GHCR → SSH → `deploy.sh`. The old AWS workflow is removed. actionlint clean |
| Load test | k6, 50 users at once (`docs/LOAD_TEST.md`): 0 failures in 150 analyses and 6,266 requests; upload p95 0.47 s (normal files) and 2.1 s (5 MB files); worker concurrency 2 kept (4 was only 17% faster with twice the memory); production api limit raised to 1 GiB |
| Drill | `docs/RESTORE_DRILL.md`: deploy → HTTPS smoke → backup → wipe all volumes → restore → data, sessions and file decryption intact → broken deploy rolled back by itself → alerts. Found and fixed 7 bugs (Caddy config never reloading on deploy, cert mount, restic lock, restore role order, image tag, secrets in `ps`, bash 3.2) |
| Load-test support | `RATE_LIMIT_EXEMPT_IPS` (CIDR list, empty by default; never passed by `compose.prod.yml`) with a test |
| Docs | `docs/DEPLOYMENT_VM.md` (DigitalOcean + Spaces + Cloudflare), `docs/RUNBOOK.md`, `docs/GO_LIVE_CHECKLIST.md`, `docs/LOAD_TEST.md`, `docs/RESTORE_DRILL.md`; `INDEX`, `INFRA`, `ENVIRONMENT`, `TESTING` updated; `.do/app.yaml` and the App Platform guide removed; the AWS guide marked outdated |
| Open (owner) | Run `provision.sh` on a Multipass VM or the Droplet; the go-live checklist (accounts, keys, lawyer, the 2026-10-14 dependency bump) |

### Owner change requests of 15 Oct 2026 (after Phase 8)

Pranav's document *PnL Lens: Change Requirements (15 Oct 2026)*. Owner answers: Discipline 12 months, Single 7 days, Progress first on phones, reminder email later. Delivered as four commits on branch `req-oct15` (PR #2).

| Request | Result |
|---|---|
| REQ-1 Score card labels | Labels in their own row, centred under each segment; current level yellow and bold; only the current level under 344 px; tooltips with ranges. Playwright check at 320–1440 px, every level, scores 0 and 100, Chromium and WebKit |
| REQ-3 Durations and $9 | `PLANS`: Snapshot 3 months (92 days), Progress 6 months (183 days); Global Single $9. All copy built from `PLANS`; "Reports kept until you delete them" on every card; plan card "Valid till DD-MMM-YY". Grants already use `plan.days` (no migration). Tests for durations, grants (7/92/183/365 days) and a repo search for old text |
| REQ-4 Pricing higher | Phone (390×844): pricing from 10.39 to 3.94 screen-heights, no content removed; See plans button and pill; Progress first on phones; broker names without logos; footer legal placeholders (go-live A11); visitor events `pricing_viewed` / `landing_scroll_depth` |
| REQ-2 Journey | `packages/shared/src/journey.ts` (5 steps, real data only, locks name the plan and price); bar on dashboard, upload and report pages (one line on phones, Hide remembered on the device); "What's next" card on Overview and Progress with a blurred preview for Single; pricing page highlights the plan a step needs; events `journey_bar_view`, `journey_step_click`, `journey_next_action_click`, `upgrade_from_journey`; admin Product tab: Single → higher plan, 45-day return, journey events. Reminder email (C) later, as agreed |

### Visual refinement (17 Oct 2026, PR #3)

An approved exception to rule 8: styling only. The system is documented in `docs/DESIGN.md`.

- **One set of tokens** for app and landing: 3 surfaces, 3 hairlines, 3 text greys (all WCAG AA), a restrained yellow, one easing and 3 durations.
- **Lighter type scale** (no weights above 700).
- **Real control states:** hover, pressed, disabled and focus.
- **Removed:** the yellow hero slab, glows, surface gradients, hover lifts, the loader's breathing and shimmer, and the lens wobble.
- **Fixed:** the journey bar alignment on report pages, the plan card overflow, the delete button and heatmap contrast, the phone nav wrap, and the reduced-motion trend line.
- **Checks:** the page text, links, buttons and inputs are identical before and after on 11 views (only small labels are now shown in capitals). All tests pass, and the landing page still puts pricing within 4 screen-heights (3.89).

### Owner change requests of 17 Oct 2026 (REQ-5 to REQ-7)

| Request | Result |
|---|---|
| REQ-5 Social icons (PR #4) | X and Instagram icon buttons in the landing header (beside the burger on phones) and footer (centred on phones). Links in one per-site config (`packages/shared/src/site.ts`), `noopener noreferrer`, aria labels, a yellow focus/hover state, Organization JSON-LD `sameAs`, and a visitor event `social_click`. Nav: Product · Brokers · Pricing · FAQ. Also: the See plans pill no longer covers the footer, and its text is dark on yellow (it was white). Tests: header and footer at 320–1440 px on both sites, no overlap, focus ring, JSON-LD, event |
| REQ-6 Instagram section (PR #5) | After pricing: heading and copy as specified, 3 cards (post, 2 reels) + a yellow follow card in one 9:16 row; the row follows the page scroll from card 1 to card 4 (spec formula); a manual swipe, drag, wheel or arrow key takes over and the row then snaps card by card; reduced motion = manual only. Self-hosted media only (`public/media/instagram/`, names in `site.ts`); until the owner's files arrive each card is a branded placeholder linking to Instagram. Videos play muted when ≥ 60% visible, never with reduced motion. No Instagram/Meta requests on either site; CSP `media-src 'self'`. Events `ig_*` + admin Product panels (Instagram, Social icons). Pricing depth 3.93 screens |
| REQ-7 Blog (PR #6) | Migration `0019_blog.sql`: `blog_posts`, `blog_redirects`, a published-only view (the only thing `lens_app` can read) and owner/admin-only SECURITY DEFINER functions that write `audit_log`. API: public posts/tags/feed/media (cached 60 s; images immutable) and admin create/edit/publish/schedule/unpublish/archive/soft delete, live render and image upload (markdown-it 15.0.2 with raw HTML off; sharp 0.35.5 → WebP + 1200×630). New public Garage bucket `media` (API read/write, worker none). Web: server-rendered `/blog` (12 per page, tag filter) and `/blog/[slug]` (one H1, CTA card to `/upload?from=blog`, "Not investment advice."), canonical/OG/Twitter/robots/hreflang (only for posts on both sites), JSON-LD BlogPosting + BreadcrumbList, `sitemap.xml`, `robots.txt`, `/blog/rss.xml`, `lang="en-IN"` on the India site; landing section 9 "Read your trades better" (latest 3, hidden with none) and a Blog link in the nav, menu and footer; admin Blog tab (list with views, editor with live preview, cover with required alt, SEO panel with counters and a Google-style preview, content rules, IST scheduling) and a private noindex preview page. Tracking: `blog_*`, `signup_from_blog`, uploads with `source=blog`, Blog panel in the Product tab. Scheduling needs no job: the view shows a post once its time passes. Old slugs answer with Next's permanent redirect (308, treated like 301 by search engines). Lighthouse (mobile, 12.6.0): SEO 100, accessibility 98–100, best practices 100, LCP 2.2–2.3 s, CLS 0 on `/blog` and an article. Also fixed: the app header logo link had no accessible name on phones |
| Sign-in page layout (PR #7, owner request 19 Oct) | One card like the owner's reference: "Continue with Google" (dark provider button, only when Google is configured), "OR", "Enter your email", yellow "Continue with email", then the unchanged 6-digit code step. Rule-8 wording exception (owner-requested): "Email me a code" → "Continue with email", "or use an email code" → "OR", the "Email" label → placeholder "Enter your email". Accounts stay one per email (`users.email` is unique, case-insensitive; Google links by verified email). **Apple sign-in deferred**: it needs an Apple Developer account (Team ID, Services ID, key) and can only be tested on the live domain; it can be added later as a second provider button behind env keys |
| Email + password (PR #7, owner request 19 Oct) | A code proves the email once; the account then **must** set a password (required; the signed-in pages send an email account without one to "Set a password"). After that: email + password, no email sent. "Forgot password?" → code → new password. Google users need no password and can add one from "Your data". Migration `0020_passwords.sql`: scrypt hash (Node built-in, no new dependency), lockout after 10 wrong attempts for 15 minutes, `sessions_valid_after` (a password change signs out other devices); a trigger clears it all when an account is deleted. New card strings (owner-requested): "Welcome back", "Forgot password?", "Check your email", "Set a password", "Choose a new password", "Save and continue". Email codes can be sent through Google Workspace SMTP (`MAIL_DRIVER=smtp`, App password) |
| Research datasets (PR #8, owner request 19 Oct) | Every 1st and 16th at 03:00 IST (about every 15 days), and on "Build now", the worker builds a ZIP (`subjects.csv`, `reports.csv`, `trades.csv`, `habits.csv`, README) from the 0014 research views: **only users who opted in to research** (owner's choice; rule 7). Traders keep the stable 0014 pseudonym; report ids are replaced per export (HMAC with a discarded key). Encrypted, stored under `research/` in the exports bucket (reusing its worker-write / API-read keys), kept 90 days. Admin console **Research** tab, owner only: list, Build now, Download (audited). Migration `0021_research_exports.sql`: `research_exports`, and `lens_worker` may read the four research views (not `consenting_users` or the key). `lens_research` stays NOLOGIN; model training is still out of scope |
| User management (PR #9, owner request 19 Oct) | Admin **User management** tab: search, filters (Included / Not included / Restricted), per user sign-in method, plan, reports, research status. **Request reports** (owner): a branded email asking once whether past reports may be included; the user answers on a one-click page with no sign-in (personal link, 30 days, single use) showing the exact research consent wording; the answer is a normal `consents` row, so the next research dataset follows it. Re-ask only after 90 days (6 months after a no). **Restrict / Unrestrict** (owner, admin): sign-in blocked, sessions end at once. **Delete** (owner): typed email + reason, reuses `delete_account`. Migration `0022_user_admin.sql` (role-checked, audited functions; `research_invites`). Also: the e2e overlay exempts local addresses from the API rate limit (the growing suite shared one 300/min bucket and got 429s), and setting a password stamps `sessions_valid_after` with the API's clock (the same clock as session tokens) |
| Credits spec (PR #10, owner doc 19 Oct) | Audit against "How Credits Work": plan values, rules 1, 2, 3, 5, 6, 7, 8 already held in the database. Fixed: "+" refused after the report's plan window (migration `0023_credits_spec.sql`, also checked by the upload before storing); "reports left" counts only plans whose window is open (`user_reports_left()`; the `credits` mirror stays internal); customer wording uses "reports" only (header pill "N reports left" / "No reports left · See plans", menu "Plans", plan card "Snapshot · 2 of 5 reports used · use by 19-Jan-27", ended text, "Use within 7 days", messages); free preview = net P&L, charges, trades, 2 insight titles, blurred rest, "Get the full report from ₹99 / $9"; the workspace picks the plan with reports left first; plan windows are calendar months from purchase or grant (`planEndsAt`; Progress no longer ends a day late). Multi-plan rule (confirmed by the owner, 19 Oct): with several plans, an upload with more statements than the soonest plan allows uses the soonest plan that allows them (Single + Snapshot, 3 statements → a Snapshot credit; the Single credit stays for a 1–2 statement report). Test setup: the e2e overlay raises the per-IP sign-in-code limit (`OTP_PER_IP_PER_HOUR_OVERRIDE`) |
| Motion and UX pass (PR #11, owner request 19 Oct) | Apple-style motion system, styling only. Same yellow and black theme, wording and features (a text, link and button snapshot of 16 page views is identical apart from live admin numbers). Landing: a scroll story (hero line reveals, ledger tilt, step line, dashboard tilt-in on scroll, staggered cards, plan border sheen, smooth FAQ, active nav link, spotlight). App: page transitions, View Transitions for report tabs, sign-in steps and admin tabs, a sliding tab ink, count-ups, springy press and lift, upload, loader and preview motion, admin chart and table motion, blog card and cover motion with reading progress, and skeletons. No new dependency; reduced motion is static. Lighthouse mobile: landing 97, dashboard 99, report 100 (was 97), blog 99, CLS 0; report accessibility 89 → 93 (disabled tab role, larger remove targets). Rule-8 design exception (17 Oct) extended to motion |
| Reports view-only (PR #12, owner request 19 Oct) | Reports can only be viewed in the app: the report's CSV and PDF buttons are gone, and printing or "Save as PDF" of a report page or the free preview prints only "Reports can be viewed in the PnL Lens app at pnllens.com". "Export my data" (Dashboard → Your data) stays: it is the user's legal right to their data (DPDP/GDPR portability). No website can prevent screenshots |

## 15. Risks

| Risk | Mitigation |
|---|---|
| Hidden browser/Node differences in the engine (F3, F5) | Pinned TZ, same image for tests and worker, the one-off browser-vs-Node diff in Phase 1. |
| Server now holds sensitive financial files | Encryption, no egress, access log, short retention, minimal roles, sandboxed parsing. |
| Wording becomes legally false if D1 is skipped | D1 is a hard prerequisite for Phase 6 go-live. |
| One VM is a single point of failure | Offsite backups with a tested restore; documented rebuild from `provision.sh` plus a restore. Accepted trade-off for this scale. |
| Free previews used as free analysis | Previews show only summary numbers (as today), plus D11 rate limits. |
| Cutover breaks payments or sign-in | Old webhook and callback paths stay valid; payments are off at cutover anyway. |
| Garage `replication_factor = 1` is described upstream as "test only" | Accepted for one VM: durability comes from the nightly offsite backup and the Phase 8 restore drill, the same as for Postgres. |
| Dev laptop has 7.8 GB RAM | Images build one at a time if needed (`docker compose build web`). The production VM is sized separately (§12). |
| Raw files are deleted after 30 days (D3), but the "+" button re-analyses a report's earlier files together with the new one | **Owner decision still open.** The API now refuses "+" on such a report with 409 `files_expired` and a clear message (D16 c). The alternative, keeping the files of saved reports longer, is a one-line change to `delete_after` |
| Until the Phase 6 cutover, apps/web still saves reports through the old `create_report_with_credit()`, which checks credits only | Same behaviour as before v2; it goes away at cutover. The new functions are already the only path for the API |
| The research pseudonym key is stored in the DB (and so in backups): pseudonymised, not anonymised data | Listed for the lawyer in PRIVACY_NOTES (Phase 6). `lens_research` has no login |
