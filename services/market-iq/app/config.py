# @file  services/market-iq/app/config.py
# @area  Market IQ
# @what  Settings: Dhan secrets and the internal key from the environment (.env), fixed constants (times, URLs), and log redaction of PIN/TOTP/tokens.
"""Settings: secrets from the environment, plus the fixed constants (times, steps, windows) used everywhere.
In the stack, docker compose passes them from the repo's root .env; for local runs the root .env is read too."""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent           # services/market-iq
load_dotenv(ROOT / ".env")                                # optional local override
load_dotenv(ROOT.parent.parent / ".env")                  # the repo's root .env (never overrides what is set)

IST = ZoneInfo("Asia/Kolkata")
SESSION_OPEN = time(9, 15)
SESSION_CLOSE = time(15, 30)
TOKEN_RENEW_AT = time(8, 30)
INSTRUMENTS_AT = time(8, 45)

DB_PATH = Path(os.getenv("MARKET_IQ_DB", ROOT / "data" / "market_iq.db"))

DHAN_AUTH_BASE = "https://auth.dhan.co"
DHAN_API_BASE = "https://api.dhan.co/v2"
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv"


def internal_key() -> str:
    """Shared secret the PnL Lens API sends in x-internal-key; the service refuses every data call without it."""
    return (os.getenv("MARKETIQ_INTERNAL_KEY") or "").strip()


@dataclass(frozen=True)
class Secrets:
    client_id: str
    pin: str
    totp_secret: str
    api_key: str
    api_secret: str

    def missing(self) -> list[str]:
        """Names of the values needed for automatic login that are still empty."""
        need = {"DHAN_CLIENT_ID": self.client_id, "DHAN_PIN": self.pin, "DHAN_TOTP_SECRET": self.totp_secret}
        return [k for k, v in need.items() if not v]


def secrets() -> Secrets:
    g = lambda k: (os.getenv(k) or "").strip()
    return Secrets(g("DHAN_CLIENT_ID"), g("DHAN_PIN"), g("DHAN_TOTP_SECRET").replace(" ", ""), g("DHAN_API_KEY"), g("DHAN_API_SECRET"))


def mask(value: str) -> str:
    """For logs: never more than the last 3 characters of anything secret."""
    return "***" + value[-3:] if len(value) > 6 else "***"


_REDACT = re.compile(r"((?:pin|totp|token|access[-_]token|app_secret)=)[^&\s\"']+", re.IGNORECASE)


class RedactSecrets(logging.Filter):
    """Blanks PIN, TOTP and token values in any log line (httpx logs full request URLs, and Dhan puts the PIN in the URL)."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        clean = _REDACT.sub(r"\1***", msg)
        if clean != msg:
            record.msg, record.args = clean, None
        return True


def quiet_http_logs() -> None:
    """httpx/httpcore request lines are off by default (WARNING) and always redacted."""
    for name in ("httpx", "httpcore"):
        lg = logging.getLogger(name)
        lg.setLevel(logging.WARNING)
        if not any(isinstance(f, RedactSecrets) for f in lg.filters):
            lg.addFilter(RedactSecrets())


quiet_http_logs()
