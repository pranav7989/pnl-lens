# @file  services/market-iq/app/nse/holidays.py
# @area  Market IQ
# @what  NSE F&O trading holidays (stored in SQLite) and is_trading_day().
"""NSE trading holidays (F&O segment) and is_trading_day(). The list comes from
https://www.nseindia.com/api/holiday-master?type=trading (key "FO": [{tradingDate: "26-Jan-2026", description, ...}]),
is stored in SQLite and refreshed daily; if NSE can't be reached the stored list is used."""
from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime

import httpx

from app.nse.session import NseSession
from app.store import db

log = logging.getLogger("market_iq.holidays")

SCHEMA = """create table if not exists holidays (
  day text not null, segment text not null, description text, as_of text not null, primary key (day, segment))"""


def parse(payload: dict, segment: str = "FO") -> list[tuple[str, str]]:
    out = []
    for h in payload.get(segment, []) or []:
        try:
            out.append((datetime.strptime(h["tradingDate"], "%d-%b-%Y").date().isoformat(), (h.get("description") or "").strip()))
        except (KeyError, ValueError):
            continue
    return out


def store(con: sqlite3.Connection, rows: list[tuple[str, str]], segment: str = "FO") -> int:
    con.execute(SCHEMA)
    if not rows:
        return 0
    years = {d[:4] for d, _ in rows}
    with con:
        for y in years:                      # replace each year NSE sent, keep other years
            con.execute("delete from holidays where segment = ? and substr(day, 1, 4) = ?", (segment, y))
        con.executemany("insert or replace into holidays values (?, ?, ?, ?)", [(d, segment, desc, date.today().isoformat()) for d, desc in rows])
    return len(rows)


def refresh(con: sqlite3.Connection | None = None, nse: NseSession | None = None) -> int:
    con = con or db.connect()
    own = nse is None
    nse = nse or NseSession()
    try:
        payload = nse.get_json("/api/holiday-master?type=trading", referer="/resources/exchange-communication-holidays")
        return store(con, parse(payload if isinstance(payload, dict) else {}))
    finally:
        if own:
            nse.close()


def is_trading_day(day: date | None = None, con: sqlite3.Connection | None = None) -> bool:
    """Weekdays that are not NSE F&O holidays. Fetches the list once if none is stored for that year."""
    day = day or date.today()
    if day.weekday() >= 5:
        return False
    con = con or db.connect()
    con.execute(SCHEMA)
    have = con.execute("select 1 from holidays where segment = 'FO' and substr(day, 1, 4) = ? limit 1", (str(day.year),)).fetchone()
    if not have:
        try:
            refresh(con)
        except (httpx.HTTPError, ValueError) as e:   # offline or not JSON: weekday rule only, never block the app
            log.warning("NSE holiday list unavailable (%s); using weekdays only", type(e).__name__)
    return con.execute("select 1 from holidays where segment = 'FO' and day = ?", (day.isoformat(),)).fetchone() is None
