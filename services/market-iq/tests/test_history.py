# @file  services/market-iq/tests/test_history.py
# @area  Tests
# @what  Volume baselines: cumulative and 10-minute curves averaged over sessions, the last 10 sessions kept, the nightly job paced and tolerant of a failing stock, lookup at a minute of day.
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx

from app import config
from app.dhan import history, instruments
from app.store import db

FIX = Path(__file__).parent / "fixtures"
IST = config.IST


def test_curves_average_cumulative_and_10_minute_volume():
    bars = []
    for day in (1, 2):
        for m in range(12):
            bars.append((datetime(2026, 11, day, 9, 15 + m, tzinfo=IST), 100 * day))   # day 1: 100/min, day 2: 200/min
    c = history.curves(bars)
    m0, m11 = 9 * 60 + 15, 9 * 60 + 26
    assert c[m0] == (150.0, 150.0)                            # first minute: cum = 1 bar, last10 = 1 bar
    assert c[m11] == (150.0 * 12, 150.0 * 10)                 # 12th minute: cum 12 bars, last 10 bars
    assert history.curves([]) == {}


@pytest.fixture
def con(tmp_path, monkeypatch):
    c = db.connect(tmp_path / "h.db")
    instruments.store(c, instruments.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12"))
    monkeypatch.setattr(history.token, "get_token", lambda con, client, s=None, force=False: history.token.Token("t", datetime(2027, 1, 1, tzinfo=IST)))
    monkeypatch.setattr(config, "secrets", lambda: config.Secrets("1", "1", "JBSWY3DPEHPK3PXP", "", ""))
    return c


def payload(days: int, vol: int):
    ts, vols = [], []
    for d in range(days):
        day = datetime(2026, 10, 20, tzinfo=IST) + timedelta(days=d)
        for m in range(3):
            ts.append(int((day + timedelta(hours=9, minutes=15 + m)).timestamp()))
            vols.append(vol)
    return {"timestamp": ts, "volume": vols, "open": [1] * len(ts), "high": [1] * len(ts), "low": [1] * len(ts), "close": [1] * len(ts)}


@respx.mock
def test_nightly_job_keeps_10_sessions_paces_and_survives_a_failure(con):
    seen = []
    def answer(req):
        seen.append(req)
        sid = req.read() and __import__("json").loads(req.read())["securityId"]
        if sid == "3045":
            return httpx.Response(429, json={})
        return httpx.Response(200, json=payload(14, 1000))     # 14 sessions in the file: only the last 10 count
    respx.post(f"{config.DHAN_API_BASE}/charts/intraday").mock(side_effect=answer)
    with httpx.Client() as c:
        msg = history.refresh(con, c, datetime(2026, 11, 12, 20, 0, tzinfo=IST), pace=0)
    assert msg == "1 stocks, 1 failed, sessions up to 2026-11-12"
    rows = con.execute("select sessions, count(*) from baseline_vol where security_id = '2885'").fetchone()
    assert tuple(rows) == (10, 3)
    assert history.baseline(con, "2885", 9 * 60 + 16) == (2000.0, 2000.0)
    assert history.baseline(con, "2885", 9 * 60 + 10) is None and history.baseline(con, "3045", 600) is None
    assert history.baseline(con, "2885", 15 * 60) == (3000.0, 3000.0)        # later minutes fall back to the last known
