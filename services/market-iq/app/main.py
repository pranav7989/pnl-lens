# @file  services/market-iq/app/main.py
# @area  Market IQ
# @what  Internal FastAPI app (no public port): /healthz for Docker, /internal/* data for the PnL Lens API only (x-internal-key), and the daily jobs while it runs.
"""Internal Market IQ service. Users never reach it: Caddy has no route here and only the PnL Lens API shares its
network. The API checks sign-in, plan and region, then calls /internal/* with the shared key MARKETIQ_INTERNAL_KEY.
Set MARKET_IQ_SCHEDULER=off to run without the daily jobs (tests do). Sheet data endpoints arrive with Phases 3-7."""
from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException

from app import config, sheets
from app.auth import token
from app.dhan import chain, feed, instruments
from app.nse import holidays
from app.store import db

MIN_KEY = 32
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")   # our loggers into the container log


@asynccontextmanager
async def lifespan(_: FastAPI):
    sched = None
    if os.getenv("MARKET_IQ_SCHEDULER", "on") != "off":
        from app.jobs import scheduler
        sched = scheduler.build()
        sched.start()
        if feed.in_window() and not config.secrets().missing():   # restarted during market hours: resume now
            import threading
            threading.Thread(target=scheduler.run_job, args=("feed_start", feed.start_job), daemon=True).start()
        if chain.in_window() and not config.secrets().missing():
            import threading
            threading.Thread(target=scheduler.run_job, args=("chain_start", chain.start_job), daemon=True).start()
    yield
    if sched:
        sched.shutdown(wait=False)
    feed.FEED.stop()
    chain.POLLER.stop()


app = FastAPI(title="Market IQ (internal)", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def require_key(x_internal_key: str = Header(default="")) -> None:
    """Constant-time check of the shared key. No key configured = the service answers nothing."""
    want = config.internal_key()
    if len(want) < MIN_KEY:
        raise HTTPException(503, "MARKETIQ_INTERNAL_KEY is not set")
    if not hmac.compare_digest(x_internal_key.encode(), want.encode()):
        raise HTTPException(401, "unauthorised")


@app.get("/healthz")
def healthz() -> dict:
    """Docker healthcheck: says only that the process is up."""
    return {"status": "ok"}


def _session_state(now: datetime, trading_day: bool) -> str:
    if not trading_day:
        return "closed"
    t = now.time()
    if t < config.SESSION_OPEN:
        return "pre_open"
    return "open" if t <= config.SESSION_CLOSE else "closed"


@app.get("/internal/status", dependencies=[Depends(require_key)])
def status() -> dict:
    """What the owner needs to see: login, instrument list, market session and the last run of each daily job. No secrets."""
    con = db.connect()
    now = datetime.now(config.IST)
    missing = config.secrets().missing()
    t = token.load(con)
    tok = {"configured": not missing, "missing": missing,
           "state": "none" if not t else ("ok" if t.valid(now) else "expired"),
           "expires_at": t.expires_at.isoformat() if t else None}
    n = con.execute("select count(*) as n from instruments").fetchone()["n"]
    trading = holidays.is_trading_day(now.date(), con)
    jobs = {r["job"]: {"status": r["status"], "at": r["started_at"], "message": r["message"]} for r in con.execute(
        "select job, status, started_at, message from job_log where id in (select max(id) from job_log group by job)")}
    return {"as_of": now.isoformat(), "token": tok, "instruments": {"count": n, "as_of": instruments.as_of(con)},
            "market": {"trading_day": trading, "session": _session_state(now, trading)}, "jobs": jobs,
            "feed": {k: v for k, v in feed.FEED.summary(now).items() if k != "recent"},
            "chain": chain.POLLER.summary(now),
            "bars_today": con.execute("select count(*) as n from bars_1m where ts >= ?", (now.strftime("%Y-%m-%dT00:00"),)).fetchone()["n"],
            "phase": "Phase 7: sheet data ready; the PnL Lens pages are next"}


@app.get("/internal/feed", dependencies=[Depends(require_key)])
def feed_debug() -> dict:
    """The build manual's /debug/feed: instrument counts and the 10 most recently updated symbols."""
    return feed.FEED.summary()


@app.get("/internal/chain/{underlying}", dependencies=[Depends(require_key)])
def chain_rows(underlying: str, expiry: str | None = None, at: str | None = None, window: int = 20) -> dict:
    """Phase 4 check: the chain around ATM (live, or the snapshot at `at` = 'YYYY-MM-DDTHH:MM' IST)."""
    u = underlying.upper()
    if u not in chain.UNDERLYINGS:
        raise HTTPException(404, "unknown underlying")
    when = datetime.fromisoformat(at).replace(tzinfo=config.IST) if at else None
    c = chain.get_chain(u, expiry, when)
    if not c:
        return {"available": False}
    strikes = list(c.rows)
    atm = min(strikes, key=lambda k: abs(k - (c.spot or 0))) if strikes and c.spot else None
    i = strikes.index(atm) if atm is not None else 0
    pick = strikes[max(0, i - window): i + window + 1]
    return {"available": True, "underlying": u, "expiry": c.expiry, "spot": c.spot, "atm": atm, "as_of": c.as_of.isoformat(),
            "live": c.live, "fresh": c.fresh(), "expiries": chain.expiries(db.connect(), u),
            "rows": [{"strike": k, "ce": c.rows[k]["ce"], "pe": c.rows[k]["pe"]} for k in pick]}


def _at(at: str | None) -> datetime | None:
    if not at:
        return None
    try:
        return datetime.fromisoformat(at).replace(tzinfo=config.IST)
    except ValueError:
        raise HTTPException(400, "at must be YYYY-MM-DDTHH:MM (IST)") from None


@app.get("/internal/sheet/{underlying}", dependencies=[Depends(require_key)])
def sheet(underlying: str, expiry: str | None = None, at: str | None = None) -> dict:
    """Sheet 1/2: everything for the Nifty or Bank Nifty page, live or at a past minute of today."""
    u = underlying.upper()
    if u not in sheets.INDEX_NAME:
        raise HTTPException(404, "unknown underlying")
    try:
        return sheets.index_sheet(u, expiry, _at(at))
    except LookupError as e:
        raise HTTPException(503, f"not ready: {e}") from None


@app.get("/internal/decoder/{underlying}", dependencies=[Depends(require_key)])
def decoder_route(underlying: str, strike: float, side: str, expiry: str | None = None, at: str | None = None) -> dict:
    u = underlying.upper()
    if u not in sheets.INDEX_NAME or side.lower() not in ("ce", "pe"):
        raise HTTPException(404, "unknown underlying or side")
    d = sheets.decode_strike(u, strike, side, expiry, _at(at))
    if not d:
        raise HTTPException(404, "no such strike")
    return d


@app.get("/internal/market", dependencies=[Depends(require_key)])
def market() -> dict:
    """Sheet 3: breadth, flows, momentum, R-factor, futures buildup, movers."""
    return sheets.market_sheet()


@app.get("/internal/header", dependencies=[Depends(require_key)])
def header_route() -> dict:
    return {"as_of": datetime.now(config.IST).isoformat(), "indices": sheets.header()}
