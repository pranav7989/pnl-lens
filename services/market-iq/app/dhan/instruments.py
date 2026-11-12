# @file  services/market-iq/app/dhan/instruments.py
# @area  Market IQ
# @what  Dhan instrument list: daily download into SQLite (segment-safe keys) and lookups for index IDs, index futures, F&O stocks and option strikes.
"""Dhan instrument list (scrip master): downloaded every trading day at 08:45 into SQLite, with lookups for the
index IDs, index futures, the F&O stock list and option strikes.

Verified against the real file (https://images.dhan.co/api-data/api-scrip-master-detailed.csv, 12 Nov 2026):
- SECURITY_ID repeats across segments, so rows are keyed by (EXCH_ID, SEGMENT, SECURITY_ID).
- Indices are segment I (NIFTY 13, BANKNIFTY 25, FINNIFTY 27, MIDCPNIFTY 442, INDIA VIX 21 on NSE; SENSEX 51 on BSE).
- For equity rows the ticker is UNDERLYING_SYMBOL; SYMBOL_NAME is the company name.
- FUTSTK UNDERLYING_SECURITY_ID is the NSE cash security id. NSE test symbols (*NSETEST) are dropped.

    python -m app.dhan.instruments            # download if not done today, then print the ID table
    python -m app.dhan.instruments --download # force a fresh download
"""
from __future__ import annotations

import argparse
import csv
import io
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from app import config
from app.nse import holidays
from app.store import db

# (EXCH_ID, SEGMENT) -> the exchange segment code Dhan's APIs expect (docs: Annexure, Exchange Segment)
EXCH_SEGMENT = {("NSE", "I"): "IDX_I", ("BSE", "I"): "IDX_I", ("NSE", "E"): "NSE_EQ", ("NSE", "D"): "NSE_FNO",
                ("BSE", "E"): "BSE_EQ", ("BSE", "D"): "BSE_FNO", ("NSE", "C"): "NSE_CURRENCY", ("BSE", "C"): "BSE_CURRENCY",
                ("MCX", "M"): "MCX_COMM"}
# what we keep: indices, NSE cash equity, NSE index/stock derivatives, BSE index derivatives (Sensex)
KEEP = {("NSE", "I"): None, ("BSE", "I"): None, ("NSE", "E"): {"EQUITY"},
        ("NSE", "D"): {"FUTIDX", "OPTIDX", "FUTSTK", "OPTSTK"}, ("BSE", "D"): {"FUTIDX", "OPTIDX"}}
# dashboard names -> (exchange, symbol in the file)
INDICES = {"NIFTY 50": ("NSE", "NIFTY"), "NIFTY BANK": ("NSE", "BANKNIFTY"), "FINNIFTY": ("NSE", "FINNIFTY"),
           "NIFTY MIDCAP SELECT": ("NSE", "MIDCPNIFTY"), "SENSEX": ("BSE", "SENSEX"), "INDIA VIX": ("NSE", "INDIA VIX")}


@dataclass(frozen=True)
class Instrument:
    exch_segment: str
    security_id: str
    symbol: str
    name: str
    expiry: str | None = None
    lot_size: float | None = None


