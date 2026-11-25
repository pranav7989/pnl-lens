# @file  services/market-iq/tests/test_nse_flows.py
# @area  Tests
# @what  Phase 5 on real NSE files: FII/DII cash parsing, the FII index futures row of the derivatives .xls, the evening job (cash + missing futures days), CSV backfill, constituents, and index weights recovered from minute bars.
import json
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
import pytest
import respx

from app import config
from app.dhan import instruments
from app.nse import fiidii, holidays, weights
from app.store import db

FIX = Path(__file__).parent / "fixtures"
CASH = json.loads((FIX / "nse_fiidii.json").read_text())
XLS = (FIX / "nse_fii_stats_11-Nov-2026.xls").read_bytes()


@pytest.fixture
def con(tmp_path):
    c = db.connect(tmp_path / "n.db")
    holidays.store(c, holidays.parse(json.loads((FIX / "nse_holidays_2026.json").read_text())))
    return c


def test_cash_rows_become_one_day():
    assert fiidii.parse_cash(CASH) == {"date": "2026-11-11", "fii_buy": 30087.21, "fii_sell": 17523.88, "fii_net": 12563.33,
                                       "dii_buy": 19704.39, "dii_sell": 28138.92, "dii_net": -8434.53}
    assert fiidii.parse_cash([]) is None


def test_index_futures_row_of_the_real_xls():
    assert fiidii.parse_fut_xls(XLS) == {"buy": 7897.51, "sell": 4561.0, "net": 3336.51}


class FakeNse:
    def __init__(self, payload):
        self.payload, self.paths = payload, []

    def get_json(self, path, referer=None):
        self.paths.append(path)
        return self.payload

    def close(self):
        pass


@respx.mock
def test_evening_job_saves_cash_and_fills_missing_futures_days_skipping_holidays(con, monkeypatch):
    class D(date):
        @classmethod
        def today(cls):
            return date(2026, 11, 12)
    monkeypatch.setattr(fiidii, "date", D)
    route = respx.get(url__regex=r"https://nsearchives\.nseindia\.com/content/fo/fii_stats_.*\.xls").mock(
        side_effect=lambda req: httpx.Response(200, content=XLS) if "11-Nov-2026" in str(req.url) or "12-Nov-2026" in str(req.url) else httpx.Response(404))
    respx.get(url__regex=r"https://archives\.nseindia\.com/.*").mock(return_value=httpx.Response(404))
    with httpx.Client() as c:
        msg = fiidii.refresh(con, FakeNse(CASH), c, days=4)          # 12, 11, 10 (holiday), 9 Nov
    assert msg == "cash 2026-11-11; index futures +2 days"
    assert [r[0] for r in con.execute("select date from fii_fut order by date")] == ["2026-11-11", "2026-11-12"]
    assert not any("10-Nov-2026" in str(call.request.url) for call in route.calls)        # holidays are not even asked for
    with httpx.Client() as c:
        fiidii.refresh(con, FakeNse(CASH), c, days=4)
    asked = [str(c.request.url).split("fii_stats_")[1] for c in route.calls]
    assert asked.count("11-Nov-2026.xls") == 1 and asked.count("12-Nov-2026.xls") == 1    # stored days are not fetched again
    assert asked.count("09-Nov-2026.xls") == 2                                            # a missing trading day is retried
    s = fiidii.last_sessions(con)
    assert s["fii_cash"] == [{"date": "2026-11-11", "net": 12563.33}] and s["fii_index_futures"][-1]["net"] == 3336.51


def test_csv_backfill(con, tmp_path):
    p = tmp_path / "f.csv"
    p.write_text("date,fii_buy,fii_sell,dii_buy,dii_sell\n03-Nov-2026,100,150,90,40\n2026-11-04,10,5,1,2\nbad,x,1,1,1\n")
    assert fiidii.backfill_csv(con, str(p)) == 2
    assert [tuple(r) for r in con.execute("select date, fii_net, dii_net, source from fii_dii order by date")] == [
        ("2026-11-03", -50.0, 50.0, "csv"), ("2026-11-04", 5.0, -1.0, "csv")]


def test_constituent_list_from_niftyindices():
    rows = weights.parse_list((FIX / "niftyindices_niftybank.csv").read_text())
    assert 10 <= len(rows) <= 16 and {"symbol": "AXISBANK", "company": "Axis Bank Ltd.", "industry": "Financial Services"} in rows


def test_fit_recovers_weights_and_reports_r2():
    rng = np.random.default_rng(7)
    true = rng.dirichlet(np.ones(12))
    X = rng.normal(0, 0.004, size=(200, 12))
    y = X @ true + rng.normal(0, 1e-6, size=200)
    w, r2 = weights.fit(y, X)
    assert np.abs(w - true).max() < 0.002 and abs(w.sum() - 1) < 1e-9 and r2 > 0.999


def test_estimate_from_minute_bars_end_to_end(con):
    instruments.store(con, instruments.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12"))
    con.executemany("insert into index_constituents values ('NIFTY 50', ?, '', '', '2026-11-12')", [("RELIANCE",), ("SBIN",)])
    day = "2026-11-12"
    con.executemany("insert into prev_close_daily values (?, ?, ?, ?, null)",
                    [("IDX_I", "13", day, 25000.0), ("NSE_EQ", "2885", day, 1300.0), ("NSE_EQ", "3045", day, 800.0)])
    rng = np.random.default_rng(1)
    t0 = datetime(2026, 11, 12, 9, 15)
    rows = []
    for m in range(60):
        r1, r2 = rng.normal(0, 0.003, 2)
        ts = (t0 + timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M")
        rows += [("NSE_EQ", "2885", ts, 1300 * (1 + r1)), ("NSE_EQ", "3045", ts, 800 * (1 + r2)), ("IDX_I", "13", ts, 25000 * (1 + 0.7 * r1 + 0.3 * r2))]
    con.executemany("insert into bars_1m values (?, ?, ?, null, null, null, ?, 0, null, 'feed')", rows)
    con.commit()
    e = weights.estimate(con, "NIFTY 50", day)
    assert e["stocks"] == 2 and e["minutes"] == 60 and e["missing"] == [] and e["r2"] > 0.9999
    w, meta = weights.latest_weights(con, "NIFTY 50")
    assert abs(w["RELIANCE"] - 0.7) < 1e-6 and abs(w["SBIN"] - 0.3) < 1e-6 and meta["method"] == "estimated"
    con.execute("insert into index_weights values ('NIFTY 50', 'RELIANCE', 1.0, ?, 'official', null)", (day,))
    con.commit()
    assert weights.latest_weights(con, "NIFTY 50")[1]["method"] == "official"            # a licensed file wins
    with pytest.raises(LookupError, match="complete minutes"):
        con.execute("delete from bars_1m where ts > '2026-11-12T09:30'")
        con.commit()
        weights.estimate(con, "NIFTY 50", day)
    assert config.IST                                                                    # keep the import meaningful
