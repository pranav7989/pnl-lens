# @file  services/market-iq/app/jobs/scheduler.py
# @area  Market IQ
# @what  Daily jobs in IST on trading days (holidays 08:20, token 08:30, instruments 08:45), each recorded in job_log.
"""Daily jobs (IST, trading days only; each run is written to job_log). Started with the web app.
  08:20  NSE holiday list
  08:30  Dhan token renewal (only once .env has the PIN and TOTP secret)
  08:45  Dhan instrument list (Dhan publishes the new file at about 08:20)
  09:00  live feed start (+ today's backfill)      15:35  live feed stop
  09:15  option chain poller start (3 s, snapshot every 60 s)   15:30  stop
  08:50  index constituents (niftyindices.com)   15:40  index weights estimated from today's minute bars
  18:30  FII/DII cash + FII index futures (retried 19:30)
  20:00  volume baselines from Dhan history (one request per stock, paced)
  23:00  clean-up (chain snapshots 30 days, bars 90 days) and vacuum
Later phases add the option chain, NSE flows and nightly baselines here."""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app import config
from app.auth import token
from app.dhan import chain, feed, history, instruments
from app.nse import fiidii, holidays, weights
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
    ("feed_start", 9, 0, feed.start_job, True),
    ("feed_stop", 15, 35, feed.stop_job, False),
    ("chain_start", 9, 15, chain.start_job, True),
    ("chain_stop", 15, 31, chain.stop_job, False),
    ("constituents", 8, 50, weights.refresh_constituents, True),
    ("weights", 15, 40, weights.estimate_job, True),
    ("fiidii", 18, 30, fiidii.refresh, True),
    ("fiidii_retry", 19, 30, fiidii.refresh, True),
    ("baselines", 20, 0, history.refresh, True),
    ("cleanup", 23, 0, chain.cleanup, False),
]


def build() -> BackgroundScheduler:
    s = BackgroundScheduler(timezone=config.IST)
    for name, hour, minute, fn, trading_only in JOBS:
        s.add_job(run_job, CronTrigger(day_of_week="mon-fri", hour=hour, minute=minute, timezone=config.IST),
                  args=[name, fn, trading_only], id=name, replace_existing=True, misfire_grace_time=900, coalesce=True)
    return s