def _num(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse(text: str, as_of: str) -> list[tuple]:
    """Rows of the detailed scrip master -> instruments table rows (only what the dashboard uses)."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        key = (r.get("EXCH_ID", ""), r.get("SEGMENT", ""))
        if key not in KEEP:
            continue
        inst = r.get("INSTRUMENT", "")
        allowed = KEEP[key]
        if (allowed is not None and inst not in allowed) or (allowed is None and inst != "INDEX"):
            continue
        und = (r.get("UNDERLYING_SYMBOL") or "").strip()
        if "NSETEST" in und or "NSETEST" in (r.get("SYMBOL_NAME") or ""):
            continue
        symbol = (r.get("SYMBOL_NAME") or "").strip() if inst == "INDEX" else und
        if not symbol:
            continue
        expiry = (r.get("SM_EXPIRY_DATE") or "").strip()
        opt = (r.get("OPTION_TYPE") or "").strip()
        out.append((key[0], key[1], r["SECURITY_ID"].strip(), EXCH_SEGMENT[key], symbol, (r.get("DISPLAY_NAME") or "").strip(), inst,
                    expiry if expiry and expiry[:4] != "1980" and inst != "INDEX" and inst != "EQUITY" else None,
                    _num(r.get("STRIKE_PRICE")) if inst.startswith("OPT") else None,
                    opt if opt in ("CE", "PE") else None,
                    _num(r.get("LOT_SIZE")), (r.get("UNDERLYING_SECURITY_ID") or "").strip() or None, und or None,
                    (r.get("EXPIRY_FLAG") or "").strip() or None, as_of))
    return out


def store(con: sqlite3.Connection, rows: list[tuple]) -> int:
    """Replace the whole table in one transaction (never half a list)."""
    with con:
        con.execute("delete from instruments")
        con.executemany("insert or replace into instruments values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    return len(rows)


def download(client: httpx.Client) -> str:
    r = client.get(config.SCRIP_MASTER_URL)
    r.raise_for_status()
    return r.text


def refresh(con: sqlite3.Connection | None = None, client: httpx.Client | None = None) -> int:
    """Scheduled job (08:45 IST on trading days): download and replace the instrument list."""
    con = con or db.connect()
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(120.0))
    try:
        started = datetime.now(config.IST).isoformat()
        n = store(con, parse(download(client), date.today().isoformat()))
        con.execute("insert into job_log (job, started_at, ended_at, status, message) values ('instruments', ?, ?, 'ok', ?)",
                    (started, datetime.now(config.IST).isoformat(), f"{n} rows"))
        con.commit()
        return n
    finally:
        if own:
            client.close()


def ensure_today(con: sqlite3.Connection | None = None) -> int:
    """Download today's list if it isn't stored yet (e.g. a fresh install started after 08:45). Returns rows stored now."""
    con = con or db.connect()
    return 0 if as_of(con) == date.today().isoformat() else refresh(con)


def as_of(con: sqlite3.Connection) -> str | None:
    row = con.execute("select max(as_of) as d from instruments").fetchone()
    return row["d"] if row else None


# ---------------------------------------------------------------- lookups

def index_id(con: sqlite3.Connection, name: str) -> Instrument:
    exch, sym = INDICES[name.upper()]
    r = con.execute("select * from instruments where exch_id = ? and segment = 'I' and symbol = ?", (exch, sym)).fetchone()
    if not r:
        raise LookupError(f"index {name} not in the instrument list")
    return Instrument(r["exch_segment"], r["security_id"], r["symbol"], r["name"])


def _row(r: sqlite3.Row) -> Instrument:
    return Instrument(r["exch_segment"], r["security_id"], r["symbol"], r["name"], r["expiry"], r["lot_size"])


def index_future(con: sqlite3.Connection, underlying: str, today: date | None = None) -> Instrument:
    """Current-month index future: the nearest expiry on or after today."""
    d = (today or date.today()).isoformat()
    r = con.execute("select * from instruments where exch_id = 'NSE' and instrument = 'FUTIDX' and symbol = ? and expiry >= ? "
                    "order by expiry limit 1", (underlying.upper(), d)).fetchone()
    if not r:
        raise LookupError(f"no live future for {underlying}")
    return _row(r)


@dataclass(frozen=True)
class FnoStock:
    symbol: str
    cash: Instrument
    future: Instrument


def fno_stocks(con: sqlite3.Connection, today: date | None = None) -> list[FnoStock]:
    """Every stock with NSE futures: its cash (NSE_EQ) ID and its near-month future ID."""
    d = (today or date.today()).isoformat()
    futs = con.execute("""
        select f.* from instruments f
        join (select symbol, min(expiry) as e from instruments where exch_id = 'NSE' and instrument = 'FUTSTK' and expiry >= ? group by symbol) n
          on n.symbol = f.symbol and n.e = f.expiry
        where f.exch_id = 'NSE' and f.instrument = 'FUTSTK' order by f.symbol""", (d,)).fetchall()
    out = []
    for f in futs:
        c = con.execute("select * from instruments where exch_id = 'NSE' and segment = 'E' and security_id = ?", (f["underlying_id"],)).fetchone()
        if c:
            out.append(FnoStock(f["symbol"], _row(c), _row(f)))
    return out


def option_expiries(con: sqlite3.Connection, underlying: str, today: date | None = None) -> list[str]:
    d = (today or date.today()).isoformat()
    rows = con.execute("select distinct expiry from instruments where instrument = 'OPTIDX' and symbol = ? and expiry >= ? order by expiry",
                       (underlying.upper(), d)).fetchall()
    return [r["expiry"] for r in rows]


def option_strikes(con: sqlite3.Connection, underlying: str, expiry: str) -> list[float]:
    rows = con.execute("select distinct strike from instruments where instrument in ('OPTIDX', 'OPTSTK') and symbol = ? and expiry = ? "
                       "order by strike", (underlying.upper(), expiry)).fetchall()
    return [r["strike"] for r in rows]


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Dhan instrument list")
    p.add_argument("--download", action="store_true", help="download a fresh list now")
    a = p.parse_args(argv)
    con = db.connect()
    today = date.today()
    if a.download or as_of(con) != today.isoformat():
        print("downloading the instrument list from Dhan (about 38 MB)…")
        print(f"stored {refresh(con):,} instruments")
    print(f"\ninstrument list as of {as_of(con)}\n")
    print(f"{'Index':22} {'Segment':8} {'Security ID':>11}  Name")
    for name in INDICES:
        i = index_id(con, name)
        print(f"{name:22} {i.exch_segment:8} {i.security_id:>11}  {i.name}")
    print(f"\n{'Current-month future':22} {'Segment':8} {'Security ID':>11}  Expiry      Lot")
    for u in ("NIFTY", "BANKNIFTY"):
        f = index_future(con, u, today)
        print(f"{u:22} {f.exch_segment:8} {f.security_id:>11}  {f.expiry}  {f.lot_size:g}")
    stocks = fno_stocks(con, today)
    print(f"\nF&O stocks: {len(stocks)} (cash ID + near-month future ID), e.g.")
    for s in [x for x in stocks if x.symbol in ("RELIANCE", "HDFCBANK", "SBIN")]:
        print(f"  {s.symbol:12} cash {s.cash.security_id:>7} · future {s.future.security_id:>7} ({s.future.expiry}, lot {s.future.lot_size:g})")
    for u in ("NIFTY", "BANKNIFTY"):
        ex = option_expiries(con, u, today)
        if ex:
            st = option_strikes(con, u, ex[0])
            print(f"{u} options: next expiry {ex[0]}, {len(st)} strikes ({st[0]:g}–{st[-1]:g}); {len(ex)} expiries listed")
    td = holidays.is_trading_day(today)
    print(f"\ntoday {today:%a %d %b %Y}: {'trading day' if td else 'market closed (weekend or NSE holiday)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
