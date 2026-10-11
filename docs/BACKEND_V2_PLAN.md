# Backend v2 — Plan

**Status:** APPROVED 2026-10-11, with the changes recorded in §2. Phase 1 in progress.
**Goal:** move parsing and analysis from the browser to the server, and store raw files, normalised trades and computed metrics. Everything runs on one Ubuntu 24.04 VM with Docker Compose. AI/ML is out of scope; the data model is only made ready for it.

Sections: 1 Findings · 2 Decisions needed · 3 Architecture · 4 Services and network · 5 Engine and parity · 6 Pipeline · 7 Data model · 8 API · 9 Enforcement · 10 Privacy and security · 11 Front end · 12 Infra and operations · 13 Testing · 14 Phases · 15 Risks

---

## 1. What the current code tells us (findings)

| # | Finding | Where | Consequence for v2 |
|---|---|---|---|
| F1 | The engine is plain JS with injected libraries (XLSX, CFB, pdfjs). It already runs in Node; the unit tests do this. | `lib/engine/*`, `tests/extract.test.ts` | It can move to `packages/engine` byte-for-byte. Only a thin Node runner is new. |
| F2 | Output is not fully deterministic: `generatedAt = new Date()`. | `lib/engine/index.ts:43` | Golden tests ignore `generatedAt` only. Every other byte must match. |
| F3 | The date fallback `new Date(s)` parses in the **local timezone**. | `lib/engine/engine.js:58` | Results can differ between a browser in IST and a server in UTC. The worker and tests pin `TZ`. The value is decision D9. |
| F4 | The engine has module-level state (`CUR`, set by `setCurrency` inside `analyze`) that is used to format money in leak/rule text. | `engine.js:33–41, 512` | `analyze()` is synchronous, so jobs in one Node process can't interleave inside it. The worker must never `await` between `setCurrency` and the end of `analyze`. This holds today. |
| F5 | Money text uses `toLocaleString('en-IN')`, which depends on ICU. | `engine.js:37` | Node 22 official images ship full ICU. Golden tests run in the same image as the worker. |
| F6 | The server enforces only "credits > 0". `create_report_with_credit` ignores `subscriptions.files_per_report`, `ends_at` and `reports_used`. Expiry is a flat `REPORT_TTL_DAYS`, not the plan's `retentionDays`. | `0003_functions.sql`, `pg-store.ts` | Rule 5 is not met today. New SQL functions are needed (§9). |
| F7 | The server trusts report numbers computed in the browser ("validates structure, not arithmetic"). | `lib/api/validate.ts`, HANDOFF §5 | This goes away: the server computes every report. |
| F8 | UI wording promises files are **never uploaded**, in 5 places. | `Landing.tsx:112,162,231,239`, `upload/page.tsx:20` | It becomes false after v2. This conflicts with rule 8; see D1. |
| F9 | `docker-compose.yml` contains DB passwords (`adminpw`, `apppw`). | repo root | Rule 2: remove them, take values from `.env`, and rotate anything that was ever deployed with them. |
| F10 | `xlsx@0.18.5` has published advisories (prototype pollution, ReDoS). It was "browser-only, user's own files" before; it now parses **strangers' files on our server**. | `package.json` | Sandbox the parser (§10). Upgrading SheetJS may change output, so it is a separate step with its own golden diff (D10). |
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

| Migration | Adds |
|---|---|
| `0008_roles_v2.sql` | `lens_worker` (nologin; password set by infra init), `lens_research` (nologin, for later). Grants are added in each migration below. |
| `0009_files_analyses.sql` | `statement_files`, `analyses`, `file_access_log` |
| `0010_trades_metrics.sql` | `trades`, `report_metrics`, `report_files`; new columns on `reports`: `analysis_id`, `engine_version`, `subscription_id` |
| `0011_consents.sql` | `consents` (append-only) and view `user_consent_current` |
| `0012_plans_v2.sql` | `create_report_from_analysis()`, `admin_grant_plan()` (owner-only, D5), `subscriptions.granted_by` / `grant_reason` columns |
| `0013_purge_v2.sql` | `purge_raw_files()` (30 days, D3), `purge_drafts()`, `delete_report_v2()`, `delete_account()` |
| `0014_research_ready.sql` | `research` schema with views for opted-in users only, pseudonymised (no grants to any login role yet) |

