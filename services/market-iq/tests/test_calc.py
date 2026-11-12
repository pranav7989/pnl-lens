# @file  services/market-iq/tests/test_calc.py
# @area  Tests
# @what  Phase 6 formulas on small hand-made inputs with known answers: ATM/step/window, PCR, max pain (5-strike chain), ATM IV, S/R, ΔOI totals, donut, compass, buildup tags, sentiment bands (positioning wording only), decoder lines, contributions check line, scanners.
import json
from pathlib import Path

from app.calc import contrib, decoder, kpis, oiflow, scanners
from app.dhan import chain

FIX = Path(__file__).parent / "fixtures"


def side(oi=0, prev_oi=0, ltp=0.0, prev_close=0.0, iv=None, **g):
    return {"oi": oi, "prev_oi": prev_oi, "ltp": ltp, "prev_close": prev_close, "iv": iv, **g}


# a 5-strike chain: max pain is checkable by hand
FIVE = {
    24900: {"ce": side(oi=100), "pe": side(oi=400)},
    24950: {"ce": side(oi=200), "pe": side(oi=300)},
    25000: {"ce": side(oi=300), "pe": side(oi=300)},
    25050: {"ce": side(oi=400), "pe": side(oi=100)},
    25100: {"ce": side(oi=500), "pe": side(oi=50)},
}


def test_step_atm_and_window():
    strikes = sorted(FIVE)
    assert kpis.strike_step(strikes) == 50
    assert kpis.atm_strike(25012.0, strikes) == 25000 and kpis.atm_strike(25026.0, strikes) == 25050
    assert kpis.window(strikes, 25000, 1) == [24950, 25000, 25050]
    assert kpis.window(strikes, 25000, 20) == strikes


def test_pcr_and_bands():
    assert kpis.pcr_oi(FIVE) == (400 + 300 + 300 + 100 + 50) / (100 + 200 + 300 + 400 + 500)
    assert kpis.pcr_band(0.7) == "call-heavy" and kpis.pcr_band(1.0) == "balanced" and kpis.pcr_band(1.3) == "put-heavy"
    assert kpis.pcr_oi({25000: {"ce": None, "pe": side(oi=5)}}) is None


def test_max_pain_by_hand():
    # Pain(X) = sum CE_oi*max(0,X-k) + sum PE_oi*max(0,k-X)
    def pain(x):
        return sum(FIVE[k]["ce"]["oi"] * max(0, x - k) for k in FIVE) + sum(FIVE[k]["pe"]["oi"] * max(0, k - x) for k in FIVE)
    pains = {k: pain(k) for k in FIVE}
    # worked by hand: PE payouts only at X=24900 (300*50 + 300*100 + 100*150 + 50*200), CE only at X=25100
    # (100*200 + 200*150 + 300*100 + 400*50), both in the middle
    assert pains == {24900: 70000, 24950: 37500, 25000: 30000, 25050: 52500, 25100: 100000}
    assert kpis.max_pain(FIVE) == 25000 == min(pains, key=pains.get)
    assert kpis.max_pain({}) is None


def test_atm_iv_and_support_resistance():
    rows = {25000: {"ce": side(iv=14.0), "pe": side(iv=16.0)}, 25050: {"ce": side(iv=15.0), "pe": None}}
    assert kpis.atm_iv(rows, 25000) == 15.0 and kpis.atm_iv(rows, 25050) == 15.0 and kpis.atm_iv(rows, 1) is None
    sup, res = kpis.support_resistance(FIVE, sorted(FIVE))
    assert (sup, res) == (24900, 25100)
    assert kpis.basis(25292.6, 25230.2) == 62.4 - 0 or abs(kpis.basis(25292.6, 25230.2) - 62.4) < 1e-9
    assert round(kpis.pct_change(101.0, 100.0), 6) == 1.0 and kpis.pct_change(None, 1) is None


def test_doi_totals_donut_compass():
    rows = {25000: {"ce": side(oi=150, prev_oi=100), "pe": side(oi=400, prev_oi=100)},      # CE +50, PE +300
            25050: {"ce": side(oi=50, prev_oi=100), "pe": side(oi=100, prev_oi=100)}}        # CE -50, PE 0
    t = oiflow.doi_totals(rows, [25000, 25050])
    assert t["ce"] == 0 and t["pe"] == 300 and t["pe_share"] == 1.0 and t["doi_pcr"] is None
    c = oiflow.compass(rows, [25000, 25050])
    assert c[0]["pe_scaled"] == 1.0 and c[1]["ce_scaled"] == -50 / 300


def test_buildup_matrix():
    assert oiflow.buildup(side(oi=2, prev_oi=1, ltp=11, prev_close=10)) == "LB"
    assert oiflow.buildup(side(oi=2, prev_oi=1, ltp=9, prev_close=10)) == "SB"
    assert oiflow.buildup(side(oi=1, prev_oi=2, ltp=11, prev_close=10)) == "SC"
    assert oiflow.buildup(side(oi=1, prev_oi=2, ltp=9, prev_close=10)) == "LU"
    assert oiflow.buildup(side(oi=1, prev_oi=1, ltp=10, prev_close=10)) == "LB"             # zero counts as up
    assert oiflow.buildup(None) is None


