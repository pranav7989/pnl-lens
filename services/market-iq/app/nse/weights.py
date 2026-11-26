# @file  services/market-iq/app/nse/weights.py
# @area  Market IQ
# @what  Nifty 50 and Nifty Bank constituents (niftyindices.com lists) and their index weights, estimated each day from our own 1-minute bars (the index moves as the weighted sum of its stocks' moves).
"""Why estimated: the manual's source (nseindia.com/api/equity-stockIndices with free-float market cap) returns 404 since
NSE changed its site, and NSE's quote API now refuses scripts (403). Official weights are only in licensed data.

The index level is exactly linear in its constituents' returns from the previous close, with that day's weights:
    I(t)/I_prev - 1 = sum_i w_i * (P_i(t)/P_i_prev - 1)
so a least-squares fit over a day of minute bars recovers the weights (Bank Nifty's capping included, because the
fit sees the effective weights). Negative weights are clipped, the rest renormalised to sum to 1; the fit's R^2 is
stored, and the contribution "check line" (sum of points = index move) shows the residual every day.
Weights live in index_weights; method 'estimated' (or 'official' if a licensed file is loaded later)."""
from __future__ import annotations

import csv
import io
import logging
import sqlite3
from datetime import date, datetime

import httpx
import numpy as np

from app import config
from app.dhan import instruments as ins
from app.store import db

log = logging.getLogger("market_iq.weights")
LISTS = {"NIFTY 50": "https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv",
         "NIFTY BANK": "https://www.niftyindices.com/IndexConstituent/ind_niftybanklist.csv"}
MIN_MINUTES = 30


def parse_list(text: str) -> list[dict]:
    out = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        sym = (r.get("Symbol") or "").strip()
        if sym and (r.get("Series") or "EQ").strip() == "EQ":
            out.append({"symbol": sym, "company": (r.get("Company Name") or "").strip(), "industry": (r.get("Industry") or "").strip()})
    return out


def refresh_constituents(con: sqlite3.Connection | None = None, client: httpx.Client | None = None) -> str:
    """08:50 job: today's constituent lists."""
    con = con or db.connect()
    own = client is None
    client = client or httpx.Client(headers={"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130.0"}, timeout=20, follow_redirects=True)
    try:
        counts = {}
        for idx, url in LISTS.items():
            r = client.get(url)
            r.raise_for_status()
            rows = parse_list(r.text)
            if len(rows) < 5:
                raise ValueError(f"{idx}: only {len(rows)} rows")
            with con:
                con.execute("delete from index_constituents where index_name = ?", (idx,))
                con.executemany("insert into index_constituents values (?,?,?,?,?)",
                                [(idx, x["symbol"], x["company"], x["industry"], date.today().isoformat()) for x in rows])
            counts[idx] = len(rows)
        return ", ".join(f"{k} {v}" for k, v in counts.items())
    finally:
        if own:
            client.close()


def constituents(con: sqlite3.Connection, index_name: str) -> list[str]:
    return [r["symbol"] for r in con.execute("select symbol from index_constituents where index_name = ? order by symbol", (index_name,))]


def _cash_id(con: sqlite3.Connection, symbol: str) -> str | None:
    r = con.execute("select security_id from instruments where exch_id = 'NSE' and segment = 'E' and symbol = ?", (symbol,)).fetchone()
    return r["security_id"] if r else None


def _series(con, seg: str, sid: str, day: str) -> dict[str, float]:
    return {r["ts"]: r["close"] for r in con.execute(
        "select ts, close from bars_1m where exch_segment = ? and security_id = ? and ts >= ? and ts < ? and close is not null",
        (seg, sid, f"{day}T09:15", f"{day}T15:31"))}


def _prev(con, seg: str, sid: str, day: str) -> float | None:
    r = con.execute("select prev_close from prev_close_daily where exch_segment = ? and security_id = ? and day = ?", (seg, sid, day)).fetchone()
    return r["prev_close"] if r and r["prev_close"] else None


def fit(index_ret: np.ndarray, stock_ret: np.ndarray) -> tuple[np.ndarray, float]:
    """Least squares w with w >= 0 and sum(w) = 1 (clip + renormalise), and R^2 of the unconstrained fit."""
    w, *_ = np.linalg.lstsq(stock_ret, index_ret, rcond=None)
    pred = stock_ret @ w
    ss_res = float(((index_ret - pred) ** 2).sum())
    ss_tot = float(((index_ret - index_ret.mean()) ** 2).sum()) or 1e-18
    w = np.clip(w, 0, None)
    w = w / w.sum() if w.sum() > 0 else w
    return w, 1 - ss_res / ss_tot


def estimate(con: sqlite3.Connection, index_name: str, day: str | None = None) -> dict:
    """Fit one day's weights from minute bars and store them (as_of = the day)."""
    day = day or datetime.now(config.IST).date().isoformat()
    idx = ins.index_id(con, index_name)
    syms = constituents(con, index_name)
    if not syms:
        raise LookupError(f"no constituents for {index_name}")
    ip = _prev(con, idx.exch_segment, idx.security_id, day)
    iser = _series(con, idx.exch_segment, idx.security_id, day)
    cols, names, missing = [], [], []
    for s in syms:
        sid = _cash_id(con, s)
        pp = _prev(con, "NSE_EQ", sid, day) if sid else None
        ser = _series(con, "NSE_EQ", sid, day) if sid else {}
        if not pp or not ser:
            missing.append(s)
            continue
        cols.append((ser, pp))
        names.append(s)
    if not ip or not iser:
        raise LookupError(f"{index_name}: no index bars or previous close for {day}")
    minutes = sorted(t for t in iser if all(t in ser for ser, _ in cols))
    if len(minutes) < MIN_MINUTES:
        raise LookupError(f"{index_name}: only {len(minutes)} complete minutes on {day}")
    y = np.array([iser[t] / ip - 1 for t in minutes])
    X = np.array([[ser[t] / pp - 1 for ser, pp in cols] for t in minutes])
    w, r2 = fit(y, X)
    with con:
        con.execute("delete from index_weights where index_name = ? and as_of = ? and method = 'estimated'", (index_name, day))
        con.executemany("insert into index_weights values (?,?,?,?,?,?)", [(index_name, s, float(x), day, "estimated", r2) for s, x in zip(names, w, strict=True)])
    return {"index": index_name, "day": day, "minutes": len(minutes), "stocks": len(names), "missing": missing, "r2": round(r2, 6)}


def latest_weights(con: sqlite3.Connection, index_name: str) -> tuple[dict[str, float], dict]:
    """The newest weights (official preferred over estimated on the same day) and their meta."""
    r = con.execute("select as_of, method, max(r2) as r2 from index_weights where index_name = ? group by as_of, method "
                    "order by as_of desc, case method when 'official' then 0 else 1 end limit 1", (index_name,)).fetchone()
    if not r:
        return {}, {}
    w = {x["symbol"]: x["weight"] for x in con.execute("select symbol, weight from index_weights where index_name = ? and as_of = ? and method = ?",
                                                       (index_name, r["as_of"], r["method"]))}
    return w, {"as_of": r["as_of"], "method": r["method"], "r2": r["r2"]}


def estimate_job() -> str:
    """15:40 job: fit today's weights for both indices (used from now and tomorrow)."""
    con = db.connect()
    out = []
    for idx in LISTS:
        try:
            e = estimate(con, idx)
            out.append(f"{idx}: {e['stocks']} stocks, {e['minutes']} min, R² {e['r2']:.4f}")
        except LookupError as e:
            out.append(f"{idx}: {e}")
    return "; ".join(out)
