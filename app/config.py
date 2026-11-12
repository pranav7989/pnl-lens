"""Settings: secrets from .env, plus the fixed constants (times, steps, windows) used everywhere."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

IST = ZoneInfo("Asia/Kolkata")
SESSION_OPEN = time(9, 15)
SESSION_CLOSE = time(15, 30)
TOKEN_RENEW_AT = time(8, 30)
INSTRUMENTS_AT = time(8, 45)

DB_PATH = Path(os.getenv("MARKET_IQ_DB", ROOT / "data" / "market_iq.db"))

DHAN_AUTH_BASE = "https://auth.dhan.co"
DHAN_API_BASE = "https://api.dhan.co/v2"
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv"


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
