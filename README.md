# PnL Lens

Private trading-statement analysis: upload a broker P&L statement or tradebook, get a dashboard of habits, leaks, progress and next steps. pnllens.com.

**Start with [`docs/INDEX.md`](docs/INDEX.md)** — the master index (folder map, where to change what, every file explained).

| Quick start | |
|---|---|
| Requirements | Node.js 22.13+ (npm workspaces monorepo; run commands from the repo root) |
| Local, zero setup | `npm install && npm run dev` (file store, dev sign-in) |
| Checks | `npm test` · `npm run typecheck` · `npm run lint` |
| Production-like | `docker compose up --build` (needs the passwords in `.env`, see [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)) |
| Backend v2 plan | [`docs/BACKEND_V2_PLAN.md`](docs/BACKEND_V2_PLAN.md) |
| Deploy | [`docs/DEPLOYMENT_DIGITALOCEAN.md`](docs/DEPLOYMENT_DIGITALOCEAN.md) |
| Payments | [`docs/PAYMENTS_RAZORPAY.md`](docs/PAYMENTS_RAZORPAY.md) |
| Environment | [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) |
| Tests | [`docs/TESTING.md`](docs/TESTING.md) |
