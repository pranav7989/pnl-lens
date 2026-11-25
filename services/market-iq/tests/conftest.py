# @file  services/market-iq/tests/conftest.py
# @area  Tests
# @what  Test setup: the daily jobs never start during tests; the IST trading day is pinned to the fixtures' day (12 Nov 2026).
import os

os.environ["MARKET_IQ_SCHEDULER"] = "off"   # tests never start the real daily jobs


from datetime import date  # noqa: E402

import pytest  # noqa: E402

from app import config  # noqa: E402


@pytest.fixture(autouse=True)
def _fixture_day(monkeypatch):
    """The fixtures (scrip master, chains, bars) are from 12 Nov 2026: their contracts must still be live on "today"."""
    monkeypatch.setattr(config, "today", lambda: date(2026, 11, 12))
