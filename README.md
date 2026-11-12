# Market IQ (FlowLens, working name)

Personal live dashboard for Indian index options: Nifty, Bank Nifty and Market sheets.
Read-only: it never places orders. Data and analytics only, not investment advice.
The project brief for Claude Code is `CLAUDE.md`; the formulas are in `docs/parameters.pdf`.

## Commands (run in this folder)
| What | Command |
|---|---|
| Start the app | `.venv/bin/uvicorn app.main:app --port 8000`, then open http://127.0.0.1:8000 |
| Check the Dhan login | `.venv/bin/python -m app.auth.token --check` |
| Instrument IDs | `.venv/bin/python -m app.dhan.instruments` (add `--download` to force a fresh list) |
| Tests and lint | `.venv/bin/pytest -q` and `.venv/bin/ruff check .` |

## Status
- Phase 0: skeleton, done.
- Phase 1: Dhan login by client ID, PIN and TOTP (no browser), done. Needs `.env` filled in.
- Phase 2: instrument list, index IDs, F&O stocks, NSE holidays and the daily jobs, done.
