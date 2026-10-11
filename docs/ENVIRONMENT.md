# Environment variables

Set these in DigitalOcean App Platform (Settings → App-level environment variables). Mark secrets as **Encrypted**.

**Local files (monorepo):**

| File | Read by | Holds |
|---|---|---|
| `apps/web/.env.local` | `npm run dev` (Next.js reads env from its own folder) | App variables below; copy the app part of `.env.example` |
| `.env` (repo root) | `docker compose` (variable substitution) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `LENS_APP_PASSWORD`; random, generated, never committed |
| `.env.local` (repo root) | `docker compose` → `app` service (`env_file`) | App variables for the container |

All three are git-ignored. `docker compose` refuses to start if the passwords in `.env` are missing.

| Variable | Required | Example / values | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | |
| `APP_URL` | yes | `https://pnllens.com` | Public URL (redirects, emails) |
| `STORE_DRIVER` | yes | `pg` (prod) · `file` (local) | Where reports are stored |
| `AUTH_MODE` | yes | `jwt` (prod) · `dev` (local only) | Sign-in mode |
| `DATABASE_URL` | yes | `postgresql://lens_app:…@host:25060/lens?sslmode=require` | App connection (least-privilege `lens_app`) |
| `DATABASE_SSL` | yes | `require` | |
| `DATABASE_CA_CERT` | yes on DO | `${db.CA_CERT}` | Managed Postgres CA certificate (PEM text) |
| `SESSION_SECRET` | secret | 32+ random characters | Signs session cookies |
| `OTP_PEPPER` | secret | 32+ random characters | Hashes email sign-in codes |
| `MAIL_DRIVER` | yes | `resend` · `ses` · `console` | Email provider |
| `MAIL_FROM` | yes | `PnL Lens <no-reply@pnllens.com>` | Sender |
| `RESEND_API_KEY` | secret | | Resend API key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | | Google sign-in (optional; button hides without them) |
| `PRICING_DEFAULT_COUNTRY` | no | `US` | Price when country can't be detected |
| `PAYMENTS_MODE` | no | `off` · `link` · `razorpay` | See `docs/PAYMENTS_RAZORPAY.md` |
| `PAYMENT_LINK_<PLAN>_<INR\|USD>` | link mode | `https://rzp.io/...` | Pasted Razorpay links (8 total) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | razorpay mode | | API keys |
| `RAZORPAY_WEBHOOK_SECRET` | razorpay mode | | Webhook signature secret |
| `CRON_SECRET` | optional | | Only if purge is triggered over HTTP |
| `ALLOW_DEV_AUTH_IN_PROD` | **never in prod** | — | Test-only override |
| `TZ` | yes (server) | `Asia/Kolkata` | Pinned server timezone (backend-v2 D9). The engine's date fallback is timezone-dependent; tests pin it in `vitest.config.ts` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | compose (`.env`) | random | Postgres superuser for the local stack (migrations only) |
| `LENS_APP_PASSWORD` | compose (`.env`) | random | Password set on the `lens_app` role by the `migrate` service |
