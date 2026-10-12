# PnL Lens — project instructions

## Product
PnL Lens (pnllens.com) is a paid web app. A trader uploads broker P&L statements /
tradebooks (CSV, XLSX, XLS, PDF, DOC). The app auto-detects columns (the user is NEVER
asked to map columns) and produces a dashboard: Overview, Progress, Insights & fixes,
Clusters, Positions. Two sites: India (INR) and Global (USD). Plans: Single, Snapshot,
Progress, Discipline (see packages/shared/src/pricing.ts). "File" = one broker statement.

## Current state (backend-v2, Phases 1–8 done; see docs/BACKEND_V2_PLAN.md results)
- npm workspaces monorepo; run commands from the repo root. Start with docs/INDEX.md and docs/ARCHITECTURE.md.
- apps/web: Next.js 15 + React 19, no DB access and no API routes; it calls apps/api (Fastify, /api/v1).
- The engine runs on the SERVER in apps/worker (BullMQ, isolated child process). Engine parity =
  packages/engine/test/golden (see docs/TESTING.md).
- PostgreSQL migrations packages/db/migrations/0001–0018 (0001–0007 are frozen). Files are stored
  encrypted in Garage; roles lens_app / lens_worker / lens_research.
- Payments are built but off (PAYMENTS_MODE=off|razorpay). See docs/PAYMENTS_RAZORPAY.md.
- Production: infra/compose.prod.yml + infra/scripts (docs/DEPLOYMENT_VM.md, docs/RUNBOOK.md,
  docs/GO_LIVE_CHECKLIST.md).

## Goal of this branch (backend-v2)
Move parsing and analysis to the server and store raw files, normalised trades and
computed metrics in PostgreSQL, running on one Ubuntu 24.04 VM with Docker Compose.
AI/ML features are OUT OF SCOPE. Only make the data model ready for them.
The approved plan is docs/BACKEND_V2_PLAN.md.

## Stack (fixed)
Node 22, TypeScript strict, npm workspaces. apps/web (Next.js), apps/api (Fastify),
apps/worker (BullMQ), packages/engine, packages/db, packages/shared, infra/.
PostgreSQL 16, Redis 7, Garage (S3-compatible; replaced MinIO, plan D14), Caddy.

## Rules — non-negotiable
1. Do not change engine behaviour. Move it to packages/engine and prove parity:
   same input file -> identical output JSON as before, via golden-file tests.
2. No secrets in git. Use .env (git-ignored) and keep .env.example up to date.
3. Never edit migrations 0001–0007. Add new numbered migrations only.
4. The app connects to the DB as the least-privilege role, never as superuser.
5. Plans, credits, statements-per-report and validity are enforced on the SERVER.
6. A plan is granted ONLY by the verified payment webhook (grant_plan), never by the browser.
   Approved exception (plan D5): an owner-only manual grant in the admin console, role checked
   in the DB, reason required, recorded in the audit log.
7. Privacy: raw files are private and encrypted, access is logged, the user gives explicit
   consent at upload, and use of data for research/AI is a separate opt-in that is off by default.
8. Keep the existing UI, wording and features exactly. This is a backend move, not a redesign.
   Approved exception: the privacy/expiry strings in plan §2.1, applied only after owner sign-off.
9. Every new file gets the @file/@area/@what header. Run `npm run docs:index` after adding files.
10. Work one phase at a time. Stop at the end of a phase, list what was done, what was
    tested and what is left. Do not start the next phase unasked.

## Key decisions (see plan §2)
Raw files: kept 30 days then auto-deleted. Reports and trades never expire (deleted only by the
user or account closure); plan validity only gates creating new reports. Link payment mode is
removed (off | razorpay only). Server TZ = Asia/Kolkata. Fresh start, no data migration.

## Commands
- Dev stack: `npm run stack:env` (once) · `npm run stack:up` · `npm run test:stack` · `npm run stack:down`
  (= `docker compose --env-file .env -f infra/compose.dev.yml …`; see docs/INFRA.md)
- Tests: `npm test`  Type check: `npm run typecheck`  Lint: `npm run lint`
- Migrations: `npm run db:migrate`
- DB tests: `npm run db:test:up` then `npm run test:db` (throwaway Postgres, infra/compose.test.yml)
- Windows dev machine: Node/Git were installed via winget; a terminal opened before that may need
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

## Definition of done (every phase)
Tests pass, typecheck passes, docs updated, no secrets committed, and a short summary written.
