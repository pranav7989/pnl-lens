# @file  services/market-iq/tests/test_chain.py
# @area  Tests
# @what  Option chain on a real (trimmed) Dhan response: parsing, 3 s rate limit per underlying + expiry, 60 s snapshots without all-zero strikes, reading the chain back at a time, stale marking, expiry fallback, clean-up.
import itertools
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app import config
from app.dhan import chain, instruments
from app.store import db

FIX = Path(__file__).parent / "fixtures"
IST = config.IST
PAYLOAD = json.loads((FIX / "optionchain_nifty_sample.json").read_text())
T = datetime(2026, 11, 12, 12, 30, 5, tzinfo=IST)


@pytest.fixture
def con(tmp_path):
    c = db.connect(tmp_path / "c.db")
    instruments.store(c, instruments.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12"))
    return c


def test_parse_real_response():
    c = chain.parse(PAYLOAD, "NIFTY", "2026-11-17", T)
    assert c.spot == PAYLOAD["data"]["last_price"] and len(c.rows) == 27
    assert list(c.rows) == sorted(c.rows)                              # strikes in order
    atm = min(c.rows, key=lambda k: abs(k - c.spot))
    ce, pe = c.rows[atm]["ce"], c.rows[atm]["pe"]
    assert 0.3 < ce["delta"] < 0.7 and -0.7 < pe["delta"] < -0.3
    assert ce["theta"] < 0 and ce["iv"] > 0 and ce["oi"] > 0 and ce["prev_oi"] >= 0 and ce["bid"] <= ce["ask"]


def test_snapshot_skips_empty_strikes_and_reads_back_at_a_time(con):
    c = chain.parse(PAYLOAD, "NIFTY", "2026-11-17", T)
    n = chain.save_snapshot(con, c, fut_ltp=25260.0)
    stored = {r[0] for r in con.execute("select distinct strike from chain_snap")}
    empty = {k for k, v in c.rows.items() if chain._empty(v["ce"]) and chain._empty(v["pe"])}
    assert empty and not (stored & empty) and n == 2 * len(stored)
    later = chain.parse(PAYLOAD, "NIFTY", "2026-11-17", T + timedelta(minutes=1))
    later.rows[next(iter(stored))]["ce"]["oi"] = 1                    # changes a minute later
    chain.save_snapshot(con, later)
    at_1230 = chain.load_snapshot(con, "NIFTY", "2026-11-17", datetime(2026, 11, 12, 12, 30, 59, tzinfo=IST))
    at_1231 = chain.load_snapshot(con, "NIFTY", "2026-11-17", datetime(2026, 11, 12, 12, 45, tzinfo=IST))
    k = next(iter(stored))
    assert at_1230.rows[k]["ce"]["oi"] != 1 and at_1231.rows[k]["ce"]["oi"] == 1
    assert at_1230.live is False and at_1230.fresh() and at_1230.spot == c.spot
    assert chain.load_snapshot(con, "NIFTY", "2026-11-17", datetime(2026, 11, 12, 9, 0, tzinfo=IST)) is None
    assert chain.snapshot_times(con, "NIFTY", "2026-11-12") == ["2026-11-12T12:30", "2026-11-12T12:31"]
    assert con.execute("select fut_ltp from spot_snap where ts = '2026-11-12T12:30'").fetchone()[0] == 25260.0


def test_one_chain_request_every_3_seconds_across_underlyings(con, monkeypatch):
    calls = []
    def post(con, client, path, body):
        calls.append((time.monotonic(), body["UnderlyingScrip"], body["Expiry"]))
        return httpx.Response(200, json=PAYLOAD)
    monkeypatch.setattr(chain, "POLL_EVERY", 0.3)
    p = chain.ChainPoller(post=post)
    with httpx.Client() as c:
        p.fetch(con, c, "NIFTY", "2026-11-17")
        p.fetch(con, c, "BANKNIFTY", "2026-11-23")                  # another underlying waits too (live API: HTTP 429 otherwise)
        p.fetch(con, c, "NIFTY", "2026-11-17")
    gaps = [b[0] - a[0] for a, b in itertools.pairwise(calls)]
    assert all(g >= 0.29 for g in gaps)
    assert [x[1] for x in calls] == [13, 25, 13]
    assert p.get("NIFTY", "2026-11-17").spot == PAYLOAD["data"]["last_price"]


def test_the_poller_takes_turns_and_snapshots_once_a_minute(con, monkeypatch):
    seen = []
    def post(con, client, path, body):
        seen.append(body["UnderlyingScrip"])
        if len(seen) >= 6:
            p._stop.set()
        return httpx.Response(200, json=PAYLOAD)
    monkeypatch.setattr(chain, "POLL_EVERY", 0.01)
    monkeypatch.setattr(chain, "refresh_expiries", lambda con, client, gap=0: {})
    monkeypatch.setattr(chain.db, "connect", lambda path=None: con)
    monkeypatch.setattr(chain, "default_expiry", lambda con, u, today=None: {"NIFTY": "2026-11-17", "BANKNIFTY": "2026-11-23"}[u])
    p = chain.ChainPoller(post=post)
    p._run()
    assert seen[:4] == [13, 25, 13, 25]
    assert p.snapshots == 2                                           # one per underlying in this minute

def test_a_failed_poll_keeps_the_last_chain_which_turns_stale(con):
    responses = [httpx.Response(200, json=PAYLOAD), httpx.Response(500, json={})]
    p = chain.ChainPoller(post=lambda *a: responses.pop(0))
    with httpx.Client() as c:
        good = p.fetch(con, c, "NIFTY", "2026-11-17")
        p._last_req.clear()
        assert p.fetch(con, c, "NIFTY", "2026-11-17") is None
    assert p.get("NIFTY", "2026-11-17") is good and p.errors == 1 and p.last_error == "HTTP 500"
    assert good.fresh(good.as_of + timedelta(seconds=9)) and not good.fresh(good.as_of + timedelta(seconds=11))


def test_expiries_fall_back_to_the_instrument_list(con):
    from datetime import date
    assert chain.default_expiry(con, "NIFTY", date(2026, 11, 12)) == "2026-11-17"
    con.execute("insert into expiries values ('NIFTY', '2026-11-19', '2026-11-12')")
    con.commit()
    assert chain.default_expiry(con, "NIFTY", date(2026, 11, 12)) == "2026-11-19"


def test_cleanup_keeps_30_days_of_chain_and_90_of_bars(con):
    now = datetime(2026, 11, 12, 23, 0, tzinfo=IST)
    old, recent = "2026-10-01T10:00", "2026-11-01T10:00"
    for ts in (old, recent):
        con.execute("insert into chain_snap (underlying, expiry, ts, strike, side) values ('NIFTY', 'x', ?, 1, 'CE')", (ts,))
        con.execute("insert into spot_snap (underlying, ts) values ('NIFTY', ?)", (ts,))
    con.execute("insert into bars_1m values ('IDX_I', '13', '2026-07-01T10:00', 1, 1, 1, 1, 0, null, 'feed')")
    con.execute("insert into bars_1m values ('IDX_I', '13', '2026-10-01T10:00', 1, 1, 1, 1, 0, null, 'feed')")
    con.commit()
    assert chain.cleanup(con, now) == "removed 1 chain rows, 1 spot rows, 1 bars"
    assert [r[0] for r in con.execute("select ts from chain_snap")] == [recent]
