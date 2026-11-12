# @file  services/market-iq/tests/test_feed.py
# @area  Tests
# @what  Live feed: packet parsing (several per frame, IST trade time, float prev OI), subscription batches, 1-minute bars, a full run against a fake Dhan WebSocket (subscribe, reconnect, saved bars) and today's backfill.
import asyncio
import json
import struct
from datetime import datetime
from pathlib import Path

import httpx
import pytest
import respx
import websockets

from app import config
from app.auth import token as tk
from app.dhan import feed, instruments
from app.dhan import feed_proto as fp
from app.state import MarketState
from app.store import db

FIX = Path(__file__).parent / "fixtures"
IST = config.IST


def ist_epoch(h: int, m: int, s: int = 0, day: int = 12) -> int:
    """Dhan's way: the IST wall time written as if it were UTC."""
    return int(datetime(2026, 11, day, h, m, s, tzinfo=config.IST).replace(tzinfo=None).timestamp() - datetime(1970, 1, 1).timestamp())


def quote(seg: int, sid: int, ltp: float, ltt: int, vol: int, o=1.0, h=2.0, lo=0.5) -> bytes:
    return struct.pack("<BHBI", 4, 50, seg, sid) + struct.pack("<fHIfIIIffff", ltp, 1, ltt, ltp, vol, 10, 20, o, 0.0, h, lo)


def oi(seg: int, sid: int, v: int) -> bytes:
    return struct.pack("<BHBI", 5, 12, seg, sid) + struct.pack("<I", v)


def prev(seg: int, sid: int, close: float, prev_oi: float) -> bytes:
    return struct.pack("<BHBI", 6, 16, seg, sid) + struct.pack("<ff", close, prev_oi)


def test_frames_with_several_packets_and_the_ist_trade_time():
    t = ist_epoch(12, 15, 20)
    frame = quote(0, 13, 25223.35, t, 0) + quote(2, 61471, 25249.5, t, 2044055) + oi(2, 61471, 11708775)
    ps = fp.parse_frame(frame)
    assert [(p.code, p.segment, p.security_id) for p in ps] == [(4, "IDX_I", "13"), (4, "NSE_FNO", "61471"), (5, "NSE_FNO", "61471")]
    assert ps[0].data["ltt"] == datetime(2026, 11, 12, 12, 15, 20, tzinfo=IST)
    assert ps[1].data["ltp"] == 25249.5 and ps[0].data["ltp"] == 25223.35          # float32 noise rounded to 2 decimals
    assert ps[1].data["volume"] == 2044055 and ps[2].data["oi"] == 11708775


def test_prev_close_has_a_float_previous_oi_and_bad_lengths_end_safely():
    p = fp.parse_frame(prev(2, 61471, 25214.2, 11455275.0))[0]
    assert round(p.data["prev_close"], 1) == 25214.2 and p.data["prev_oi"] == 11455275
    assert fp.parse_frame(struct.pack("<BHBI", 4, 400, 0, 13) + b"\0" * 8) == []        # length past the end
    assert fp.parse_frame(b"\x04\x00") == []
    assert fp.parse_frame(struct.pack("<BHBI", 50, 10, 0, 0) + struct.pack("<H", 807))[0].data == {"reason": 807}


def test_subscriptions_are_batched_by_100():
    subs = [("NSE_EQ", str(i)) for i in range(250)]
    msgs = fp.subscribe_messages(subs, fp.QUOTE)
    assert [m["InstrumentCount"] for m in msgs] == [100, 100, 50]
    assert msgs[0]["RequestCode"] == 17 and msgs[0]["InstrumentList"][0] == {"ExchangeSegment": "NSE_EQ", "SecurityId": "0"}


