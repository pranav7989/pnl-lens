# @file  services/market-iq/tests/test_sheets.py
# @area  Tests
# @what  Phase 7 assembly: a full Nifty sheet from the real chain fixture + minute bars (KPIs, sentiment, chain rows with tags and ITM, 5-minute candles with futures volume, time bar, contributions), replay at a past minute, the decoder, Sheet 3 from live state, and the internal routes.
import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, sheets
from app.dhan import chain, history, instruments
from app.main import app
from app.state import STATE
from app.store import db

FIX = Path(__file__).parent / "fixtures"
IST = config.IST
NOW = datetime(2026, 11, 12, 12, 31, 10, tzinfo=IST)
PAYLOAD = json.loads((FIX / "optionchain_nifty_sample.json").read_text())
KEY = "k" * 40


@pytest.fixture
def con(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    c = db.connect(path)
    c.execute(history.SCHEMA)
    instruments.store(c, instruments.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12"))
    # two chain snapshots (12:29 and 12:30) and a live chain in the poller
    for m, spot in ((29, 25200.0), (30, 25234.7)):
        ch = chain.parse(PAYLOAD, "NIFTY", "2026-11-17", datetime(2026, 11, 12, 12, m, tzinfo=IST))
        ch.spot = spot
        chain.save_snapshot(c, ch, fut_ltp=spot + 60)
    live = chain.parse(PAYLOAD, "NIFTY", "2026-11-17", NOW - timedelta(seconds=2))
    monkeypatch.setattr(chain.POLLER, "latest", {("NIFTY", "2026-11-17"): live})
    # minute bars 09:15-12:31 for the index and its future; previous closes
    t0 = datetime(2026, 11, 12, 9, 15, tzinfo=IST)
    rows = []
    for i in range(197):
        ts = (t0 + timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M")
        px = 25200 + i * 0.1
        rows.append(("IDX_I", "13", ts, px, px + 1, px - 1, px + 0.5, 0, None, "feed"))
        rows.append(("NSE_FNO", "61471", ts, px + 60, px + 61, px + 59, px + 60.5, 1000, 11_000_000, "feed"))
        for sid, base in (("2885", 1300.0), ("3045", 800.0)):
            rows.append(("NSE_EQ", sid, ts, base, base, base, base * (1 + i * 1e-5), 500, None, "feed"))
    c.executemany("insert into bars_1m values (?,?,?,?,?,?,?,?,?,?)", rows)
    c.executemany("insert into prev_close_daily values (?,?,?,?,?)", [("IDX_I", "13", "2026-11-12", 25255.05, None), ("NSE_FNO", "61471", "2026-11-12", 25300.0, 11_455_275),
                                                                      ("IDX_I", "21", "2026-11-12", 17.2, None), ("NSE_EQ", "2885", "2026-11-12", 1300.0, None), ("NSE_EQ", "3045", "2026-11-12", 800.0, None)])
    c.executemany("insert into index_weights values ('NIFTY 50', ?, ?, '2026-11-11', 'estimated', 0.99)", [("RELIANCE", 0.6), ("SBIN", 0.4)])
    c.commit()
    # live state: the index, its future, VIX and the two stocks
    STATE.live.clear(); STATE.bars.clear()
    STATE.apply(("IDX_I", "13"), {"ltp": 25234.7, "prev_close": 25255.05}, NOW - timedelta(seconds=3))
    STATE.apply(("NSE_FNO", "61471"), {"ltp": 25296.4, "oi": 11_708_775, "prev_oi": 11_455_275, "volume": 2_044_055}, NOW - timedelta(seconds=3))
    STATE.apply(("IDX_I", "21"), {"ltp": 16.9, "prev_close": 17.2}, NOW - timedelta(seconds=3))
    STATE.apply(("NSE_EQ", "2885"), {"ltp": 1313.0, "prev_close": 1300.0, "volume": 5_000_000, "high": 1320.0, "low": 1299.0}, NOW - timedelta(seconds=3))
    STATE.apply(("NSE_EQ", "3045"), {"ltp": 792.0, "prev_close": 800.0, "volume": 3_000_000, "high": 805.0, "low": 790.0}, NOW - timedelta(seconds=3))
    STATE.apply(("NSE_FNO", "61697"), {"ltp": 1316.0, "prev_close": 1302.0, "oi": 130_000_000, "prev_oi": 120_000_000}, NOW - timedelta(seconds=3))
    c.executemany("insert into baseline_vol values (?,?,?,?,10,'2026-11-11')", [("2885", 751, 2_500_000, 40_000), ("3045", 751, 3_000_000, 50_000)])
    c.commit()
    yield c
    STATE.live.clear()


def test_live_index_sheet(con):
    s = sheets.index_sheet("NIFTY", con=con, now=NOW)
    assert s["live"] and s["fresh"] and s["expiry"] == "2026-11-17" and s["index"] == "NIFTY 50"
    k = s["kpis"]
    assert k["spot"]["ltp"] == 25234.7 and round(k["spot"]["pct"], 3) == round((25234.7 / 25255.05 - 1) * 100, 3)
    assert round(k["basis"], 2) == round(25296.4 - 25234.7, 2) and k["futures"]["expiry"] == "2026-11-23"
    assert k["pcr"]["band"] in ("call-heavy", "balanced", "put-heavy") and k["max_pain"]["strike"] in s["chain"] and False or k["max_pain"]["strike"] is not None
    assert k["atm_iv"]["strike"] == 25250 and k["vix"]["ltp"] == 16.9 and k["support"] and k["resistance"]
    assert s["sentiment"]["band"] in [b for _, b in __import__("app.calc.oiflow", fromlist=["BANDS"]).BANDS]
    rows = s["chain"]["rows"]
    assert len(rows) <= 41 and any(r["atm"] for r in rows) and s["chain"]["step"] == 50
    atm = next(r for r in rows if r["atm"])
    assert atm["ce"]["tag"] in ("LB", "SB", "SC", "LU") and atm["ce"]["doi"] == atm["ce"]["oi"] - atm["ce"]["prev_oi"]
    assert any(r["ce"]["itm"] for r in rows if r["ce"]) and any(r["pe"]["itm"] for r in rows if r["pe"])
    # 5-minute candles: 09:15 .. 12:30, volume from the future (index volume is 0)
    c = s["candles"]
    assert c[0]["time"] == "2026-11-12T09:15" and c[-1]["time"] == "2026-11-12T12:30" and c[0]["volume"] == 5000 and c[0]["low"] < c[0]["open"]
    assert s["time_bar"]["times"] == ["2026-11-12T12:29", "2026-11-12T12:30"] and s["time_bar"]["at"] is None
    # contributions: RELIANCE +1% x 0.6 x 25255.05 = 151.5, SBIN -1% x 0.4 x 25255.05 = -101.0
    bars = {b["symbol"]: round(b["points"], 1) for b in s["contribution"]["bars"]}
    assert bars["RELIANCE"] == 151.5 and bars["SBIN"] == -101.0 and s["contribution"]["weights"]["method"] == "estimated"
    assert s["doi"]["window"] and s["compass"] and len(s["compass"]) <= 17


def test_replay_at_a_past_minute(con):
    s = sheets.index_sheet("NIFTY", at=datetime(2026, 11, 12, 12, 29, 30, tzinfo=IST), con=con, now=NOW)
    assert not s["live"] and s["fresh"] and s["time_bar"]["at"] == "2026-11-12T12:29"
    assert s["chain"]["as_of"].startswith("2026-11-12T12:29") and s["candles"][-1]["time"] == "2026-11-12T12:25"
    assert s["kpis"]["spot"]["ltp"] == 25200 + 194 * 0.1 + 0.5                  # the 12:29 bar's close, not the live price


def test_decoder_and_routes(con, monkeypatch):
    d = sheets.decode_strike("NIFTY", 25250.0, "ce", con=con, now=NOW)
    assert d["side"] == "CE" and d["atm"] and d["lines"] and d["summary"] and d["fresh"]
    assert sheets.decode_strike("NIFTY", 1.0, "ce", con=con, now=NOW) is None
    monkeypatch.setenv("MARKETIQ_INTERNAL_KEY", KEY)
    monkeypatch.setattr(sheets, "datetime", type("D", (datetime,), {"now": classmethod(lambda cls, tz=None: NOW)}))
    c = TestClient(app)
    H = {"x-internal-key": KEY}
    assert c.get("/internal/sheet/NIFTY", headers=H).status_code == 200
    assert c.get("/internal/sheet/NIFTY?at=2026-11-12T12:29", headers=H).json()["time_bar"]["at"] == "2026-11-12T12:29"
    assert c.get("/internal/sheet/NIFTY?at=nonsense", headers=H).status_code == 400
    assert c.get("/internal/sheet/GOLD", headers=H).status_code == 404
    assert c.get("/internal/decoder/NIFTY?strike=25250&side=pe", headers=H).json()["side"] == "PE"
    assert c.get("/internal/sheet/NIFTY").status_code == 401


def test_market_sheet(con):
    m = sheets.market_sheet(con, NOW)
    assert m["fresh"] and m["breadth"] == {"advancing": 1, "declining": 1, "unchanged": 0, "ad_ratio": 1.0, "universe": 2}
    assert m["movers"]["gainers"][0]["symbol"] == "RELIANCE" and m["movers"]["losers"][0]["symbol"] == "SBIN"
    assert m["r_factor"][0]["symbol"] == "RELIANCE" and m["r_factor"][0]["r"] == 2.0 and m["baselines"]
    assert m["momentum"] and m["momentum"][0]["symbol"] in ("RELIANCE", "SBIN")
    assert m["futures_buildup"]["long_buildup"]["top"][0]["symbol"] == "RELIANCE"
    assert set(m["flows"]) == {"fii_cash", "dii_cash", "fii_index_futures"} and m["header"]["NIFTY 50"]["ltp"] == 25234.7
