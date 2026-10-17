# PnL Lens

Private trading-statement analysis: upload a broker P&L statement or tradebook, get a dashboard of habits, leaks, progress and next steps. pnllens.com.

**Start with [`docs/INDEX.md`](docs/INDEX.md)** — the master index (folder map, where to change what, every file explained).

| Quick start | |
|---|---|
| Requirements | Node.js 22.13+ (npm workspaces monorepo; run commands from the repo root) |
| Local stack | `npm ci && npm run stack:env && npm run stack:up` → http://localhost:8080 (dev sign-in) |
| Checks | `npm test` · `npm run typecheck` · `npm run lint` · `npm run test:stack` · `npm run test:e2e` (see [`docs/TESTING.md`](docs/TESTING.md)) |
| How it fits together | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/INFRA.md`](docs/INFRA.md) · [`docs/API.md`](docs/API.md) · [`docs/WORKER.md`](docs/WORKER.md) |
| Privacy facts | [`docs/PRIVACY_NOTES.md`](docs/PRIVACY_NOTES.md) |
| Backend v2 plan | [`docs/BACKEND_V2_PLAN.md`](docs/BACKEND_V2_PLAN.md) |
| Deploy and operate | [`docs/DEPLOYMENT_VM.md`](docs/DEPLOYMENT_VM.md) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) · [`docs/GO_LIVE_CHECKLIST.md`](docs/GO_LIVE_CHECKLIST.md) |
| Payments | [`docs/PAYMENTS_RAZORPAY.md`](docs/PAYMENTS_RAZORPAY.md) |
| Environment | [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) |
| Tests | [`docs/TESTING.md`](docs/TESTING.md) |
