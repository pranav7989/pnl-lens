# Market IQ data service

This is the private data service behind PnL Lens's live Market sheets (Nifty, Bank Nifty, Market; India only).
- It is read-only: it never places orders.
- It has no public port and no login of its own. Users reach the sheets through PnL Lens, which checks sign-in, plan and region.
- The full design is in `docs/MARKET_IQ.md` at the repo root. The brief for Claude Code is `CLAUDE.md` in this folder.

## In the stack
- `docker compose` runs it as the `marketiq` service, from `infra/docker/marketiq.Dockerfile`.
- Its settings come from the repo's root `.env`:
  - `DHAN_CLIENT_ID`, `DHAN_PIN` and `DHAN_TOTP_SECRET`, which you fill in yourself;
  - `MARKETIQ_INTERNAL_KEY`, which `npm run stack:env` generates.

## Local commands (run in this folder)
| What | Command |
|---|---|
| One-time setup | `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| Check the Dhan login | `.venv/bin/python -m app.auth.token --check` |
| Instrument IDs | `.venv/bin/python -m app.dhan.instruments` (add `--download` to force a fresh list) |
| Tests and lint | `.venv/bin/pytest -q` and `.venv/bin/ruff check .` |

## Status
| Phase | What | State |
|---|---|---|
| 0 | Skeleton | done |
| 1 | Dhan login (client ID + PIN + TOTP, no browser) | done; needs `.env` filled in |
| 2 | Instrument list, NSE holidays, daily jobs | done |
| PnL Lens foundation | Internal API with key, Docker service, API access checks, `/market` page | done |
| 3 | Live feed: 444 instruments (indices, index futures, F&O cash + futures), 1-minute bars, backfill, auto-reconnect | done |
| 4 | Option chain poller (Nifty/Bank Nifty in turns, one request per 3 s), snapshots every minute, time-bar read-back, expiries, nightly clean-up | done |
| 5 | FII/DII cash (daily), FII index futures (30 days at once), index constituents, index weights estimated from minute bars, previous closes | done |
| 6 | Formulas in `app/calc` (KPIs, max pain, ΔOI, sentiment as positioning, decoder, contributions, scanners) with hand-checked tests; nightly volume baselines | done |
| 7 | Sheet data through the internal API: `/internal/sheet/{NIFTY\|BANKNIFTY}?expiry=&at=`, `/internal/decoder/...`, `/internal/market`, `/internal/header` | done |
| 8–9 | The sheets as PnL Lens pages | next |
