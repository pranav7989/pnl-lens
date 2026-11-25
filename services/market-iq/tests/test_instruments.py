# @file  services/market-iq/tests/test_instruments.py
# @area  Tests
# @what  Instrument list on a sample of the real Dhan file: kept rows, segment-safe key, index IDs, futures, F&O stocks, strikes, holidays.
"""Instrument list on a sample of the real Dhan file: what is kept, the segment-safe key, and every lookup."""
import json
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx

from app import config
from app.dhan import instruments as ins
from app.nse import holidays
from app.store import db

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 11, 12)


@pytest.fixture
def con(tmp_path):
    c = db.connect(tmp_path / "t.db")
    ins.store(c, ins.parse((FIX / "scrip_master_sample.csv").read_text(), TODAY.isoformat()))
    holidays.store(c, holidays.parse(json.loads((FIX / "nse_holidays_2026.json").read_text())))
    return c


def test_only_dashboard_instruments_are_kept_and_test_symbols_dropped(con):
    kinds = {r[0] for r in con.execute("select distinct instrument from instruments")}
    assert kinds == {"INDEX", "FUTIDX", "FUTSTK", "EQUITY", "OPTIDX"}
    assert con.execute("select count(*) from instruments where symbol like '%NSETEST%'").fetchone()[0] == 0
    assert con.execute("select count(*) from instruments where exch_id = 'BSE' and segment = 'C'").fetchone()[0] == 0


def test_same_security_id_in_two_segments_does_not_collide(tmp_path):
    rows = ins.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12")
    c = db.connect(tmp_path / "x.db")
    ins.store(c, rows)
    rel = c.execute("select * from instruments where exch_id = 'NSE' and segment = 'E' and symbol = 'RELIANCE'").fetchone()
    assert rel["security_id"] == "2885" and rel["exch_segment"] == "NSE_EQ" and rel["name"] == "Reliance Industries"


def test_index_ids_come_from_the_file(con):
    got = {n: (ins.index_id(con, n).exch_segment, ins.index_id(con, n).security_id) for n in ins.INDICES}
    assert got == {"NIFTY 50": ("IDX_I", "13"), "NIFTY BANK": ("IDX_I", "25"), "FINNIFTY": ("IDX_I", "27"),
                   "NIFTY MIDCAP SELECT": ("IDX_I", "442"), "SENSEX": ("IDX_I", "51"), "INDIA VIX": ("IDX_I", "21")}


def test_current_month_index_futures(con):
    n, b = ins.index_future(con, "NIFTY", TODAY), ins.index_future(con, "BANKNIFTY", TODAY)
    assert (n.expiry, n.exch_segment, n.lot_size) == ("2026-11-23", "NSE_FNO", 65)
    assert b.expiry == "2026-11-23" and b.name == "BANKNIFTY NOV FUT"
    assert ins.index_future(con, "NIFTY", date(2026, 11, 24)).expiry == "2026-12-29"      # rolls after expiry


def test_fno_stocks_pair_cash_and_near_month_future(con):
    s = {x.symbol: x for x in ins.fno_stocks(con, TODAY)}
    assert set(s) == {"RELIANCE", "SBIN"}
    assert s["RELIANCE"].cash.security_id == "2885" and s["RELIANCE"].cash.exch_segment == "NSE_EQ"
    assert s["RELIANCE"].future.expiry == "2026-11-23" and s["RELIANCE"].future.exch_segment == "NSE_FNO"


def test_option_expiries_and_strikes(con):
    assert ins.option_expiries(con, "NIFTY", TODAY) == ["2026-11-17", "2026-11-23"]
    assert ins.option_strikes(con, "NIFTY", "2026-11-17") == [25000.0, 25050.0, 25100.0, 25150.0, 25200.0]


def test_holidays_and_trading_days(con):
    assert holidays.is_trading_day(date(2026, 11, 12), con)          # Thursday
    assert not holidays.is_trading_day(date(2026, 11, 24), con)      # NSE holiday
    assert not holidays.is_trading_day(date(2026, 12, 25), con)      # Christmas
    assert not holidays.is_trading_day(date(2026, 11, 14), con)      # Saturday


@respx.mock
def test_refresh_downloads_replaces_and_logs(tmp_path):
    c = db.connect(tmp_path / "r.db")
    respx.get(config.SCRIP_MASTER_URL).mock(return_value=httpx.Response(200, text=(FIX / "scrip_master_sample.csv").read_text()))
    with httpx.Client() as client:
        n1 = ins.refresh(c, client)
        n2 = ins.refresh(c, client)
    assert n1 == n2 == c.execute("select count(*) from instruments").fetchone()[0]
    assert c.execute("select count(*) from job_log where job = 'instruments' and status = 'ok'").fetchone()[0] == 2