def test_minute_bars_from_ticks():
    s = MarketState()
    k = ("NSE_FNO", "61471")
    at = lambda m, sec=0: datetime(2026, 11, 12, 12, m, sec, tzinfo=IST)
    s.apply(k, {"ltp": 100.0, "ltt": at(15, 1), "volume": 1000}, at(15, 1))
    s.apply(k, {"oi": 500}, at(15, 2))
    s.apply(k, {"ltp": 103.0, "ltt": at(15, 30), "volume": 1300}, at(15, 30))
    s.apply(k, {"ltp": 99.0, "ltt": at(15, 50), "volume": 1450}, at(15, 50))
    s.apply(k, {"ltp": 101.0, "ltt": at(16, 5), "volume": 1500}, at(16, 5))     # next minute closes 12:15
    s.apply(k, {"ltp": 50.0, "ltt": at(14, 59), "volume": 1500}, at(16, 6))     # late tick for a closed minute: ignored
    (key, b), = s.take_done()
    assert key == k and (b.minute, b.open, b.high, b.low, b.close, b.volume, b.oi) == ("2026-11-12T12:15", 100.0, 103.0, 99.0, 99.0, 450, 500)
    s.close_minutes(at(17))
    (_, b2), = s.take_done()
    assert (b2.minute, b2.open, b2.volume) == ("2026-11-12T12:16", 101.0, 50)


@pytest.fixture
def con(tmp_path, monkeypatch):
    path = tmp_path / "f.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    c = db.connect(path)
    instruments.store(c, instruments.parse((FIX / "scrip_master_sample.csv").read_text(), "2026-11-12"))
    tk.save(c, tk.Token("tok-live", datetime(2026, 11, 13, 12, 0, tzinfo=IST)))
    monkeypatch.setattr(config, "secrets", lambda: config.Secrets("1100000001", "1", "JBSWY3DPEHPK3PXP", "", ""))
    monkeypatch.setattr(tk.Token, "valid", lambda self, now=None: True)
    return c


def test_the_feed_waits_for_and_fetches_a_missing_instrument_list(con, monkeypatch):
    calls = []
    monkeypatch.setattr(instruments, "ensure_today", lambda con=None: calls.append(1) or 0)
    monkeypatch.setattr(feed, "feed_instruments", lambda con, today=None: (_ for _ in ()).throw(LookupError("NIFTY 50")))
    f = feed.Feed(state=MarketState())

    async def main():
        task = asyncio.create_task(f.run())
        await asyncio.sleep(0.2)
        assert not task.done() and f.last_error == "instrument list: LookupError"   # alive and waiting, not crashed
        f._stop.set()
        await asyncio.wait_for(task, 2)

    asyncio.run(main())
    assert calls


def test_feed_instruments_are_indices_index_futures_and_fno_cash_plus_futures(con):
    subs, names = feed.feed_instruments(con, datetime(2026, 11, 12).date())
    assert ("IDX_I", "13") in subs and ("IDX_I", "21") in subs and ("IDX_I", "51") in subs
    assert ("NSE_EQ", "2885") in subs and names[("NSE_EQ", "2885")] == "RELIANCE"
    assert names[("NSE_FNO", "61471")] == "NIFTY FUT"
    assert len(subs) == len(set(subs)) == 6 + 2 + 2 * 2