### Tables (main columns)

**statement_files:** `id uuid`, `user_id`, `analysis_id`, `original_name`, `ext`, `detected_kind` (`sheet|pdf|docx|doc|rtf`), `size_bytes`, `sha256`, `storage_key` (random, not the file name), `enc_alg`, `enc_key_id`, `wrapped_dek bytea`, `iv bytea`, `created_at`, `purged_at`.

**analyses:** `id`, `user_id`, `status`, `stage`, `error_code`, `currency_override`, `file_count`, `engine_version`, `payload jsonb` (ReportV1, only until claimed), `created_at`, `finished_at`, `expires_at` (now + 24 h for drafts), `report_id` (set once claimed).

**trades** (normalised; one row per engine trade, all `TRADE_FIELDS` plus links):
`id bigserial`, `report_id` / `analysis_id`, `user_id`, `seq`, `symbol`, `underlying`, `market`, `segment`, `kind`, `grp`, `family`, `direction`, `entry_date`, `exit_date`, `entry_hour`, `hold_days`, `expiry`, `expiry_type`, `weekday`, `qty numeric`, `avg_buy`, `buy`, `sell`, `pnl`, `net_est`, `pct` (all `numeric(20,6)`), `style`, `open_qty`, `n_legs`, `mult`, `is_opt`, `currency text`, `source_file_id`, `fingerprint`, `engine_version`. Indexed on `(user_id, exit_date)` and `(report_id)`.

**report_metrics:** `report_id` (or `analysis_id`), the scalar fields of `m` as columns (`n`, `wins`, `losses`, `win_rate`, `payoff`, `profit_factor`, `realized`, `charges`, `other`, `net`, `from_date`, `to_date`, `source`, `market`, `currency`), `progress_score`, `extra jsonb` (the rest of `m`), `engine_version`. This feeds Progress history (`fmt.history` in `render.js`) and later analytics.

**report_files:** `report_id`, `file_id`, `trade_fingerprints text[]`. This is the server-side "one report = a fixed set of files" record from HANDOFF §6.

**file_access_log:** `id`, `file_id`, `actor_kind` (`user|worker|admin|system`), `actor_user_id`, `action` (`write|read|decrypt|delete`), `reason`, `job_id`, `ip`, `created_at`. Roles can INSERT only; admins can SELECT.

**consents:** `id`, `user_id`, `purpose` (`processing|research`), `granted bool`, `policy_version`, `text_sha256`, `ip`, `user_agent`, `created_at`. Never updated; the latest row per purpose wins. Research defaults to "no row", which means off.

### Rendering source of truth
`reports.report` (ReportV1 jsonb) stays the payload the UI renders, so the renderer and old reports keep working. `trades` and `report_metrics` are written from the **same engine run** in the same transaction, so they cannot disagree with the payload.

### "Ready for AI" means only this
Stable IDs, `engine_version` on every derived row, normalised numeric trades, per-file links, consent history, and a `research` schema whose views join `user_consent_current` (research = true) and replace `user_id` with an HMAC pseudonym. No model, feature store or training code. `lens_research` gets no login until a future, separately approved phase.

### Roles

| Role | Used by | Can |
|---|---|---|
| migrator (superuser) | `npm run db:migrate` only | DDL |
| `lens_app` | api | As today, plus INSERT on files/analyses/consents/access log, SELECT on own-scope tables, EXECUTE on the new functions. No DELETE, no DDL. |
| `lens_worker` | worker | SELECT `statement_files`; UPDATE `analyses` (status columns); INSERT `trades`, `report_metrics`, `file_access_log`, `error_events`; EXECUTE purge functions. Nothing on users, payments or credits. |
| `lens_research` | nobody yet | SELECT on `research.*` views only |