def test_sentiment_score_and_positioning_wording():
    s = oiflow.sentiment(0.0, 0, 0, 1.0)
    assert s == {"score": 50, "band": "Neutral"}
    assert oiflow.sentiment(2.0, 0, 100, 1.5)["band"] == "Strongly bullish"                # 50 + 30 + 25 + 10 = 100 (clamped)
    assert oiflow.sentiment(-2.0, 100, 0, 0.5)["band"] == "Strongly bearish"
    for _, name in oiflow.BANDS:
        assert "buy" not in name.lower() and "sell" not in name.lower()


def test_decoder_lines_and_no_advice_words():
    opt = side(oi=3817255, prev_oi=1850485, ltp=187.2, prev_close=203.8, iv=14.03, delta=0.532, theta=-19.5, gamma=0.00093, vega=12.17)
    d = decoder.decode("CE", 25250, opt, atm_iv=14.0, gamma_rank_share=0.1, max_oi_side=False)
    names = [x["line"] for x in d["lines"]]
    assert names == ["Delta", "Theta", "Gamma", "Vega", "IV", "OI"]
    assert {x["line"]: x["band"] for x in d["lines"]} == {"Delta": "ATM", "Theta": "Heavy", "Gamma": "High", "Vega": None, "IV": "Fair", "OI": "SB"}
    assert d["summary"].startswith("ATM call, heavy decay, IV fair, short buildup. Call writers adding: 25,250 acting as resistance.")
    text = json.dumps(d).lower()
    for banned in ("edge leans", " buy ", " sell ", "target", "risky to short", "advice"):
        assert banned not in text, banned
    pe = decoder.decode("PE", 25250, side(oi=1, prev_oi=2, ltp=9, prev_close=10, iv=20.0, delta=-0.9), atm_iv=14.0, gamma_rank_share=None, max_oi_side=True)
    assert "Deep ITM put" in pe["summary"] and "IV rich" in pe["summary"] and "key support" in pe["summary"]


def test_decoder_on_a_real_chain_row():
    payload = json.loads((FIX / "optionchain_nifty_sample.json").read_text())
    c = chain.parse(payload, "NIFTY", "2026-11-17", chain.datetime.now(chain.config.IST))
    atm = kpis.atm_strike(c.spot, list(c.rows))
    d = decoder.decode("CE", atm, c.rows[atm]["ce"], kpis.atm_iv(c.rows, atm), 0.0)
    assert d["lines"] and d["summary"].endswith(".") and d["caveat"]


def test_contributions_check_line_and_others():
    w = {"A": 0.5, "B": 0.3, "C": 0.2}
    stocks = {"A": (110.0, 100.0), "B": (95.0, 100.0), "C": (100.0, 100.0)}
    # index prev 10000: A adds 10000*0.5*0.10 = 500, B drags 10000*0.3*(-0.05) = -150, C 0 -> sum 350
    r = contrib.contributions(10000.0, 10340.0, w, stocks, show_all=False, top=1)
    assert [(b["symbol"], round(b["points"])) for b in r["bars"]] == [("A", 500), ("B", -150), ("Others (1)", 0)]
    assert r["sum"] == 350 and r["actual"] == 340 and r["tracking_difference"] == 10 and r["missing"] == []
    assert len(contrib.contributions(10000.0, None, w, stocks, show_all=True)["bars"]) == 3


def test_scanners():
    b = scanners.breadth({"A": {"ltp": 11, "prev_close": 10}, "B": {"ltp": 9, "prev_close": 10}, "C": {"ltp": 10, "prev_close": 10}, "D": {"ltp": None, "prev_close": 1}})
    assert b == {"advancing": 1, "declining": 1, "unchanged": 1, "ad_ratio": 1.0}
    m = scanners.momentum([{"symbol": "X", "ltp": 102, "close_10m_ago": 100, "vol_10m": 3000, "baseline_10m": 1000},
                           {"symbol": "Y", "ltp": 99, "close_10m_ago": 100, "vol_10m": 1000, "baseline_10m": 1000}])
    assert m[0]["symbol"] == "X" and round(m[0]["score"], 6) == 60.0 and round(m[1]["score"], 6) == 10.0
    r = scanners.r_factor([{"symbol": "X", "cum_vol": 300, "baseline_cum_vol": 100}, {"symbol": "Y", "cum_vol": 50, "baseline_cum_vol": 100}])
    assert [x["symbol"] for x in r] == ["X", "Y"] and r[0]["r"] == 3.0
    q = scanners.futures_buildup([{"symbol": "LB", "ltp": 110, "prev_close": 100, "oi": 120, "prev_oi": 100},
                                  {"symbol": "SB", "ltp": 90, "prev_close": 100, "oi": 120, "prev_oi": 100},
                                  {"symbol": "SC", "ltp": 110, "prev_close": 100, "oi": 80, "prev_oi": 100},
                                  {"symbol": "LU", "ltp": 90, "prev_close": 100, "oi": 80, "prev_oi": 100},
                                  {"symbol": "flat", "ltp": 100.1, "prev_close": 100, "oi": 200, "prev_oi": 100}])
    assert {k: v["count"] for k, v in q.items()} == {"long_buildup": 1, "short_buildup": 1, "short_covering": 1, "long_unwinding": 1}
    assert q["long_buildup"]["top"][0]["symbol"] == "LB"
    mv = scanners.movers([{"symbol": "G", "ltp": 110, "prev_close": 100, "high": 111, "low": 99}, {"symbol": "L", "ltp": 90, "prev_close": 100, "high": 101, "low": 89}])
    assert mv["gainers"][0]["symbol"] == "G" and mv["losers"][0]["symbol"] == "L"
    assert mv["near_high"] == [mv["gainers"][0]] and mv["near_low"][0]["symbol"] == "L"
