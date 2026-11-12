# @file  services/market-iq/tests/test_scheduler.py
# @area  Tests
# @what  Daily jobs: IST times, skipped on holidays, failures recorded without crashing, token job waits for .env.
"""Daily jobs: registered at the right IST times, skipped on holidays, failures recorded without crashing."""
import json
from datetime import date, datetime
from pathlib import Path

import pytest

from app import config
from app.jobs import scheduler
from app.nse import holidays
from app.store import db

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def con(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    c = db.connect(path)
    holidays.store(c, holidays.parse(json.loads((FIX / "nse_holidays_2026.json").read_text())))
    return c


def test_jobs_and_times():
    s = scheduler.build()
    got = {j.id: (str(j.trigger.fields[5]), str(j.trigger.fields[6])) for j in s.get_jobs()}
    assert got == {"holidays": ("8", "20"), "token": ("8", "30"), "instruments": ("8", "45"), "feed_start": ("9", "0"), "feed_stop": ("15", "35")}
    assert all(str(j.trigger.timezone) == "Asia/Kolkata" for j in s.get_jobs())


def _at(monkeypatch, d: date):
    class Fixed(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(d.year, d.month, d.day, 8, 45, tzinfo=tz)
    monkeypatch.setattr(scheduler, "datetime", Fixed)


def test_skipped_on_a_holiday_and_run_on_a_trading_day(con, monkeypatch):
    calls = []
    _at(monkeypatch, date(2026, 11, 24))
    assert scheduler.run_job("instruments", lambda: calls.append(1)) == "skipped"
    _at(monkeypatch, date(2026, 11, 12))
    assert scheduler.run_job("instruments", lambda: calls.append(1)) == "ok"
    assert calls == [1]
    rows = [tuple(r) for r in con.execute("select job, status from job_log order by id")]
    assert rows == [("instruments", "skipped"), ("instruments", "ok")]


def test_a_failing_job_is_recorded_not_raised(con, monkeypatch):
    _at(monkeypatch, date(2026, 11, 12))
    def boom():
        raise RuntimeError("feed down")
    assert scheduler.run_job("token", boom) == "error"
    assert "feed down" in con.execute("select message from job_log where status = 'error'").fetchone()[0]


def test_token_job_waits_for_env(monkeypatch):
    monkeypatch.setattr(config, "secrets", lambda: config.Secrets("1", "", "", "", ""))
    assert scheduler._renew_token() == "waiting for .env: DHAN_PIN, DHAN_TOTP_SECRET"
