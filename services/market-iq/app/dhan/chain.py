# @file  services/market-iq/app/dhan/chain.py
# @area  Market IQ
# @what  Option chain poller (Nifty, Bank Nifty; every 3 s, 09:15-15:30) with the latest chain in memory, a full snapshot to SQLite every 60 s for the time bar, expiry lists, and get_chain(live or at a time).
"""Phase 4 of the build manual. Verified on the live API (12 Nov 2026):
  POST /v2/optionchain/expirylist {UnderlyingScrip, UnderlyingSeg} -> data: ["2026-11-17", ...]
  POST /v2/optionchain {UnderlyingScrip, UnderlyingSeg, Expiry} -> data: {last_price, oc: {"25250.000000": {ce, pe}}}
  each side: last_price, previous_close_price, oi, previous_oi, volume, previous_volume, implied_volatility,
  greeks{delta, gamma, theta, vega}, top_bid_price/quantity, top_ask_price/quantity, average_price, security_id.
  OI is in units (quantity), as Dhan gives it. Limit: the docs say one request per 3 s per unique underlying +
  expiry, but the live API answers HTTP 429 to a second underlying inside the same 3 s, so we send ONE chain
  request every 3 s in total, Nifty and Bank Nifty in turn (each refreshes every ~6 s, inside the 10 s freshness).
Dhan answers only "now", so the time bar needs our own snapshots: deep strikes with nothing on either side are
not stored (they are all zero)."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app import config
from app.auth import token
from app.dhan import instruments as ins
from app.nse import holidays
from app.state import STATE
from app.store import db

log = logging.getLogger("market_iq.chain")
UNDERLYINGS = {"NIFTY": ("NIFTY 50", 13), "BANKNIFTY": ("NIFTY BANK", 25)}
POLL_EVERY = 3.0
STALE_AFTER = timedelta(seconds=10)
FIELDS = ("ltp", "prev_close", "oi", "prev_oi", "volume", "iv", "delta", "gamma", "theta", "vega", "bid", "ask")


def _side(x: dict | None) -> dict | None:
    if not x:
        return None
    g = x.get("greeks") or {}
    return {"ltp": x.get("last_price"), "prev_close": x.get("previous_close_price"), "oi": x.get("oi"), "prev_oi": x.get("previous_oi"),
            "volume": x.get("volume"), "iv": x.get("implied_volatility"), "delta": g.get("delta"), "gamma": g.get("gamma"),
            "theta": g.get("theta"), "vega": g.get("vega"), "bid": x.get("top_bid_price"), "ask": x.get("top_ask_price")}


def _empty(s: dict | None) -> bool:
    return not s or (not s.get("oi") and not s.get("ltp") and not s.get("volume"))


@dataclass
class Chain:
    underlying: str
    expiry: str
    spot: float | None
    rows: dict[float, dict[str, dict | None]]      # strike -> {"ce": {...}, "pe": {...}}
    as_of: datetime                                # IST: when it was fetched (live) or the snapshot minute
    live: bool = True

    def fresh(self, now: datetime | None = None) -> bool:
        return not self.live or (now or datetime.now(config.IST)) - self.as_of <= STALE_AFTER


def parse(payload: dict, underlying: str, expiry: str, now: datetime) -> Chain:
    d = payload.get("data") or {}
    rows = {}
    for k, v in (d.get("oc") or {}).items():
        try:
            strike = float(k)
        except ValueError:
            continue
        rows[strike] = {"ce": _side(v.get("ce")), "pe": _side(v.get("pe"))}
    return Chain(underlying, expiry, d.get("last_price"), dict(sorted(rows.items())), now)


# ---------------------------------------------------------------- expiries

def refresh_expiries(con, client: httpx.Client, gap: float = POLL_EVERY) -> dict[str, list[str]]:
    out = {}
    for u, (_, sid) in UNDERLYINGS.items():
        r = token.dhan_post(con, client, "/optionchain/expirylist", {"UnderlyingScrip": sid, "UnderlyingSeg": "IDX_I"})
        if r.status_code == 200:
            ex = [e for e in (r.json().get("data") or []) if isinstance(e, str)]
            with con:
                con.execute("delete from expiries where underlying = ?", (u,))
                con.executemany("insert into expiries values (?, ?, ?)", [(u, e, datetime.now(config.IST).date().isoformat()) for e in ex])
            out[u] = ex
        time.sleep(gap)
    return out


def expiries(con, underlying: str, today=None) -> list[str]:
    d = (today or datetime.now(config.IST).date()).isoformat()
    rows = [r["expiry"] for r in con.execute("select expiry from expiries where underlying = ? and expiry >= ? order by expiry", (underlying, d))]
    return rows or ins.option_expiries(con, underlying, today)     # fallback: the instrument list


def default_expiry(con, underlying: str, today=None) -> str | None:
    """Nearest active expiry (Nifty: the weekly; Bank Nifty: the monthly, which is all it has)."""
    ex = expiries(con, underlying, today)
    return ex[0] if ex else None


# ---------------------------------------------------------------- snapshots

def save_snapshot(con, chain: Chain, fut_ltp: float | None = None) -> int:
    ts = chain.as_of.strftime("%Y-%m-%dT%H:%M")
    rows = []
    for strike, sides in chain.rows.items():
        if _empty(sides["ce"]) and _empty(sides["pe"]):
            continue
        for side in ("ce", "pe"):
            s = sides[side]
            if s:
                rows.append((chain.underlying, chain.expiry, ts, strike, side.upper(), *[s.get(f) for f in FIELDS]))
    with con:
        con.executemany(f"insert or replace into chain_snap values (?,?,?,?,?,{','.join('?' * len(FIELDS))})", rows)
        con.execute("insert or replace into spot_snap values (?, ?, ?, ?, ?)", (chain.underlying, ts, chain.spot, fut_ltp, chain.expiry))
    return len(rows)


def load_snapshot(con, underlying: str, expiry: str, at: datetime) -> Chain | None:
    """The latest stored snapshot at or before `at` (IST)."""
    ts = con.execute("select max(ts) as ts from chain_snap where underlying = ? and expiry = ? and ts <= ?",
                     (underlying, expiry, at.strftime("%Y-%m-%dT%H:%M"))).fetchone()["ts"]
    if not ts:
        return None
    rows: dict[float, dict] = {}
    for r in con.execute("select * from chain_snap where underlying = ? and expiry = ? and ts = ? order by strike", (underlying, expiry, ts)):
        rows.setdefault(r["strike"], {"ce": None, "pe": None})[r["side"].lower()] = {f: r[f] for f in FIELDS}
    sp = con.execute("select spot from spot_snap where underlying = ? and ts = ?", (underlying, ts)).fetchone()
    return Chain(underlying, expiry, sp["spot"] if sp else None, rows, datetime.fromisoformat(ts).replace(tzinfo=config.IST), live=False)


def snapshot_times(con, underlying: str, day: str) -> list[str]:
    return [r["ts"] for r in con.execute("select ts from spot_snap where underlying = ? and ts >= ? and ts < ? order by ts",
                                         (underlying, f"{day}T00:00", f"{day}T99:99"))]


# ---------------------------------------------------------------- the poller

class ChainPoller:
    def __init__(self, post=token.dhan_post):
        self._post = post
        self.latest: dict[tuple[str, str], Chain] = {}
        self._last_req: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()
        self._req_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.errors = 0
        self.last_error: str | None = None
        self.snapshots = 0

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def fetch(self, con, client: httpx.Client, underlying: str, expiry: str) -> Chain | None:
        """One chain request; never sooner than 3 s after the previous chain request of any underlying."""
        key = (underlying, expiry)
        with self._req_lock:                      # one request at a time, spaced by POLL_EVERY
            wait = self._last_req.get("any", 0) + POLL_EVERY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_req["any"] = time.monotonic()
        r = self._post(con, client, "/optionchain", {"UnderlyingScrip": UNDERLYINGS[underlying][1], "UnderlyingSeg": "IDX_I", "Expiry": expiry})
        if r.status_code != 200:
            self.errors += 1
            try:
                j = r.json()
                why = j.get("errorCode") or (j.get("data") or {}).get("errorCode") or j.get("status") or ""
            except ValueError:
                why = ""
            self.last_error = f"HTTP {r.status_code} {why}".strip()
            log.warning("chain %s %s: %s", underlying, expiry, self.last_error)
            return None
        c = parse(r.json(), underlying, expiry, datetime.now(config.IST))
        with self._lock:
            self.latest[key] = c
        self.last_error = None
        return c

    def get(self, underlying: str, expiry: str) -> Chain | None:
        with self._lock:
            return self.latest.get((underlying, expiry))

    def start(self) -> bool:
        if self.running:
            return False
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="dhan-chain", daemon=True)
        self._thread.start()
        return True

    def stop(self, timeout: float = 10) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _run(self) -> None:
        con = db.connect()
        with httpx.Client(timeout=httpx.Timeout(15.0)) as client:
            try:
                refresh_expiries(con, client)
            except Exception as e:  # noqa: BLE001 - the instrument list is the fallback
                log.warning("expiry list failed: %s", type(e).__name__)
            last_snap: dict[str, str] = {}             # underlying -> minute of its last snapshot
            names = list(UNDERLYINGS)
            turn = 0
            while not self._stop.is_set():
                u = names[turn % len(names)]
                turn += 1
                ex = default_expiry(con, u)
                if not ex:
                    self._stop.wait(POLL_EVERY)
                    continue
                try:
                    c = self.fetch(con, client, u, ex)       # waits for its 3 s slot
                    minute = c.as_of.strftime("%Y-%m-%dT%H:%M") if c else None
                    if c and last_snap.get(u) != minute:     # the first good chain of each minute is the snapshot
                        fut = STATE.live.get(_fut_key(con, u))
                        if save_snapshot(con, c, fut.ltp if fut else None):
                            self.snapshots += 1
                        last_snap[u] = minute
                except Exception as e:  # noqa: BLE001 - keep the last good chain; it turns stale after 10 s
                    self.errors += 1
                    self.last_error = type(e).__name__
                    log.warning("chain %s failed: %s", u, self.last_error)

    def summary(self, now: datetime | None = None) -> dict:
        now = now or datetime.now(config.IST)
        with self._lock:
            latest = dict(self.latest)
        return {"running": self.running, "errors": self.errors, "last_error": self.last_error, "snapshots": self.snapshots,
                "chains": {f"{u} {e}": {"as_of": c.as_of.isoformat(), "fresh": c.fresh(now), "strikes": len(c.rows), "spot": c.spot}
                           for (u, e), c in latest.items()}}


_FUT: dict[str, tuple[str, str]] = {}


def _fut_key(con, underlying: str) -> tuple[str, str]:
    if underlying not in _FUT:
        f = ins.index_future(con, underlying)
        _FUT[underlying] = (f.exch_segment, f.security_id)
    return _FUT[underlying]


POLLER = ChainPoller()


def get_chain(underlying: str, expiry: str | None = None, at: datetime | None = None, con=None) -> Chain | None:
    """at=None: the live chain (polled for the default expiry; fetched on demand for another expiry).
    Otherwise the latest snapshot at or before `at`."""
    con = con or db.connect()
    underlying = underlying.upper()
    expiry = expiry or default_expiry(con, underlying)
    if not expiry:
        return None
    if at is not None:
        return load_snapshot(con, underlying, expiry, at)
    c = POLLER.get(underlying, expiry)
    if c is None or (not c.fresh() and expiry != default_expiry(con, underlying)):
        with httpx.Client(timeout=httpx.Timeout(15.0)) as client:
            c = POLLER.fetch(con, client, underlying, expiry) or c
    return c


def in_window(now: datetime | None = None, con=None) -> bool:
    now = now or datetime.now(config.IST)
    return (9, 15) <= (now.hour, now.minute) <= (15, 30) and holidays.is_trading_day(now.date(), con)


def start_job() -> str:
    if config.secrets().missing():
        return "waiting for .env: " + ", ".join(config.secrets().missing())
    return "started" if POLLER.start() else "already running"


def stop_job() -> str:
    POLLER.stop()
    return f"stopped after {POLLER.snapshots} snapshots"


def cleanup(con=None, now: datetime | None = None) -> str:
    """Nightly: chain snapshots kept 30 days, spot snapshots 30 days, 1-minute bars 90 days."""
    con = con or db.connect()
    now = now or datetime.now(config.IST)
    c30 = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M")
    c90 = (now - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M")
    with con:
        a = con.execute("delete from chain_snap where ts < ?", (c30,)).rowcount
        b = con.execute("delete from spot_snap where ts < ?", (c30,)).rowcount
        c = con.execute("delete from bars_1m where ts < ?", (c90,)).rowcount
    con.execute("vacuum")
    return f"removed {a} chain rows, {b} spot rows, {c} bars"
