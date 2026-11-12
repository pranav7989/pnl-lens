# @file  services/market-iq/app/sheets.py
# @area  Market IQ
# @what  Assembles the JSON for Sheet 1/2 (index: KPIs, sentiment, contributions, 5-minute candles with levels, time bar, ΔOI bars/donut/compass, chain rows, decoder) and Sheet 3 (market: breadth, FII/DII, momentum, R-factor, futures buildup, movers), live or at a past minute; every payload carries fresh + as_of.
"""Phase 7 of the build manual. Pure assembly: live numbers come from app.state (the feed), the chain from
app.dhan.chain (live or the snapshot at `at`), stored tables for bars, previous closes, weights, flows and baselines.
No calculation lives here; everything is app/calc."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from app import config
from app.calc import contrib, decoder, kpis, oiflow, scanners
from app.dhan import chain, history
from app.dhan import instruments as ins
from app.nse import fiidii, weights
from app.state import STATE, Live
from app.store import db

INDEX_NAME = {"NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK"}
HEADER = ["NIFTY 50", "NIFTY BANK", "FINNIFTY", "NIFTY MIDCAP SELECT", "SENSEX", "INDIA VIX"]
CHAIN_WINDOW, COMPASS_WINDOW = 20, 8
FRESH = timedelta(seconds=15)


def _minute(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")


def _live(key: tuple[str, str], snap: dict[tuple[str, str], Live]) -> Live | None:
    return snap.get(key)


def _at_bar(con: sqlite3.Connection, seg: str, sid: str, at: datetime) -> dict | None:
    """The latest minute bar at or before `at` (for replay)."""
    r = con.execute("select ts, close, high, low, open, volume, oi from bars_1m where exch_segment = ? and security_id = ? and ts <= ? order by ts desc limit 1",
                    (seg, sid, _minute(at))).fetchone()
    return dict(r) if r else None


def _prev_close(con: sqlite3.Connection, seg: str, sid: str, day: str, live: Live | None) -> float | None:
    if live and live.prev_close:
        return live.prev_close
    r = con.execute("select prev_close from prev_close_daily where exch_segment = ? and security_id = ? and day = ?", (seg, sid, day)).fetchone()
    return r["prev_close"] if r else None


def _quote(con: sqlite3.Connection, seg: str, sid: str, now: datetime, at: datetime | None, snap: dict) -> dict:
    """ltp, prev_close, pct, updated for one instrument, live or at a time."""
    day = (at or now).date().isoformat()
    lv = _live((seg, sid), snap) if at is None else None
    if at is not None:
        b = _at_bar(con, seg, sid, at)
        ltp, updated = (b["close"], b["ts"]) if b else (None, None)
    else:
        ltp, updated = (lv.ltp, lv.updated.isoformat()) if lv and lv.ltp else (None, None)
    pc = _prev_close(con, seg, sid, day, lv)
    return {"ltp": ltp, "prev_close": pc, "pct": kpis.pct_change(ltp, pc), "updated": updated}


def header(con: sqlite3.Connection | None = None, now: datetime | None = None, at: datetime | None = None) -> dict:
    con = con or db.connect()
    now = now or datetime.now(config.IST)
    snap = STATE.snapshot()
    out = {}
    for name in HEADER:
        try:
            i = ins.index_id(con, name)
        except LookupError:
            continue
        out[name] = _quote(con, i.exch_segment, i.security_id, now, at, snap)
    return out


def candles_5m(con: sqlite3.Connection, seg: str, sid: str, vol_seg: str, vol_sid: str, day: str, upto: datetime | None) -> list[dict]:
    """5-minute candles from 1-minute bars (index prices; volume from the index future, the index has none)."""
    lim = _minute(upto) if upto else f"{day}T99:99"
    px = con.execute("select ts, open, high, low, close from bars_1m where exch_segment = ? and security_id = ? and ts >= ? and ts <= ? order by ts",
                     (seg, sid, f"{day}T00:00", lim)).fetchall()
    vol = {r["ts"]: r["volume"] or 0 for r in con.execute("select ts, volume from bars_1m where exch_segment = ? and security_id = ? and ts >= ? and ts <= ?",
                                                          (vol_seg, vol_sid, f"{day}T00:00", lim))}
    out: list[dict] = []
    for r in px:
        hhmm = r["ts"][11:]
        bucket = f"{r['ts'][:14]}{int(hhmm[3:]) // 5 * 5:02d}"
        if out and out[-1]["time"] == bucket:
            c = out[-1]
            c["high"], c["low"], c["close"] = max(c["high"], r["high"]), min(c["low"], r["low"]), r["close"]
            c["volume"] += vol.get(r["ts"], 0)
        else:
            out.append({"time": bucket, "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"], "volume": vol.get(r["ts"], 0)})
    return out


def index_sheet(underlying: str, expiry: str | None = None, at: datetime | None = None, con: sqlite3.Connection | None = None,
                now: datetime | None = None, window: int = CHAIN_WINDOW) -> dict:
    """Everything Sheet 1 (Nifty) or 2 (Bank Nifty) shows. at=None is live."""
    con = con or db.connect()
    now = now or datetime.now(config.IST)
    u = underlying.upper()
    name = INDEX_NAME[u]
    day = (at or now).date().isoformat()
    snap = STATE.snapshot() if at is None else {}
    idx = ins.index_id(con, name)
    fut = ins.index_future(con, u, (at or now).date())
    vix = ins.index_id(con, "INDIA VIX")
    spot_q = _quote(con, idx.exch_segment, idx.security_id, now, at, snap)
    fut_q = _quote(con, fut.exch_segment, fut.security_id, now, at, snap)
    vix_q = _quote(con, vix.exch_segment, vix.security_id, now, at, snap)

    ch = chain.get_chain(u, expiry, at, con)
    rows = ch.rows if ch else {}
    spot = spot_q["ltp"] or (ch.spot if ch else None)
    strikes = list(rows)
    atm = kpis.atm_strike(spot, strikes)
    win = kpis.window(strikes, atm, window)
    sup, res = kpis.support_resistance(rows, win)
    pcr = kpis.pcr_oi(rows)
    mp = kpis.max_pain(rows)
    totals = oiflow.doi_totals(rows, win)
    sent = oiflow.sentiment(spot_q["pct"], totals["ce"], totals["pe"], pcr)
    gammas = sorted((rows[k][s]["gamma"] for k in win for s in ("ce", "pe") if rows[k][s] and rows[k][s].get("gamma")), reverse=True)

    def chain_row(k: float) -> dict:
        r = {"strike": k, "atm": k == atm, "support": k == sup, "resistance": k == res}
        for s in ("ce", "pe"):
            o = rows[k][s]
            r[s] = None if not o else {**o, "doi": oiflow.doi(o), "tag": oiflow.buildup(o), "itm": (k < spot) if s == "ce" else (k > spot)} if spot else {**o, "doi": oiflow.doi(o), "tag": oiflow.buildup(o), "itm": False}
        return r

    # who moved the index
    w, wmeta = weights.latest_weights(con, name)
    stocks = {}
    for sym in w:
        sid = weights._cash_id(con, sym)
        if sid:
            q = _quote(con, "NSE_EQ", sid, now, at, snap)
            stocks[sym] = (q["ltp"], q["prev_close"])
    contribution = contrib.contributions(spot_q["prev_close"] or 0, spot, w, stocks, show_all=(u == "BANKNIFTY")) if w and spot_q["prev_close"] else None

    candles = candles_5m(con, idx.exch_segment, idx.security_id, fut.exch_segment, fut.security_id, day, at)
    times = chain.snapshot_times(con, u, day)
    chain_as_of = ch.as_of if ch else None
    fresh = at is not None or (bool(ch) and ch.fresh(now) and bool(spot_q["updated"]) and now - datetime.fromisoformat(spot_q["updated"]) <= FRESH)
    return {
        "underlying": u, "index": name, "as_of": (at or now).isoformat(), "live": at is None, "fresh": fresh,
        "expiry": ch.expiry if ch else expiry, "expiries": chain.expiries(con, u, (at or now).date()),
        "kpis": {
            "spot": spot_q, "futures": {"ltp": fut_q["ltp"], "expiry": fut.expiry}, "basis": kpis.basis(fut_q["ltp"], spot),
            "pcr": {"value": pcr, "band": kpis.pcr_band(pcr)}, "max_pain": {"strike": mp, "vs_spot": (mp - spot) if mp is not None and spot else None},
            "atm_iv": {"value": kpis.atm_iv(rows, atm), "strike": atm}, "vix": vix_q, "support": sup, "resistance": res,
        },
        "sentiment": sent,
        "contribution": {**contribution, "weights": wmeta} if contribution else None,
        "candles": candles,
        "time_bar": {"times": times, "at": _minute(at) if at else None},
        "doi": {**totals, "window": [win[0], win[-1]] if win else None},
        "compass": oiflow.compass(rows, kpis.window(strikes, atm, COMPASS_WINDOW)),
        "chain": {"atm": atm, "step": kpis.strike_step(strikes), "as_of": chain_as_of.isoformat() if chain_as_of else None,
                  "fresh": bool(ch) and ch.fresh(now), "rows": [chain_row(k) for k in win]},
        "gamma_ranks": gammas,
    }


def decode_strike(underlying: str, strike: float, side: str, expiry: str | None = None, at: datetime | None = None,
                  con: sqlite3.Connection | None = None, now: datetime | None = None) -> dict | None:
    con = con or db.connect()
    now = now or datetime.now(config.IST)
    u, s = underlying.upper(), side.lower()
    ch = chain.get_chain(u, expiry, at, con)
    if not ch or strike not in ch.rows or not ch.rows[strike].get(s):
        return None
    strikes = list(ch.rows)
    atm = kpis.atm_strike(ch.spot, strikes)
    win = kpis.window(strikes, atm, CHAIN_WINDOW)
    opt = ch.rows[strike][s]
    gammas = sorted((ch.rows[k][x]["gamma"] for k in win for x in ("ce", "pe") if ch.rows[k][x] and ch.rows[k][x].get("gamma")), reverse=True)
    rank = (gammas.index(opt["gamma"]) / len(gammas)) if opt.get("gamma") in gammas else None
    sup, res = kpis.support_resistance(ch.rows, win)
    d = decoder.decode(s.upper(), strike, opt, kpis.atm_iv(ch.rows, atm), rank, max_oi_side=(strike == res if s == "ce" else strike == sup))
    return {**d, "underlying": u, "expiry": ch.expiry, "spot": ch.spot, "atm": strike == atm, "as_of": ch.as_of.isoformat(), "fresh": ch.fresh(now)}


# ---------------------------------------------------------------- Sheet 3

def market_sheet(con: sqlite3.Connection | None = None, now: datetime | None = None) -> dict:
    con = con or db.connect()
    now = now or datetime.now(config.IST)
    snap = STATE.snapshot()
    day = now.date().isoformat()
    minute_of_day = now.hour * 60 + now.minute
    ten_ago = _minute(now - timedelta(minutes=10))
    stocks, mom_rows, r_rows, fut_rows, mover_rows = {}, [], [], [], []
    for s in ins.fno_stocks(con, now.date()):
        key = (s.cash.exch_segment, s.cash.security_id)
        lv = snap.get(key)
        pc = _prev_close(con, *key, day, lv)
        ltp = lv.ltp if lv else None
        stocks[s.symbol] = {"ltp": ltp, "prev_close": pc}
        pct = kpis.pct_change(ltp, pc)
        base = history.baseline(con, s.cash.security_id, minute_of_day)
        if lv and ltp and pc:
            mover_rows.append({"symbol": s.symbol, "ltp": ltp, "prev_close": pc, "high": lv.high, "low": lv.low, "r": None})
            if base and lv.volume:
                r_rows.append({"symbol": s.symbol, "cum_vol": lv.volume, "baseline_cum_vol": base[0], "pct": pct})
                b10 = con.execute("select close, volume from bars_1m where exch_segment = ? and security_id = ? and ts <= ? order by ts desc limit 1", (*key, ten_ago)).fetchone()
                v10 = con.execute("select coalesce(sum(volume), 0) as v from bars_1m where exch_segment = ? and security_id = ? and ts > ?", (*key, ten_ago)).fetchone()["v"]
                if b10 and b10["close"]:
                    mom_rows.append({"symbol": s.symbol, "ltp": ltp, "close_10m_ago": b10["close"], "vol_10m": v10, "baseline_10m": base[1], "pct": pct})
        fl = snap.get((s.future.exch_segment, s.future.security_id))
        if fl and fl.ltp:
            fpc = _prev_close(con, s.future.exch_segment, s.future.security_id, day, fl)
            fut_rows.append({"symbol": s.symbol, "ltp": fl.ltp, "prev_close": fpc, "oi": fl.oi, "prev_oi": fl.prev_oi})
    r_by = {x["symbol"]: x["r"] for x in scanners.r_factor(r_rows, top=10_000)}
    for m in mover_rows:
        m["r"] = r_by.get(m["symbol"])
    updated = max((lv.updated for lv in snap.values() if lv.updated), default=None)
    return {
        "as_of": now.isoformat(), "fresh": bool(updated) and now - updated <= FRESH, "header": header(con, now),
        "breadth": {**scanners.breadth(stocks), "universe": len(stocks)},
        "flows": fiidii.last_sessions(con),
        "momentum": scanners.momentum(mom_rows), "r_factor": scanners.r_factor(r_rows),
        "futures_buildup": scanners.futures_buildup(fut_rows), "movers": scanners.movers(mover_rows),
        "baselines": bool(r_rows),
    }
