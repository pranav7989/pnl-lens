# Market IQ dashboard - project brief

## What we are building
A personal live dashboard for Indian index options, 3 sheets, served as a web app.
- Sheet 1 Nifty, Sheet 2 Bank Nifty (same template), Sheet 3 Market.
- All formulas and display rules: docs/parameters.pdf (source of truth).
  Approved mockups: docs/mockups/sheet1-nifty.png, sheet2-banknifty.png, sheet3-market.png.
- The owner does not code. Explain what you did in plain words after each phase,
  and tell him exactly what command to run and what he should see.

## Data sources
- Dhan API v2 (Data APIs plan): live WebSocket feed, option chain, expiry list,
  historical charts, market quote, instrument list. Docs: https://dhanhq.co/docs/v2/
- NSE public site: FII/DII cash, FII derivatives stats, index constituents/FFMC,
  holidays. Needs a browser-like session (visit home page first for cookies).
- We NEVER call Dhan order/trading endpoints. Read-only app.

## Tech stack (do not change without asking)
- Python 3.11, FastAPI + uvicorn, dhanhq (official SDK, latest 2.x), httpx,
  pandas, pyotp, APScheduler, SQLite (WAL mode) via sqlite3/SQLAlchemy core.
- Frontend: static HTML + vanilla JS + CSS (no React), TradingView
  lightweight-charts for candles; other charts are plain HTML/CSS bars.
- Browser gets data from backend over one WebSocket (/ws) + a few REST calls.
- Tests: pytest. Lint: ruff.

## Rules
- Secrets only in .env (git-ignored). Never print secrets in logs.
- Before using any Dhan or NSE field name, endpoint or security ID, verify it
  against the live docs or a real response. Do not guess. If something differs
  from this brief, stop and tell the owner.
- Respect rate limits: option chain = 1 unique request per 3 s; WebSocket
  max 5 connections x 5,000 instruments, 100 instruments per subscribe message;
  REST throttled to the documented Data API limits (default 4 req/s if unsure).
- IST timezone everywhere. Session 09:15-15:30. Skip exchange holidays.
- All calculations live in app/calc/ as pure functions with unit tests.
- Every widget shows a data-freshness state; never show stale data silently.
- Not investment advice: footer on every sheet. No buy/sell language in UI text.
- Work in phases (see docs/build_manual.pdf). Finish, test, and summarise each
  phase before starting the next. Commit to git after each phase.

## Verified facts (checked against the live docs / real files, 12 Nov 2026)
- Login: the TOTP flow needs no browser: POST https://auth.dhan.co/app/generateAccessToken
  ?dhanClientId=&pin=&totp= -> accessToken, expiryTime (24 h). The API key/secret flow needs a
  browser login every time (consent), so it is NOT used for daily renewal. Profile:
  GET https://api.dhan.co/v2/profile (header access-token) -> dataPlan "Active", dataValidity.
- Instrument file: https://images.dhan.co/api-data/api-scrip-master-detailed.csv (~38 MB, refreshed
  ~08:20 IST). SECURITY_ID is unique only per exchange + segment (2885 = RELIANCE cash and a
  currency option), so the key is (EXCH_ID, SEGMENT, SECURITY_ID).
- Index IDs (segment IDX_I): NIFTY 13, BANKNIFTY 25, FINNIFTY 27, MIDCPNIFTY 442, INDIA VIX 21
  (NSE); SENSEX 51 (BSE). Index derivatives point to UNDERLYING_SECURITY_ID 26000/26009 instead.
- Equity rows: ticker is UNDERLYING_SYMBOL (SYMBOL_NAME is the company name).
  FUTSTK UNDERLYING_SECURITY_ID = the NSE cash security id. Ignore *NSETEST symbols.
- API segment codes: IDX_I, NSE_EQ, NSE_FNO, NSE_CURRENCY, BSE_EQ, MCX_COMM, BSE_CURRENCY, BSE_FNO.
