# Testing

Run from the repo root (npm workspaces). Node 22.13+.

| Suite | Command | Needs |
|---|---|---|
| Everything (unit + engine parity) | `npm test` | nothing |
| Type check (all packages) | `npm run typecheck` | nothing |
| Lint | `npm run lint` | nothing |
| Engine only (formats, PDF/Word, behaviour, **golden parity**) | `npm test -w @pnl-lens/engine` | nothing |
| Web only (sign-in codes, payments, roles) | `npm test -w @pnl-lens/web` | nothing |
| Postgres integration | `TEST_ADMIN_URL=… TEST_DATABASE_URL=… npm run test:db` | local Postgres with migrations |
| SQL functions | `psql $ADMIN_URL -f packages/db/tests/01_functions.sql` | Postgres |
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
