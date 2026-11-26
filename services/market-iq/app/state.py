# @file  services/market-iq/app/state.py
# @area  Market IQ
# @what  In-memory live state per instrument (LTP, OHLC, volume, OI, previous close/OI, last update) and the 1-minute bar builder; thread-safe.
"""The feed thread writes here; the API thread reads snapshots. Bars are keyed by the IST minute of the last
trade time. A bar's volume is the rise in the day's cumulative volume during that minute."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime

from app import config

Key = tuple[str, str]                        # (exchange segment, security id)


@dataclass
class Live:
    ltp: float | None = None
    ltt: datetime | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    avg: float | None = None
    volume: int | None = None
    oi: int | None = None
    prev_close: float | None = None
    prev_oi: int | None = None
    updated: datetime | None = None          # when we received it (IST)


@dataclass
class Bar:
    minute: str                              # 'YYYY-MM-DDTHH:MM' IST
    open: float
    high: float
    low: float
    close: float
    vol_start: int | None                    # cumulative day volume when the minute began
    vol_last: int | None
    oi: int | None

    @property
    def volume(self) -> int:
        if self.vol_start is None or self.vol_last is None:
            return 0
        return max(0, self.vol_last - self.vol_start)


@dataclass
class MarketState:
    live: dict[Key, Live] = field(default_factory=dict)
    bars: dict[Key, Bar] = field(default_factory=dict)      # the minute being built
    done: list[tuple[Key, Bar]] = field(default_factory=list)  # finished minutes waiting to be saved
    connected: bool = False
    last_message: datetime | None = None
    subscribed: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def apply(self, key: Key, data: dict, now: datetime | None = None) -> None:
        now = now or datetime.now(config.IST)
        with self._lock:
            lv = self.live.setdefault(key, Live())
            for k, v in data.items():
                if hasattr(lv, k) and v is not None:
                    setattr(lv, k, v)
            lv.updated = now
            self.last_message = now
            if "ltp" in data and data.get("ltp"):
                self._bar(key, lv, data)
            elif "oi" in data and key in self.bars:
                self.bars[key].oi = data["oi"]

    def _bar(self, key: Key, lv: Live, data: dict) -> None:
        t = data.get("ltt") or lv.updated
        minute = t.strftime("%Y-%m-%dT%H:%M")
        px = float(data["ltp"])
        vol = data.get("volume", lv.volume)
        b = self.bars.get(key)
        if b is None or b.minute != minute:
            if b is not None and minute > b.minute:
                self.done.append((key, b))
            if b is not None and minute < b.minute:
                return                                   # a late tick for a closed minute: ignored
            self.bars[key] = Bar(minute, px, px, px, px, b.vol_last if b else vol, vol, lv.oi)
            return
        b.high, b.low, b.close = max(b.high, px), min(b.low, px), px
        if vol is not None:
            b.vol_last = vol
        b.oi = lv.oi if lv.oi is not None else b.oi

    def close_minutes(self, now: datetime | None = None) -> None:
        """Move bars whose minute has passed (no tick since) to the save queue."""
        now = now or datetime.now(config.IST)
        cur = now.strftime("%Y-%m-%dT%H:%M")
        with self._lock:
            for key, b in list(self.bars.items()):
                if b.minute < cur:
                    self.done.append((key, b))
                    del self.bars[key]

    def take_done(self) -> list[tuple[Key, Bar]]:
        with self._lock:
            out, self.done = self.done, []
            return out

    def snapshot(self) -> dict[Key, Live]:
        with self._lock:
            return {k: Live(**{f: getattr(v, f) for f in v.__dataclass_fields__}) for k, v in self.live.items()}


STATE = MarketState()
