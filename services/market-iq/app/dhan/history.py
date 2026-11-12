# @file  services/market-iq/app/dhan/history.py
# @area  Market IQ
# @what  Nightly volume baselines for the scanners: the last 10 sessions of 1-minute bars per F&O stock from Dhan history (one request per stock, paced), averaged by minute of day into cumulative and 10-minute volume curves.
"""Parameters PDF 5.3/5.4: baseline_10m = average volume in the 10 minutes up to this minute of day; avg_cum_vol = average
cumulative day volume up to this minute, both over the last 10 sessions. Verified live (12 Nov 2026): one
/charts/intraday request returns up to 90 days of 1-minute bars (timestamps true UTC epoch); a burst of more than ~4
requests gets HTTP 429, so requests are paced at one per second (218 stocks ≈ 4 minutes)."""
from __future__ import annotations

import logging
import sqlite3
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta

import httpx

from app import config
from app.auth import token
from app.dhan import instruments as ins
from app.store import db

log = logging.getLogger("market_iq.history")
SESSIONS = 10
PACE = 1.0
SCHEMA = """create table if not exists baseline_vol (
  security_id text not null, minute_of_day integer not null,   -- minutes since 00:00 IST
  avg_cum_vol real not null, avg_10m_vol real not null, sessions integer not null, as_of text not null,
  primary key (security_id, minute_of_day))"""


def curves(bars: list[tuple[datetime, int]]) -> dict[int, tuple[float, float]]:
    """bars: (IST minute, volume) over several sessions -> minute_of_day -> (avg cumulative volume, avg 10-min volume)."""
    by_day: dict[str, dict[int, int]] = defaultdict(dict)
    for t, v in bars:
        by_day[t.strftime("%Y-%m-%d")][t.hour * 60 + t.minute] = int(v or 0)
    if not by_day:
        return {}
    out: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for mins in by_day.values():
        cum = 0
        keys = sorted(mins)
        for i, m in enumerate(keys):
            cum += mins[m]
            last10 = sum(mins[k] for k in keys[max(0, i - 9): i + 1])
            out[m].append((cum, last10))
    return {m: (sum(c for c, _ in xs) / len(xs), sum(v for _, v in xs) / len(xs)) for m, xs in out.items()}


def fetch_bars(con: sqlite3.Connection, client: httpx.Client, security_id: str, exch_segment: str, instrument: str,
               to: datetime, sessions: int = SESSIONS) -> list[tuple[datetime, int]]:
    body = {"securityId": security_id, "exchangeSegment": exch_segment, "instrument": instrument, "interval": "1", "oi": False,
            "fromDate": (to - timedelta(days=sessions * 2)).strftime("%Y-%m-%d 09:15:00"), "toDate": to.strftime("%Y-%m-%d 15:30:00")}
    r = token.dhan_post(con, client, "/charts/intraday", body)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    j = r.json()
    bars = [(datetime.fromtimestamp(t, UTC).astimezone(config.IST), v) for t, v in zip(j.get("timestamp") or [], j.get("volume") or [], strict=False)]
    days = sorted({b[0].date() for b in bars})[-sessions:]
    return [b for b in bars if b[0].date() in set(days)]


def refresh(con: sqlite3.Connection | None = None, client: httpx.Client | None = None, now: datetime | None = None, pace: float = PACE) -> str:
    """20:00 job: baselines for every F&O stock (cash), ending with the latest finished session."""
    con = con or db.connect()
    con.execute(SCHEMA)
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(30.0))
    now = now or datetime.now(config.IST)
    to = now if now.time() >= config.SESSION_CLOSE else now - timedelta(days=1)
    ok = failed = 0
    try:
        for s in ins.fno_stocks(con, now.date()):
            try:
                bars = fetch_bars(con, client, s.cash.security_id, s.cash.exch_segment, "EQUITY", to)
                c = curves(bars)
                sessions = len({b[0].date() for b in bars})
                with con:
                    con.execute("delete from baseline_vol where security_id = ?", (s.cash.security_id,))
                    con.executemany("insert into baseline_vol values (?,?,?,?,?,?)",
                                    [(s.cash.security_id, m, cum, v10, sessions, to.date().isoformat()) for m, (cum, v10) in c.items()])
                ok += 1
            except Exception as e:  # noqa: BLE001 - one stock failing must not stop the rest
                failed += 1
                log.warning("baseline %s: %s", s.symbol, type(e).__name__)
            time.sleep(pace)
        return f"{ok} stocks, {failed} failed, sessions up to {to.date()}"
    finally:
        if own:
            client.close()


def baseline(con: sqlite3.Connection, security_id: str, minute_of_day: int) -> tuple[float, float] | None:
    """(avg cumulative volume, avg 10-minute volume) at this minute of day, or None."""
    con.execute(SCHEMA)
    r = con.execute("select avg_cum_vol, avg_10m_vol from baseline_vol where security_id = ? and minute_of_day <= ? order by minute_of_day desc limit 1",
                    (security_id, minute_of_day)).fetchone()
    return (r["avg_cum_vol"], r["avg_10m_vol"]) if r else None
