# @file  services/market-iq/app/main.py
# @area  Market IQ
# @what  Internal FastAPI app (no public port): /healthz for Docker, /internal/* data for the PnL Lens API only (x-internal-key), and the daily jobs while it runs.
"""Internal Market IQ service. Users never reach it: Caddy has no route here and only the PnL Lens API shares its
network. The API checks sign-in, plan and region, then calls /internal/* with the shared key MARKETIQ_INTERNAL_KEY.
Set MARKET_IQ_SCHEDULER=off to run without the daily jobs (tests do). Sheet data endpoints arrive with Phases 3-7."""
from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException

from app import config
from app.auth import token
from app.dhan import instruments
from app.nse import holidays
from app.store import db

MIN_KEY = 32


@asynccontextmanager
async def lifespan(_: FastAPI):
    sched = None
    if os.getenv("MARKET_IQ_SCHEDULER", "on") != "off":
        from app.jobs import scheduler
        sched = scheduler.build()
        sched.start()
    yield
    if sched:
        sched.shutdown(wait=False)


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
            "phase": "foundation: live sheets arrive with Phases 3-7"}
