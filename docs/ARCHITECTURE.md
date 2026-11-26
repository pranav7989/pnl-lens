# Architecture (backend v2)

One Ubuntu 24.04 VM runs everything with Docker Compose. Cloudflare sits in front. Only Caddy is reachable from the internet.

```
browser ──HTTPS──► Cloudflare ──► Caddy :443 ─┬─ /api/*  ──► api (Fastify, lens_app) ──┬─► Postgres 16
                                               └─ else    ──► web (Next.js 15)          ├─► Redis 7 (BullMQ, rate limits)
                                                   web ──server-side──► api :4000        └─► Garage S3 (write-only key)
                                       internal network (no internet) ─────────────────────────────────────────────
                                       worker (BullMQ, lens_worker) ──► Postgres · Redis · Garage (read/delete)
                                         └─ engine child process per job (512 MB cap, 60 s timeout)
```

| Service | Code | Role |
|---|---|---|
| caddy | `infra/caddy/Caddyfile` | TLS, security headers and CSP, routing (`/api/*` → api, everything else → web) |
| web | `apps/web` | Pages and the report workspace. **No database access, no API routes**: server components call the api with the visitor's cookie (`lib/api-client.ts`); the browser calls `/api/v1` (`lib/api-browser.ts`) |
| api | `apps/api` (`docs/API.md`) | Sessions, uploads (type check, AES-256-GCM per file, storage, job), reports, plans, payments, admin, privacy. Connects as `lens_app` only |
| worker | `apps/worker` (`docs/WORKER.md`) | Fetches and decrypts files, runs the unchanged engine in a child process, stores results in one transaction; data exports; nightly purge and storage sweep |
| postgres | `packages/db/migrations` | Accounts, plans, payments, analyses, reports, trades, metrics, consents, logs. Business rules live in SECURITY DEFINER functions (plans, file-set lock, delete, export) |
| redis | — | BullMQ queues (`analyses`, `data-requests`, `maintenance`) and rate-limit counters |
| garage | `infra/garage`, `infra/scripts/storage-init.mjs` | Private buckets `statements` (api write-only, worker read/delete) and `exports` (worker write/delete, api read-only) |

## Upload → report

1. The browser posts 1–3 files with `consent=true` to `POST /api/v1/analyses`.
2. The api checks the D11 limits, the plan's statements per report and the real file type (`sniff.ts`, using the engine's `detectKind`). It encrypts each file with a fresh key wrapped by `FILE_KEK_<id>`, stores it, writes the analysis, file, access-log and consent rows, and queues `analysis-<id>`.
3. The worker decrypts the files in memory (logged) and runs `engine-child.js`: every file through `fileToRawSheets` in upload order, then `analyzeRaw` over all sheets. These are the parity rules, byte-identical to the original engine. Each file is also analysed alone for its own dashboard and its file-set fingerprint.
4. One transaction stores the payload, trades, fills, metrics, traits, per-file reports, parse runs and fingerprints, then sets the status to `ready`.
5. The workspace follows `GET /analyses/:id`. With a plan that has reports left it calls `POST /reports`: `create_report_from_analysis()` spends one report and the report never expires. Without a plan, the free preview is shown.
6. "+" uploads with `reportId`, then `POST /reports/:id/files` (`add_analysis_to_report()`: the file-set lock, nothing spent). × re-analyses the remaining files.

A bad file fails for good with the engine's message. Infrastructure errors are retried 3 times, then dead-lettered. **No report is created from a failed analysis, so no credit is spent.**

## Security model

| Layer | Measure |
|---|---|
| Network | Only Caddy published; data services and the worker on an internal network with no internet route |
| Identity | Email code or Google OIDC; `lens_session` HS256 JWT in an httpOnly, Secure, SameSite=Lax cookie; the account must still be active on every request |
| Requests | CSRF origin check on every state-changing request; rate limits; zod validation; JSON body limit 64 KB; upload limits |
| Database | Separate roles: `lens_app` (no DDL/DELETE; no direct writes to credits, subscriptions or report contents), `lens_worker` (no accounts, payments or consents), `lens_research` (no login). Plans are granted only by the verified Razorpay webhook or the owner-only, audited manual grant |
| Files | Per-file envelope encryption; key shredding on deletion; write-only storage key for the api; every read/decrypt logged; deleted 30 days after upload |
| Headers | HSTS, nosniff, frame deny, referrer and permissions policy, COOP, CSP (self + Razorpay + Google form post) |
| Containers | Read-only root filesystems, no capabilities, no-new-privileges, memory limits, non-root app users |
| Supply chain | Pinned images and package versions (two-week minimum age); dependency audit with a dated allow-list; gitleaks secret scan |

Privacy facts (what is stored, how long, who can read it): `docs/PRIVACY_NOTES.md`. Decisions and phase results: `docs/BACKEND_V2_PLAN.md`.
