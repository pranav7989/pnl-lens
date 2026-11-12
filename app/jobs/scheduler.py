"""Daily jobs (IST, trading days only; each run is written to job_log). Started with the web app.
  08:20  NSE holiday list
  08:30  Dhan token renewal (only once .env has the PIN and TOTP secret)
  08:45  Dhan instrument list (Dhan publishes the new file at about 08:20)
Later phases add the live feed, option chain, NSE flows and nightly baselines here."""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app import config
from app.auth import token
from app.dhan import instruments
from app.nse import holidays
from app.store import db

log = logging.getLogger("market_iq.jobs")


def run_job(name: str, fn: Callable[[], object], trading_only: bool = True) -> str:
    """Run one job: skip on non-trading days, never raise, record the outcome."""
    con = db.connect()
    started = datetime.now(config.IST)
    if trading_only and not holidays.is_trading_day(started.date(), con):
        status, msg = "skipped", "market closed"
    else:
        try:
            out = fn()
            status, msg = "ok", str(out)[:200] if out is not None else ""
        except Exception as e:  # noqa: BLE001 - a failed job must not stop the scheduler; it is logged
            status, msg = "error", f"{type(e).__name__}: {e}"[:500]
            log.error("job %s failed: %s", name, msg)
    con.execute("insert into job_log (job, started_at, ended_at, status, message) values (?, ?, ?, ?, ?)",
                (name, started.isoformat(), datetime.now(config.IST).isoformat(), status, msg))
    con.commit()
    return status


def _renew_token() -> str:
    missing = config.secrets().missing()
    if missing:
        return "waiting for .env: " + ", ".join(missing)
    t = token.renew()
    return f"expires {t.expires_at:%d %b %H:%M}"


JOBS: list[tuple[str, int, int, Callable[[], object], bool]] = [
    ("holidays", 8, 20, holidays.refresh, False),
    ("token", 8, 30, _renew_token, True),
    ("instruments", 8, 45, instruments.refresh, True),
]


def build() -> BackgroundScheduler:
    s = BackgroundScheduler(timezone=config.IST)
    for name, hour, minute, fn, trading_only in JOBS:
        s.add_job(run_job, CronTrigger(day_of_week="mon-fri", hour=hour, minute=minute, timezone=config.IST),
                  args=[name, fn, trading_only], id=name, replace_existing=True, misfire_grace_time=900, coalesce=True)
    return s
