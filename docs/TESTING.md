# Testing

| Suite | Command | Needs |
|---|---|---|
| Unit (engine, PDF/Word, behaviour, sign-in, roles, payments) | `npm test` | nothing |
| Postgres integration | `TEST_ADMIN_URL=… TEST_DATABASE_URL=… npm test` | local Postgres with migrations |
| SQL functions | `psql $ADMIN_URL -f db/tests/01_functions.sql` | Postgres |
| Report flow (browser) | `python3 tests/e2e/flow.py` | server on :3100, `AUTH_MODE=dev` |
| Report v2 + PDF/Word (browser) | `python3 tests/e2e/v2.py` | same |
| Sign-in (browser) | `node tests/e2e/mock-google.mjs & python3 tests/e2e/auth.py` | `AUTH_MODE=jwt`, see file header |
| Admin + roles (browser) | `ADMIN_URL=… python3 tests/e2e/admin.py` | `STORE_DRIVER=pg`, demo data (`scripts/seed-admin-demo.mjs`) |
| Payments | `ADMIN_URL=… MODE=off\|link\|webhook python3 tests/e2e/payments.py` | `STORE_DRIVER=pg`; webhook mode needs `RAZORPAY_WEBHOOK_SECRET=whsec_test` |

Browser tests need Python + Playwright (`pip install playwright && playwright install chromium`).
Run a production-like server locally: `npm run build`, copy `.next/static` and `public` into `.next/standalone`, then `node .next/standalone/server.js`.
