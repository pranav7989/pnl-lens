<!--
@file  docs/MARKET_IQ.md
@area  Docs
@what  Market IQ (live Market sheets inside PnL Lens): design, access rules, the private data service, settings, wording and licence rules, phases and status.
-->
# Market IQ: live Market sheets in PnL Lens

PnL Lens users with a plan (India) get three live sheets: **Nifty**, **Bank Nifty** (option positioning) and **Market** (breadth, flows, scanners). The mockups are in `services/market-iq/docs/mockups/`. The formulas come from the owner's "Parameters and calculations" PDF, with the wording overrides below.

## How it fits together
```
Browser ──> Caddy ──> web (Next): /market
                └──> api (Fastify): /api/v1/market-iq/*  ── sign-in, plan, India, flag ──>
                                                            marketiq (Python, private) :8000/internal/*
marketiq ──> Dhan API (login, instruments, live feed, history, option chain) · NSE (holidays, FII/DII, FII index futures; niftyindices.com constituents)
```
- **`services/market-iq/`** is the data service, an approved exception to the repo's Node stack (owner, 12 Nov 2026). It's Python 3.11, FastAPI and SQLite in the volume `marketiq_data`.
  - It has no published port and no login of its own.
  - Its own Docker network, `marketiq`, holds only the API and the service. That network also gives it outbound HTTPS to Dhan and NSE.
  - Every `/internal/*` call needs the header `x-internal-key: MARKETIQ_INTERNAL_KEY`. Without a key configured, the service refuses every call.
  - It runs non-root, with a read-only root filesystem and no capabilities, the same hardening as the other app containers.
- **The API is the only caller.** `apps/api/src/routes/market-iq.ts`, using `lib/market-iq.ts`, provides:
  - `GET /market-iq/access` → `{ access, reason }`;
  - `GET /market-iq/status` → the service status, for users with access (404 hidden, 403 `plan_required`, 503 `unavailable`).

  `GET /me` also returns `marketIq: boolean`, so the menu needs no extra call.
- **Web:** `/market` (`apps/web/app/(app)/market/page.tsx` and `components/market/MarketShell.tsx`).
  - The "Market" menu link shows only when `/me` says so.
  - Without a plan, the page shows an upgrade card. Anyone else gets "not found".

## Who sees it (decided on the server, rule 5)
| `MARKET_IQ_ACCESS` | Owner / admin | India user with an open plan window | India user without a plan | Outside India |
|---|---|---|---|---|
| `off` | hidden | hidden | hidden | hidden |
| `owner` (default) | ✓ | hidden | hidden | hidden |
| `paid` | ✓ | ✓ | upgrade card | hidden |

An "open plan window" means a subscription with `starts_at ≤ now < ends_at`.

**Keep `owner` until the data licence is cleared** (see below). Switching to `paid` is a one-line `.env` change and a restart of `api`.

## Settings (root `.env`)
| Variable | Who sets it | What it is |
|---|---|---|
| `DHAN_CLIENT_ID` | owner | Dhan account number (not a secret) |
| `DHAN_PIN`, `DHAN_TOTP_SECRET` | owner, typed into `.env`, never into a chat | Daily automatic Dhan login. The TOTP secret is the text under the QR code at Dhan Web → DhanHQ APIs → Set up TOTP |
| `MARKETIQ_INTERNAL_KEY` | `npm run stack:env` | Shared key between the API and the service |
| `MARKET_IQ_ACCESS` | owner | `off` / `owner` / `paid` |

## Rules that override the PDF
- **No advice wording** (owner: "no SEBI issues"):
  - the sentiment bands are *Strongly bearish / Bearish / Neutral / Bullish / Strongly bullish* positioning, never Buy/Sell;
  - the decoder never says "edge leans to sellers"; the IV line reads "Rich: priced above ATM IV" or "Cheap: priced below ATM IV";
  - every sheet carries "Market data and analytics only. Not investment advice."
- **Data licence:** the Dhan Data API plan and NSE's website data are for personal use. Showing them to paying users needs a redistribution or vendor licence: Dhan partner terms, or an NSE-authorised data vendor. **This is an owner blocker before `paid`.**
- **Read-only:** the service never calls Dhan order or trading endpoints.

## Phases
| Phase | What | State |
|---|---|---|
| 0–2 | Skeleton, Dhan login (client ID + PIN + TOTP, no browser), instruments (segment-safe keys, 218 F&O stocks), NSE holidays, daily jobs 08:20 / 08:30 / 08:45 IST | done |
| PnL Lens foundation (PR #31) | Internal API with key, Docker service in dev and prod, API access rules, `/market` page, stack/API/e2e tests, CI | done |
| 3 (PR #32) | Live feed: one Dhan WebSocket, Ticker + Quote for 444 instruments (6 indices, Nifty/Bank Nifty futures, 218 F&O stocks cash + near-month futures), 1-minute bars in SQLite, today's backfill, auto-reconnect, 09:00–15:35; status on the Market page | done (live check 12 Nov: 444/444 updating) |
| 4 (PR #33) | Option chain for Nifty and Bank Nifty (all strikes, both sides: LTP, OI, previous OI, volume, IV, Greeks, bid/ask), one request every 3 s in turns (Dhan answers 429 otherwise), snapshot every minute for the time bar, read back at any minute, expiries, 23:00 clean-up (chains 30 days, bars 90) | done (live: 0 errors, 264 + 400 strikes fresh) |
| 5 (PR #34) | FII/DII cash every evening (NSE gives the latest day only; CSV backfill), FII index futures from NSE's daily file (19 days filled at once), Nifty 50 / Nifty Bank constituents (niftyindices.com), index weights **estimated** from our minute bars because NSE's weights endpoint is gone (404); previous closes saved daily | done |
| 6 | Formulas (`app/calc`) with tests, with the wording above | |
| 7 | Sheet data through the API (`/market-iq/sheet/*`) | |
| 8–9 | The sheets as PnL Lens pages | |

## Tests
- `services/market-iq`:
  - `pytest` (24): token, instruments, holidays, scheduler, internal key;
  - `ruff`;
  - run with `npm run test:market-iq`, or in CI.
- `apps/api/test/market-iq.test.ts`: the access rule, and routes with a fake service (key sent, 401/403/404/503).
- `tests/stack`:
  - only the API reaches the service, and the key is required;
  - web, worker and Caddy can't reach it;
  - it has egress, runs non-root and read-only, and isn't routed by Caddy.
- `tests/e2e-web/market-iq.spec.ts`: the owner sees the link and page and the phone layout fits; a paying user sees neither while access is `owner`.