---

## 8. API (apps/api, Fastify)

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
- **Backups:** nightly `pg_dump` (custom format) plus the MinIO bucket, both through `restic` to offsite storage (D12), keeping 7 daily, 4 weekly and 6 monthly. **A restore drill is part of Phase 8's definition of done.** Raw files stay encrypted in backups, because they are ciphertext and the KEK is not in the backup.
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
| **1 · Monorepo and parity baseline** | `git init` / branch; goldens from **current** code (TZ `Asia/Kolkata`); npm workspaces; move the engine (unchanged) to `packages/engine`, pricing/types to `packages/shared`, migrations to `packages/db`; the Next app becomes `apps/web` and still works exactly as today (browser engine); ESLint; root scripts `test`, `typecheck`, `lint`, `docs:index` across workspaces; Node 22; passwords out of `docker-compose.yml` into `.env` with new generated values. | Parity tests are byte-identical; all existing tests pass; the app runs as before; INDEX regenerated. |
| **2 · Infrastructure (dev)** | `infra/compose.dev.yml`, Dockerfiles, Caddyfile, Postgres init with roles from env, Redis, MinIO bootstrap, networks as in §4, `.env.example`, remove F9 passwords. | `docker compose -f infra/compose.dev.yml up -d` brings everything up healthy; only Caddy is reachable from outside the Docker networks. |
| **3 · Database v2** | Migrations 0008–0014, typed queries (Kysely), seed updated (D6), SQL tests. | Fresh DB and an upgraded 0007 DB both migrate; all role and function tests pass. |
| **4 · API** | Fastify app; port every route 1:1; analyses/upload endpoints; encryption; consent; rate limits; OpenAPI; old-path aliases. | Route tests pass; OpenAPI generated; the old Next routes and the new API produce the same responses for the same requests (contract test). |
| **5 · Worker** | BullMQ flow, sandboxed parse, normalise, store, retries, scheduled purge/cleanup, access logging; SheetJS upgrade (D10) as a separate commit with a golden report. | Fixtures through the full pipeline equal the goldens; purge removes objects; hostile-file tests pass. |
| **6 · Web cutover** | UploadClient and server components switch to the API; consent UI; wording from §2.1 **only after owner sign-off**; owner grant form (W11); remove `app/api` and the browser worker from web; e2e tests on the compose stack; screenshots. | All e2e suites pass on compose; screenshots match apart from approved strings. |
| **7 · Hardening and privacy** | CSP, `DELETE /me`, consent settings, research views, KEK rotation script, gitleaks in CI, dependency audit, security review of the diff. | Security checklist complete; no high/critical findings open. |
| **8 · Production VM** | `provision.sh`, `compose.prod.yml`, GitHub Actions deploy, backups plus a **restore drill**, monitoring, fresh database (D7), DNS cutover runbook and rollback plan. | Staging VM passes e2e; restore drill done; cutover checklist signed off by you. |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Hidden browser/Node differences in the engine (F3, F5) | Pinned TZ, same image for tests and worker, the one-off browser-vs-Node diff in Phase 1. |
| Server now holds sensitive financial files | Encryption, no egress, access log, short retention, minimal roles, sandboxed parsing. |
| Wording becomes legally false if D1 is skipped | D1 is a hard prerequisite for Phase 6 go-live. |
| One VM is a single point of failure | Offsite backups with a tested restore; documented rebuild from `provision.sh` plus a restore. Accepted trade-off for this scale. |
| Free previews used as free analysis | Previews show only summary numbers (as today), plus D11 rate limits. |
| Cutover breaks payments or sign-in | Old webhook and callback paths stay valid; payments are off at cutover anyway. |
