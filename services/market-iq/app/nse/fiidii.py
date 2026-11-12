# @file  services/market-iq/app/nse/fiidii.py
# @area  Market IQ
# @what  FII/DII cash flows (NSE, latest day only, saved every evening) and FII index futures from NSE's daily derivatives file (any past day, so 30 days are filled at once); CSV backfill for cash.
"""Verified live (12 Nov 2026):
- https://www.nseindia.com/api/fiidiiTradeReact -> [{category: "DII" | "FII/FPI", date: "11-Nov-2026", buyValue, sellValue,
  netValue}] (strings, Rs crore), latest day only, published after the close.
- https://nsearchives.nseindia.com/content/fo/fii_stats_DD-Mon-YYYY.xls (old Excel), row "INDEX FUTURES": buy
  contracts, buy Rs Cr, sell contracts, sell Rs Cr, OI contracts, OI Rs Cr. 404 on holidays.

    python -m app.nse.fiidii --backfill fii_dii.csv   # columns: date (YYYY-MM-DD or DD-Mon-YYYY), fii_buy, fii_sell, dii_buy, dii_sell
"""
from __future__ import annotations

import argparse
import csv
import logging
import sqlite3
import sys
from datetime import date, datetime, timedelta

import httpx
import xlrd

from app.nse import holidays
from app.nse.session import HEADERS, NseSession
from app.store import db

log = logging.getLogger("market_iq.fiidii")
ARCHIVES = ["https://nsearchives.nseindia.com/content/fo/fii_stats_{d}.xls", "https://archives.nseindia.com/content/fo/fii_stats_{d}.xls"]


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _day(s: str) -> str:
    s = s.strip()
    for f in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, f).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"unknown date {s!r}")


def parse_cash(payload: list) -> dict | None:
    """NSE's two rows (FII/FPI and DII) -> one record for that date."""
    rec: dict = {}
    for r in payload or []:
        cat = str(r.get("category", "")).upper()
        who = "fii" if cat.startswith("FII") else "dii" if cat.startswith("DII") else None
        if not who:
            continue
        rec["date"] = _day(r["date"])
        rec[f"{who}_buy"], rec[f"{who}_sell"] = _num(r.get("buyValue")), _num(r.get("sellValue"))
        net = _num(r.get("netValue"))
        rec[f"{who}_net"] = net if net is not None else (rec[f"{who}_buy"] or 0) - (rec[f"{who}_sell"] or 0)
    return rec if "date" in rec and "fii_net" in rec and "dii_net" in rec else None


def store_cash(con: sqlite3.Connection, rec: dict, source: str = "nse") -> None:
    with con:
        con.execute("insert or replace into fii_dii values (?,?,?,?,?,?,?,?)",
                    (rec["date"], rec.get("fii_buy"), rec.get("fii_sell"), rec["fii_net"], rec.get("dii_buy"), rec.get("dii_sell"), rec["dii_net"], source))


def parse_fut_xls(content: bytes) -> dict | None:
    """The INDEX FUTURES row of NSE's FII derivatives statistics."""
    sh = xlrd.open_workbook(file_contents=content).sheet_by_index(0)
    for r in range(sh.nrows):
        if str(sh.cell_value(r, 0)).strip().upper() == "INDEX FUTURES":
            buy, sell = _num(sh.cell_value(r, 2)), _num(sh.cell_value(r, 4))
            if buy is None or sell is None:
                return None
            return {"buy": buy, "sell": sell, "net": round(buy - sell, 2)}
    return None


def fetch_fut(client: httpx.Client, day: date) -> dict | None:
    d = day.strftime("%d-%b-%Y")
    for url in ARCHIVES:
        r = client.get(url.format(d=d))
        if r.status_code == 200 and r.content[:4] == b"\xd0\xcf\x11\xe0":     # old Excel file signature
            return parse_fut_xls(r.content)
    return None


def refresh(con: sqlite3.Connection | None = None, nse: NseSession | None = None, client: httpx.Client | None = None, days: int = 30) -> str:
    """Evening job (18:30, retried 19:30): today's FII/DII cash, and FII index futures for any of the last `days` days missing."""
    con = con or db.connect()
    own_nse, own_client = nse is None, client is None
    nse = nse or NseSession()
    client = client or httpx.Client(headers=HEADERS, timeout=httpx.Timeout(20.0), follow_redirects=True)
    try:
        cash = parse_cash(nse.get_json("/api/fiidiiTradeReact", referer="/reports/fii-dii"))   # type: ignore[arg-type]
        if cash:
            store_cash(con, cash)
        have = {r["date"] for r in con.execute("select date from fii_fut")}
        added = 0
        today = date.today()
        for i in range(days):
            d = today - timedelta(days=i)
            if d.isoformat() in have or not holidays.is_trading_day(d, con):
                continue
            rec = fetch_fut(client, d)
            if rec:
                with con:
                    con.execute("insert or replace into fii_fut values (?,?,?,?)", (d.isoformat(), rec["buy"], rec["sell"], rec["net"]))
                added += 1
        return f"cash {cash['date'] if cash else 'not published yet'}; index futures +{added} days"
    finally:
        if own_nse:
            nse.close()
        if own_client:
            client.close()


def backfill_csv(con: sqlite3.Connection, path: str) -> int:
    n = 0
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            fb, fs, dbuy, ds = (_num(r.get(k)) for k in ("fii_buy", "fii_sell", "dii_buy", "dii_sell"))
            if None in (fb, fs, dbuy, ds):
                continue
            store_cash(con, {"date": _day(r["date"]), "fii_buy": fb, "fii_sell": fs, "fii_net": round(fb - fs, 2),
                             "dii_buy": dbuy, "dii_sell": ds, "dii_net": round(dbuy - ds, 2)}, source="csv")
            n += 1
    return n


def last_sessions(con: sqlite3.Connection, n: int = 30) -> dict:
    """The panel's three rows, oldest first."""
    cash = [dict(r) for r in con.execute("select date, fii_net, dii_net from fii_dii order by date desc limit ?", (n,))][::-1]
    fut = [dict(r) for r in con.execute("select date, idx_fut_net from fii_fut order by date desc limit ?", (n,))][::-1]
    return {"fii_cash": [{"date": r["date"], "net": r["fii_net"]} for r in cash],
            "dii_cash": [{"date": r["date"], "net": r["dii_net"]} for r in cash],
            "fii_index_futures": [{"date": r["date"], "net": r["idx_fut_net"]} for r in fut]}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="FII/DII flows")
    p.add_argument("--backfill", metavar="CSV", help="load FII/DII cash history from a CSV")
    a = p.parse_args(argv)
    con = db.connect()
    if a.backfill:
        print(f"loaded {backfill_csv(con, a.backfill)} days")
    else:
        print(refresh(con))
    return 0


if __name__ == "__main__":
    sys.exit(main())
