# @file  services/market-iq/app/dhan/feed.py
# @area  Market IQ
# @what  Live feed collector: one Dhan WebSocket (Ticker + Quote for ~440 instruments), auto-reconnect with backoff, live state, 1-minute bars saved to SQLite, today's backfill from history; runs 09:00-15:35 on trading days.
"""Phase 3 of the build manual. Instruments: the 6 indices, the Nifty and Bank Nifty current-month futures, every
F&O stock in the cash market and its near-month future (Quote mode also brings their OI). One connection is
enough (limit 5,000 instruments; 100 per subscribe message).

Own client instead of the SDK's MarketFeed: the SDK reads only the first packet of each frame (Dhan sends several),
returns numbers as text, and cannot take the new token after the 08:30 renewal. Wire format: app/dhan/feed_proto.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import websockets

from app import config
from app.auth import token
from app.dhan import feed_proto as fp
from app.dhan import instruments as ins
from app.nse import holidays
from app.state import STATE, MarketState
from app.store import db

log = logging.getLogger("market_iq.feed")
FEED_URL = "wss://api-feed.dhan.co"
OPEN, CLOSE = (9, 0), (15, 35)
BACKOFF = [1, 2, 5, 10, 30, 60]
SAVE_EVERY = 15                               # seconds between bar saves
AUTH_REASONS = {806, 807, 808, 809, 810}      # Dhan data API error codes about the token/client (Annexure)


def in_window(now: datetime | None = None, con=None) -> bool:
    """09:00-15:35 IST on an NSE trading day."""
    now = now or datetime.now(config.IST)
    t = (now.hour, now.minute)
    return OPEN <= t <= CLOSE and holidays.is_trading_day(now.date(), con)


def feed_instruments(con, today=None) -> tuple[list[tuple[str, str]], dict[tuple[str, str], str]]:
    """(segment, security_id) to subscribe, and a display name for each."""
    subs: list[tuple[str, str]] = []
    names: dict[tuple[str, str], str] = {}
    def add(seg: str, sid: str, name: str) -> None:
        if (seg, sid) not in names:
            subs.append((seg, sid))
            names[(seg, sid)] = name
    for n in ins.INDICES:
        i = ins.index_id(con, n)
        add(i.exch_segment, i.security_id, n)
    for u in ("NIFTY", "BANKNIFTY"):
        f = ins.index_future(con, u, today)
        add(f.exch_segment, f.security_id, f"{u} FUT")
    for s in ins.fno_stocks(con, today):
        add(s.cash.exch_segment, s.cash.security_id, s.symbol)
        add(s.future.exch_segment, s.future.security_id, f"{s.symbol} FUT")
    return subs, names


def save_bars(con, state: MarketState) -> int:
    rows = [(k[0], k[1], b.minute, b.open, b.high, b.low, b.close, b.volume, b.oi, "feed") for k, b in state.take_done()]
    if rows:
        with con:
            con.executemany("insert or replace into bars_1m values (?,?,?,?,?,?,?,?,?,?)", rows)
    return len(rows)


# ---------------------------------------------------------------- backfill (charts/intraday)

BACKFILL = [("NIFTY 50", "INDEX"), ("NIFTY BANK", "INDEX")]


def backfill_today(con, client: httpx.Client, now: datetime | None = None) -> int:
    """Today's 1-minute bars for the two indices and their futures from Dhan history; never overwrites feed bars.
    History timestamps are true UTC epoch seconds (unlike the live feed's trade time)."""
    now = now or datetime.now(config.IST)
    day = now.strftime("%Y-%m-%d")
    targets = [(ins.index_id(con, n), inst, False) for n, inst in BACKFILL]
    targets += [(ins.index_future(con, u, now.date()), "FUTIDX", True) for u in ("NIFTY", "BANKNIFTY")]
    n = 0
    for i, inst, oi in targets:
        body = {"securityId": i.security_id, "exchangeSegment": i.exch_segment, "instrument": inst, "interval": "1", "oi": oi,
                "fromDate": f"{day} 09:15:00", "toDate": now.strftime("%Y-%m-%d %H:%M:%S")}
        r = token.dhan_post(con, client, "/charts/intraday", body)
        if r.status_code != 200:
            log.warning("backfill %s: HTTP %s", i.symbol, r.status_code)
            continue
        j = r.json()
        ts, ois = j.get("timestamp") or [], j.get("open_interest") or []
        rows = []
        for k, t in enumerate(ts):
            minute = datetime.fromtimestamp(t, UTC).astimezone(config.IST).strftime("%Y-%m-%dT%H:%M")
            rows.append((i.exch_segment, i.security_id, minute, j["open"][k], j["high"][k], j["low"][k], j["close"][k],
                         int(j["volume"][k] or 0), int(ois[k]) if k < len(ois) and ois[k] is not None else None, "history"))
        with con:
            con.executemany("insert into bars_1m values (?,?,?,?,?,?,?,?,?,?) on conflict do nothing", rows)
        n += len(rows)
    return n


# ---------------------------------------------------------------- the collector

class Feed:
    def __init__(self, state: MarketState = STATE, connect: Callable = websockets.connect, url: str = FEED_URL):
        self.state, self._connect, self._url = state, connect, url
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop: asyncio.Event | None = None
        self.names: dict[tuple[str, str], str] = {}
        self.last_error: str | None = None
        self.reconnects = 0

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> bool:
        if self.running:
            return False
        self._thread = threading.Thread(target=self._thread_main, name="dhan-feed", daemon=True)
        self._thread.start()
        return True

    def stop(self, timeout: float = 10) -> None:
        if self._loop and self._stop:
            self._loop.call_soon_threadsafe(self._stop.set)
        if self._thread:
            self._thread.join(timeout)
        self.state.connected = False

    def _thread_main(self) -> None:
        self._loop = asyncio.new_event_loop()
        try:
            self._loop.run_until_complete(self.run())
        finally:
            self._loop.close()

    async def run(self, max_sessions: int | None = None) -> None:
        """Connect, subscribe, read; reconnect with backoff until stopped. Saves bars in the background."""
        self._stop = asyncio.Event()
        con = db.connect()
        while True:                                   # the instrument list must exist before we can subscribe
            try:
                await asyncio.to_thread(ins.ensure_today)
                subs, self.names = feed_instruments(con)
                break
            except Exception as e:  # noqa: BLE001 - e.g. Dhan's file not reachable yet: retry, never die
                self.last_error = f"instrument list: {type(e).__name__}"
                log.warning("feed waiting for the instrument list (%s)", type(e).__name__)
                try:
                    await asyncio.wait_for(self._stop.wait(), 60)
                    return
                except TimeoutError:
                    continue
        saver = asyncio.create_task(self._saver(con))
        attempt = sessions = 0
        try:
            while not self._stop.is_set():
                force = attempt > 0 and self.last_error == "auth"
                try:
                    t = await asyncio.to_thread(self._token, force)
                    url = f"{self._url}?version=2&token={t}&clientId={config.secrets().client_id}&authType=2"
                    async with self._connect(url, max_size=2 ** 22, ping_interval=None, open_timeout=20) as ws:
                        for code in (fp.TICKER, fp.QUOTE):
                            for msg in fp.subscribe_messages(subs, code):
                                await ws.send(json.dumps(msg))
                        self.state.connected, self.state.subscribed = True, len(subs)
                        attempt, self.last_error = 0, None
                        log.info("feed connected: %d instruments", len(subs))
                        await self._read(ws)
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001 - any failure: log, back off, reconnect
                    self.last_error = self.last_error or f"{type(e).__name__}"
                    log.warning("feed dropped (%s); reconnecting", self.last_error)
                self.state.connected = False
                sessions += 1
                if max_sessions is not None and sessions >= max_sessions:
                    break
                if self._stop.is_set():
                    break
                self.reconnects += 1
                delay = BACKOFF[min(attempt, len(BACKOFF) - 1)]
                attempt += 1
                try:
                    await asyncio.wait_for(self._stop.wait(), delay)
                except TimeoutError:
                    pass
        finally:
            saver.cancel()
            self.state.close_minutes(datetime.now(config.IST) + timedelta(minutes=1))
            save_bars(con, self.state)
            self.state.connected = False

    def _token(self, force: bool) -> str:
        con = db.connect()
        with httpx.Client(timeout=token.TIMEOUT) as c:
            return token.get_token(con, c, force=force).access_token

    async def _read(self, ws) -> None:
        stop = asyncio.create_task(self._stop.wait())
        try:
            while not self._stop.is_set():
                recv = asyncio.create_task(ws.recv())
                done, _ = await asyncio.wait({recv, stop}, timeout=45, return_when=asyncio.FIRST_COMPLETED)
                if stop in done:
                    recv.cancel()
                    return
                if not done:
                    recv.cancel()
                    raise TimeoutError("no data for 45 s")
                frame = recv.result()
                if isinstance(frame, str):
                    continue
                now = datetime.now(config.IST)
                for p in fp.parse_frame(frame):
                    if p.code == 50:
                        self.last_error = "auth" if p.data["reason"] in AUTH_REASONS else f"server disconnect {p.data['reason']}"
                        raise ConnectionError(self.last_error)
                    self.state.apply((p.segment, p.security_id), p.data, now)
        finally:
            stop.cancel()

    async def _saver(self, con) -> None:
        while True:
            await asyncio.sleep(SAVE_EVERY)
            self.state.close_minutes()
            try:
                save_bars(con, self.state)
            except Exception as e:  # noqa: BLE001 - a failed write is retried next round
                log.warning("saving bars failed: %s", type(e).__name__)

    def summary(self, now: datetime | None = None) -> dict:
        now = now or datetime.now(config.IST)
        snap = self.state.snapshot()
        fresh = [k for k, v in snap.items() if v.updated and now - v.updated <= timedelta(seconds=60)]
        recent = sorted(((v.updated, k) for k, v in snap.items() if v.updated), reverse=True)[:10]
        return {"running": self.running, "connected": self.state.connected, "subscribed": self.state.subscribed,
                "receiving": len(snap), "updated_last_minute": len(fresh), "reconnects": self.reconnects, "last_error": self.last_error,
                "last_message": self.state.last_message.isoformat() if self.state.last_message else None,
                "recent": [{"name": self.names.get(k, f"{k[0]}:{k[1]}"), "ltp": round(snap[k].ltp, 2) if snap[k].ltp else None,
                            "at": u.isoformat()} for u, k in recent]}


FEED = Feed()


def start_job() -> str:
    """09:00 job (and app start-up inside the window): start the feed and backfill today's bars."""
    missing = config.secrets().missing()
    if missing:
        return "waiting for .env: " + ", ".join(missing)
    try:
        ins.ensure_today()
    except Exception as e:  # noqa: BLE001 - the feed retries by itself
        log.warning("instrument list not ready: %s", type(e).__name__)
    started = FEED.start()
    try:
        con = db.connect()
        with httpx.Client(timeout=httpx.Timeout(30.0)) as c:
            n = backfill_today(con, c)
    except Exception as e:  # noqa: BLE001 - backfill is best effort; the live feed matters more
        n = 0
        log.warning("backfill failed: %s", type(e).__name__)
    return f"{'started' if started else 'already running'}; backfilled {n} bars"


def stop_job() -> str:
    FEED.stop()
    return "stopped"
