# @file  services/market-iq/app/auth/token.py
# @area  Market IQ
# @what  Dhan access token from client ID + PIN + TOTP (no browser), stored in SQLite, renewed before expiry and on rejection; --check CLI.
"""Dhan access-token manager: creates a token by itself from client ID + PIN + TOTP (no browser), keeps it in
SQLite, renews it before it expires (24 h) and whenever Dhan rejects it.

Verified against https://dhanhq.co/docs/v2/authentication/ (12 Nov 2026):
  POST https://auth.dhan.co/app/generateAccessToken?dhanClientId=&pin=&totp=
       -> { dhanClientId, dhanClientName, dhanClientUcc, givenPowerOfAttorney, accessToken, expiryTime }
  GET  https://api.dhan.co/v2/profile   (header access-token)
       -> { dhanClientId, tokenValidity, activeSegment, ddpi, mtf, dataPlan, dataValidity }
The PIN travels in the query string (Dhan's design), so request URLs are never logged or put into errors.

    python -m app.auth.token --check     # create or reuse a token and confirm the Data API plan
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx
import pyotp

from app import config
from app.store import db

log = logging.getLogger("market_iq.token")
REFRESH_BEFORE = timedelta(minutes=30)      # renew when less than this is left
TIMEOUT = httpx.Timeout(20.0)


class TokenError(RuntimeError):
    """A login problem, with a plain-English message that never contains a secret."""


@dataclass(frozen=True)
class Token:
    access_token: str
    expires_at: datetime                    # IST

    def valid(self, now: datetime | None = None) -> bool:
        return (now or datetime.now(config.IST)) < self.expires_at - REFRESH_BEFORE


def _parse_expiry(raw: object, now: datetime) -> datetime:
    """Dhan's expiryTime as an aware IST time; 24 h from now if it can't be read."""
    if isinstance(raw, str) and raw.strip():
        s = raw.strip().replace("Z", "+00:00")
        for parse in (datetime.fromisoformat, lambda v: datetime.strptime(v, "%Y-%m-%d %H:%M:%S.%f"), lambda v: datetime.strptime(v, "%Y-%m-%d %H:%M:%S")):
            try:
                t = parse(s)
                return t.astimezone(config.IST) if t.tzinfo else t.replace(tzinfo=config.IST)
            except ValueError:
                continue
    return now + timedelta(hours=24)


def _totp_code(secret: str, now: float | None = None) -> str:
    """Current TOTP code; waits for the next one when the current code has under 3 s left."""
    totp = pyotp.TOTP(secret)
    now = time.time() if now is None else now
    left = totp.interval - (now % totp.interval)
    if left < 3:
        time.sleep(left + 0.2)
        now = time.time()
    return totp.at(now)


def _dhan_error(r: httpx.Response) -> str:
    try:
        j = r.json()
        msg = j.get("errorMessage") or j.get("message") or j.get("remarks") or j.get("status") or ""
        code = j.get("errorCode") or ""
    except ValueError:
        msg, code = "", ""
    return f"HTTP {r.status_code}{' ' + str(code) if code else ''}{': ' + str(msg) if msg else ''}"


def generate(client: httpx.Client, s: config.Secrets) -> Token:
    """A new 24-hour token from client ID + PIN + TOTP."""
    if s.missing():
        raise TokenError("Fill these in .env first: " + ", ".join(s.missing()))
    params = {"dhanClientId": s.client_id, "pin": s.pin, "totp": _totp_code(s.totp_secret)}
    try:
        r = client.post(f"{config.DHAN_AUTH_BASE}/app/generateAccessToken", params=params)
    except httpx.HTTPError as e:
        raise TokenError(f"Could not reach Dhan's login server ({type(e).__name__}).") from None
    if r.status_code != 200:
        raise TokenError(f"Dhan refused the login ({_dhan_error(r)}). Check DHAN_PIN and DHAN_TOTP_SECRET, and that TOTP is set up.")
    try:
        j = r.json()
    except ValueError:
        raise TokenError("Dhan's login answer was not JSON.") from None
    tok = j.get("accessToken")
    if not tok:
        raise TokenError(f"Dhan's login answer had no accessToken ({_dhan_error(r)}).")
    now = datetime.now(config.IST)
    log.info("new Dhan token for client %s, expires %s", config.mask(s.client_id), j.get("expiryTime"))
    return Token(tok, _parse_expiry(j.get("expiryTime"), now))


def load(con: sqlite3.Connection) -> Token | None:
    row = con.execute("select access_token, expires_at from token where id = 1").fetchone()
    return Token(row["access_token"], datetime.fromisoformat(row["expires_at"])) if row else None


def save(con: sqlite3.Connection, t: Token) -> None:
    con.execute(
        "insert into token (id, access_token, expires_at, created_at) values (1, ?, ?, ?) "
        "on conflict(id) do update set access_token = excluded.access_token, expires_at = excluded.expires_at, created_at = excluded.created_at",
        (t.access_token, t.expires_at.isoformat(), datetime.now(config.IST).isoformat()))
    con.commit()


def get_token(con: sqlite3.Connection, client: httpx.Client, s: config.Secrets | None = None, force: bool = False) -> Token:
    """The stored token if it still has 30+ minutes; otherwise a new one (saved)."""
    t = None if force else load(con)
    if t and t.valid():
        return t
    t = generate(client, s or config.secrets())
    save(con, t)
    return t


def is_auth_error(r: httpx.Response) -> bool:
    """Dhan rejected the token (expired or invalid)."""
    if r.status_code in (401, 403):
        return True
    try:
        j = r.json()
    except ValueError:
        return False
    return str(j.get("errorCode", "")).startswith("DH-90") and "token" in str(j.get("errorMessage", "")).lower()


def dhan_get(con: sqlite3.Connection, client: httpx.Client, path: str, **kw) -> httpx.Response:
    """GET a Dhan v2 endpoint with the current token; on an auth error, renew once and retry."""
    s = config.secrets()
    for attempt in (0, 1):
        t = get_token(con, client, s, force=attempt == 1)
        r = client.get(f"{config.DHAN_API_BASE}{path}", headers={"access-token": t.access_token, "client-id": s.client_id, "Accept": "application/json"}, **kw)
        if not is_auth_error(r):
            return r
        log.warning("Dhan rejected the token (%s); renewing", r.status_code)
    return r


def profile(con: sqlite3.Connection, client: httpx.Client) -> dict:
    r = dhan_get(con, client, "/profile")
    if r.status_code != 200:
        raise TokenError(f"Profile check failed ({_dhan_error(r)}).")
    return r.json()


def renew(con: sqlite3.Connection | None = None) -> Token:
    """Scheduled job (08:30 IST on trading days): always fetch a fresh token for the day."""
    con = con or db.connect()
    with httpx.Client(timeout=TIMEOUT) as client:
        return get_token(con, client, force=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Dhan access token")
    p.add_argument("--check", action="store_true", help="create or reuse a token and confirm the Data API plan")
    p.add_argument("--renew", action="store_true", help="force a new token now")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    con = db.connect()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            t = get_token(con, client, force=a.renew)
            print(f"token ok, expires {t.expires_at:%d %b %Y %H:%M} IST")
            if a.check or not a.renew:
                pr = profile(con, client)
                plan, until = pr.get("dataPlan"), pr.get("dataValidity")
                print(f"client {config.mask(str(pr.get('dhanClientId', '')))} · data plan: {plan} · valid until {until}")
                if str(plan).lower() != "active":
                    print("The Data API plan is not active. Subscribe at web.dhan.co → My Profile → DhanHQ APIs.")
                    return 2
    except TokenError as e:
        print(f"token problem: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