def test_full_run_against_a_fake_dhan_feed(con, monkeypatch):
    monkeypatch.setattr(feed, "BACKOFF", [0.05])
    got: list[dict] = []
    urls: list[str] = []
    t = ist_epoch(12, 15, 5)

    async def handler(ws):
        urls.append(ws.request.path)
        for _ in range(2 * len(feed.feed_instruments(con)[0]) // 100 + 2):   # all subscribe messages
            try:
                got.append(json.loads(await asyncio.wait_for(ws.recv(), 0.5)))
            except TimeoutError:
                break
        await ws.send(prev(0, 13, 25255.05, 0.0) + quote(0, 13, 25223.35, t, 0) + quote(2, 61471, 25249.5, t, 2000))
        await ws.send(oi(2, 61471, 11708775))
        await asyncio.sleep(0.2)
        await ws.close()                                              # the server drops us: the client reconnects

    async def main():
        async with websockets.serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            st = MarketState()
            f = feed.Feed(state=st, url=f"ws://127.0.0.1:{port}")
            await asyncio.wait_for(f.run(max_sessions=2), 10)
            return f, st

    f, st = asyncio.run(main())
    assert len(urls) == 2 and f.reconnects == 1                       # reconnected after the drop
    assert "token=tok-live" in urls[0] and "clientId=1100000001" in urls[0] and "version=2" in urls[0]
    codes = [m["RequestCode"] for m in got]
    assert set(codes) == {15, 17} and all(m["InstrumentCount"] <= 100 for m in got)
    nifty = st.live[("IDX_I", "13")]
    assert round(nifty.ltp, 2) == 25223.35 and round(nifty.prev_close, 2) == 25255.05
    assert st.live[("NSE_FNO", "61471")].oi == 11708775
    saved = {tuple(r) for r in con.execute("select security_id, ts, source from bars_1m")}
    assert ("13", "2026-11-12T12:15", "feed") in saved and ("61471", "2026-11-12T12:15", "feed") in saved
    s = f.summary(datetime(2026, 11, 12, 12, 15, 30, tzinfo=IST))
    assert s["receiving"] == 2 and s["connected"] is False and s["recent"][0]["name"] in ("NIFTY 50", "NIFTY FUT")


@respx.mock
def test_backfill_uses_utc_history_times_and_never_overwrites_feed_bars(con):
    con.execute("insert into bars_1m values ('IDX_I', '13', '2026-11-12T09:16', 1, 1, 1, 1, 0, null, 'feed')")
    con.commit()
    utc_0916 = int(datetime(2026, 11, 12, 9, 16, tzinfo=IST).timestamp())
    body = {"open": [10.0, 11.0], "high": [12.0, 13.0], "low": [9.0, 10.0], "close": [11.0, 12.0], "volume": [5, 6],
            "timestamp": [utc_0916, utc_0916 + 60], "open_interest": [100, 110]}
    route = respx.post(f"{config.DHAN_API_BASE}/charts/intraday").mock(return_value=httpx.Response(200, json=body))
    with httpx.Client() as c:
        n = feed.backfill_today(con, c, datetime(2026, 11, 12, 9, 20, tzinfo=IST))
    assert route.call_count == 4 and n == 8
    sent = json.loads(route.calls[2].request.content)
    assert sent["instrument"] == "FUTIDX" and sent["oi"] is True and sent["fromDate"] == "2026-11-12 09:15:00"
    rows = {(r["security_id"], r["ts"]): (r["open"], r["source"]) for r in con.execute("select * from bars_1m")}
    assert rows[("13", "2026-11-12T09:16")] == (1.0, "feed")                    # feed bar kept
    assert rows[("13", "2026-11-12T09:17")] == (11.0, "history")


def test_window():
    from app.nse import holidays
    c = db.connect(":memory:")
    holidays.store(c, holidays.parse(json.loads((FIX / "nse_holidays_2026.json").read_text())))
    assert feed.in_window(datetime(2026, 11, 12, 9, 0, tzinfo=IST), c)
    assert feed.in_window(datetime(2026, 11, 12, 15, 35, tzinfo=IST), c)
    assert not feed.in_window(datetime(2026, 11, 12, 15, 36, tzinfo=IST), c)
    assert not feed.in_window(datetime(2026, 11, 24, 11, 0, tzinfo=IST), c)        # NSE holiday


def test_start_job_waits_for_env(monkeypatch):
    monkeypatch.setattr(config, "secrets", lambda: config.Secrets("1", "", "", "", ""))
    assert feed.start_job() == "waiting for .env: DHAN_PIN, DHAN_TOTP_SECRET"
    assert not feed.FEED.running
