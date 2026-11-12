# @file  services/market-iq/app/calc/scanners.py
# @area  Market IQ
# @what  Sheet 3 (parameters PDF 5.1, 5.3-5.6): breadth, 10-minute momentum spike, R-factor, stock futures OI buildup quadrants, movers (gainers, losers, near day high/low).
from __future__ import annotations


def breadth(stocks: dict[str, dict]) -> dict:
    """stocks: symbol -> {ltp, prev_close}."""
    adv = sum(1 for s in stocks.values() if s.get("ltp") and s.get("prev_close") and s["ltp"] > s["prev_close"])
    dec = sum(1 for s in stocks.values() if s.get("ltp") and s.get("prev_close") and s["ltp"] < s["prev_close"])
    unch = sum(1 for s in stocks.values() if s.get("ltp") and s.get("prev_close") and s["ltp"] == s["prev_close"])
    return {"advancing": adv, "declining": dec, "unchanged": unch, "ad_ratio": adv / dec if dec else None}


def momentum(rows: list[dict], top: int = 15) -> list[dict]:
    """rows: {symbol, ltp, close_10m_ago, vol_10m, baseline_10m}. score = |ret10| x vol surge x 10."""
    out = []
    for r in rows:
        if not r.get("ltp") or not r.get("close_10m_ago") or not r.get("baseline_10m"):
            continue
        ret = (r["ltp"] / r["close_10m_ago"] - 1) * 100
        surge = (r.get("vol_10m") or 0) / r["baseline_10m"]
        out.append({"symbol": r["symbol"], "ret10": ret, "surge": surge, "score": abs(ret) * surge * 10, "pct": r.get("pct")})
    return sorted(out, key=lambda x: -x["score"])[:top]


def r_factor(rows: list[dict], top: int = 15) -> list[dict]:
    """rows: {symbol, cum_vol, baseline_cum_vol, pct}. R = today's volume so far / average volume to the same minute."""
    out = [{"symbol": r["symbol"], "r": r["cum_vol"] / r["baseline_cum_vol"], "pct": r.get("pct")}
           for r in rows if r.get("cum_vol") is not None and r.get("baseline_cum_vol")]
    return sorted(out, key=lambda x: -x["r"])[:top]


QUADRANT = {(True, True): "long_buildup", (False, True): "short_buildup", (True, False): "short_covering", (False, False): "long_unwinding"}


def futures_buildup(rows: list[dict], top: int = 5, min_price_pct: float = 0.3) -> dict:
    """rows: {symbol, ltp, prev_close, oi, prev_oi} for near-month stock futures."""
    groups: dict[str, list[dict]] = {q: [] for q in QUADRANT.values()}
    for r in rows:
        if not r.get("ltp") or not r.get("prev_close") or not r.get("prev_oi") or r.get("oi") is None:
            continue
        price = (r["ltp"] - r["prev_close"]) / r["prev_close"] * 100
        oi = (r["oi"] - r["prev_oi"]) / r["prev_oi"] * 100
        if abs(price) < min_price_pct:
            continue
        groups[QUADRANT[(price >= 0, oi >= 0)]].append({"symbol": r["symbol"], "price_pct": price, "oi_pct": oi})
    return {q: {"count": len(v), "top": sorted(v, key=lambda x: -abs(x["oi_pct"]))[:top]} for q, v in groups.items()}


def movers(stocks: list[dict], top: int = 10) -> dict:
    """stocks: {symbol, ltp, prev_close, high, low, r}. Four tabs."""
    rows = []
    for s in stocks:
        if not s.get("ltp") or not s.get("prev_close"):
            continue
        pct = (s["ltp"] - s["prev_close"]) / s["prev_close"] * 100
        rows.append({**s, "pct": pct,
                     "from_high": (s["high"] - s["ltp"]) / s["ltp"] * 100 if s.get("high") else None,
                     "from_low": (s["ltp"] - s["low"]) / s["ltp"] * 100 if s.get("low") else None})
    return {"gainers": sorted(rows, key=lambda x: -x["pct"])[:top],
            "losers": sorted(rows, key=lambda x: x["pct"])[:top],
            "near_high": sorted([r for r in rows if r["pct"] > 0 and r["from_high"] is not None], key=lambda x: x["from_high"])[:top],
            "near_low": sorted([r for r in rows if r["pct"] < 0 and r["from_low"] is not None], key=lambda x: x["from_low"])[:top]}
