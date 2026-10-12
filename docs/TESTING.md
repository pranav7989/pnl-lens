# Testing

Run from the repo root (npm workspaces). Node 22.13+.

| Suite | Command | Needs |
|---|---|---|
| Everything (unit + engine parity) | `npm test` | nothing |
| Type check (all packages) | `npm run typecheck` | nothing |
| Lint | `npm run lint` | nothing |
| Engine only (formats, PDF/Word, behaviour, **golden parity**) | `npm test -w @pnl-lens/engine` | nothing |
| Web only (sign-in codes, payments, roles) | `npm test -w @pnl-lens/web` | nothing |
| **API** (routes on real Postgres: sign-in, CSRF, uploads, limits, encryption, reports, credits, file-set lock, webhook replay, RBAC; plus type check, encryption, OpenAPI, rate limit) | `npm run db:test:up` then `npm test -w @pnl-lens/api` | the test Postgres for the route suites (they skip without it) |
| **Worker** (all 22 golden cases through the real pipeline, byte-identical; failures cost no credit; idempotency; retries + dead letter on real Redis; hostile files; purge + sweep) | `npm run db:test:up` then `npm test -w @pnl-lens/worker` | test Postgres + Redis (DB/queue suites skip without them); builds `apps/worker/dist` first |
| OpenAPI spec | `npm run openapi -w @pnl-lens/api` regenerates `apps/api/openapi.json` | nothing |
| **Docker stack** (health, only Caddy exposed, network isolation, DB/Redis/storage least privilege, API upload → queue → encrypted object; worker → ready report equal to the golden) | `npm run stack:up` then `npm run test:stack` | Docker Desktop running; `.env` from `npm run stack:env` |
| **Database v2** (migrations from 0001 and from 0007, plan rules, races, file-set lock, role denials, purge/delete, research views, worker store step) | `npm run db:test:up` then `npm run test:db` | Docker Desktop running; `.env` from `npm run stack:env` |
| Web Postgres store (old flow, until Phase 6) | `TEST_ADMIN_URL=… TEST_DATABASE_URL=… npm run test:db -w @pnl-lens/web` | a migrated database (e.g. on the test Postgres) |
| SQL functions (old flow) | `psql $ADMIN_URL -f packages/db/seed.sql -f packages/db/tests/01_functions.sql` | migrated Postgres |
| Report flow (browser) | `python3 tests/e2e/flow.py` | server on :3100, `AUTH_MODE=dev` |
| Report v2 + PDF/Word (browser) | `python3 tests/e2e/v2.py` | same |
| Sign-in (browser) | `node tests/e2e/mock-google.mjs & python3 tests/e2e/auth.py` | `AUTH_MODE=jwt`, see file header |
| Admin + roles (browser) | `ADMIN_URL=… python3 tests/e2e/admin.py` | `STORE_DRIVER=pg`, demo data (`npm run seed:admin-demo -w @pnl-lens/db`) |
| Payments | `ADMIN_URL=… MODE=off\|link\|webhook python3 tests/e2e/payments.py` | `STORE_DRIVER=pg`; webhook mode needs `RAZORPAY_WEBHOOK_SECRET=whsec_test` |

Browser tests need Python + Playwright (`pip install playwright && playwright install chromium`).
Run a production-like server locally: `npm run build`, copy `apps/web/.next/static` to `apps/web/.next/standalone/apps/web/.next/static` and `apps/web/public` to `apps/web/.next/standalone/apps/web/public`, then from `apps/web/.next/standalone` run `node apps/web/server.js`.

## Engine parity (golden files)

`packages/engine/test/golden/*.json` were generated from the **original** browser engine (commit `3bdf976`, before the move) for every fixture, plus multi-file and currency-override cases. `golden.test.ts` runs each case through `src/node.ts` (the path the server worker uses) and requires byte-identical JSON. Only `generatedAt` is normalised.

- The timezone is pinned to `Asia/Kolkata` in `vitest.config.ts`. Under UTC, 9 of the 22 cases differ, because the engine parses some timestamps in local time.
- An intentional engine change must regenerate the goldens and have the JSON diff reviewed: `UPDATE_GOLDENS=1 npm test -w @pnl-lens/engine`.
- Never regenerate goldens to make a failing test pass without understanding the diff.

## Database tests (packages/db)

`npm run db:test:up` starts a throwaway Postgres 16 (`infra/compose.test.yml`: 127.0.0.1:55432, data in memory, its own compose project, so the dev stack's "only Caddy is published" test still holds). `npm run test:db` then runs `packages/db/test/db/*`. Each suite creates a fresh database and migrates it with the real `migrate.mjs` and `setup-roles.mjs`, the same scripts the stack's `migrate` job runs. Clients connect as `lens_app` and `lens_worker` with the passwords from `.env`.

- Without the test Postgres these suites are skipped, and `npm test` still runs the 33 DB-free tests (`test/normalise.test.ts`).
- `npm run db:test:down` removes the container. Nothing is kept.
- Permission tests run SQL with `set role <role>` inside an admin session. Login tests (for example "lens_research cannot log in") open real connections.
