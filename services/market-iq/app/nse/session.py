# @file  services/market-iq/app/nse/session.py
# @area  Market IQ
# @what  Polite NSE HTTP client: browser headers, home-page cookies, max 1 request per 2 s, one retry on 401/403.
"""A polite NSE client: browser-like headers, cookies from the home page, at most 1 request every 2 s, and one retry
with a fresh session on 401/403. NSE blocks fast or bot-like traffic, so every NSE call goes through here."""
from __future__ import annotations

import threading
import time

import httpx

BASE = "https://www.nseindia.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE + "/",
}
MIN_GAP = 2.0


class NseSession:
    def __init__(self, client: httpx.Client | None = None, min_gap: float = MIN_GAP):
        self._client = client or httpx.Client(headers=HEADERS, timeout=httpx.Timeout(20.0), follow_redirects=True)
        self._own = client is None
        self._gap = min_gap
        self._last = 0.0
        self._lock = threading.Lock()
        self._warm = False

    def _wait(self) -> None:
        with self._lock:
            pause = self._last + self._gap - time.monotonic()
            if pause > 0:
                time.sleep(pause)
            self._last = time.monotonic()

    def _warm_up(self) -> None:
        """Visit the home page for cookies; NSE sometimes answers it with 403, which is fine."""
        self._wait()
        try:
            self._client.get(BASE + "/")
        except httpx.HTTPError:
            pass
        self._warm = True

    def get_json(self, path: str, referer: str | None = None) -> object:
        headers = {"Referer": BASE + referer} if referer else None
        for attempt in (0, 1):
            if not self._warm or attempt == 1:
                if attempt == 1:
                    self._client.cookies.clear()
                self._warm_up()
            self._wait()
            r = self._client.get(BASE + path, headers=headers)
            if r.status_code in (401, 403) and attempt == 0:
                continue
            r.raise_for_status()
            return r.json()
        raise httpx.HTTPError("unreachable")

    def close(self) -> None:
        if self._own:
            self._client.close()
