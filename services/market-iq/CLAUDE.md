# Market IQ dashboard - project brief (service inside the PnL Lens repo)

## What we are building
Live Market sheets for PnL Lens users with a paid plan (India): Sheet 1 Nifty, Sheet 2 Bank Nifty (same template),
Sheet 3 Market. This folder is the private Python DATA SERVICE only (approved exception to the repo's Node stack,
owner 12 Nov 2026). It has no public port and no login of its own:
  browser -> PnL Lens web (/market) -> PnL Lens API /api/v1/market-iq/* (sign-in, paid plan, India, flag
  MARKET_IQ_ACCESS) -> this service /internal/* with header x-internal-key = MARKETIQ_INTERNAL_KEY.
The sheets are PnL Lens React pages using the PnL Lens design system, NOT static HTML here. See docs/MARKET_IQ.md.
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
- Frontend: PnL Lens Next.js pages (apps/web/app/(app)/market), TradingView lightweight-charts
  for candles; other charts are plain HTML/CSS bars. Browsers poll the PnL Lens API (3 s); never this service.
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
- Wording overrides docs/parameters.pdf (owner: "no SEBI issues"): sentiment bands are
  Strongly bearish / Bearish / Neutral / Bullish / Strongly bullish (positioning), never Buy/Sell;
  the decoder never says "edge leans to sellers" (IV line: "Rich: priced above ATM IV" / "Cheap: priced below ATM IV").
- Data licence: Dhan Data API and NSE website data are for personal use. Keep MARKET_IQ_ACCESS=owner
  until the owner confirms a redistribution/vendor licence; only then switch to paid.
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
- Live feed (verified live 12 Nov 2026): wss://api-feed.dhan.co?version=2&token=&clientId=&authType=2. Subscribe
  RequestCode 15 (Ticker) AND 17 (Quote) - previous close (packet 6) comes ONLY with Ticker. One frame holds several
  packets; each packet's int16 length includes its 8-byte header. Packet 6's previous OI is float32 (docs: int32).
  Last trade time = IST wall clock written as UTC epoch; /charts/intraday timestamps are true UTC epoch.
  Live index volume is 0 (use the index future's volume). 444 instruments on one connection, all updating.
- generateAccessToken may replace the previous token: run the service in ONE place (the stack); the local
  --check CLI is for checks only.
- Option chain (verified live 12 Nov 2026): POST /v2/optionchain {UnderlyingScrip 13|25, UnderlyingSeg IDX_I, Expiry}
  -> data.last_price, data.oc{"25250.000000": {ce, pe}} with last_price, previous_close_price, oi, previous_oi, volume,
  implied_volatility, greeks{delta,gamma,theta,vega}, top_bid/ask. OI is in units. The real limit is ONE chain request
  per 3 s per account (a second underlying in the same 3 s gets HTTP 429), so Nifty and Bank Nifty alternate (~6 s each).
- NSE (verified live 12 Nov 2026): /api/fiidiiTradeReact works (latest day only, strings in Rs crore).
  FII index futures: nsearchives.nseindia.com/content/fo/fii_stats_DD-Mon-YYYY.xls (old Excel, row "INDEX FUTURES";
  any past day; 404 on holidays). /api/equity-stockIndices is GONE (404) and /api/quote-equity refuses scripts (403),
  so free-float weights are not available: constituents come from niftyindices.com CSVs and weights are ESTIMATED
  daily by least squares on our minute bars (index return = sum w_i * stock return; app/nse/weights.py).
- SQLite schema changes: tables are created with "if not exists", so a changed key needs the table dropped on
  existing installs (no migration tool here yet).
- History (verified live 12 Nov 2026): one /charts/intraday request returns up to 90 days of 1-minute bars; more
  than ~4 quick requests get HTTP 429, so nightly jobs pace at one request per second.

