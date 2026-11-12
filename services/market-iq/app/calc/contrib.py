# @file  services/market-iq/app/calc/contrib.py
# @area  Market IQ
# @what  Who moved the index (parameters PDF 4.3): points per constituent = index previous close x weight x stock return; Nifty top 5 adders + top 5 draggers + others, Bank Nifty all; the check line against the actual move.
from __future__ import annotations


def contributions(index_prev: float, index_ltp: float | None, weights: dict[str, float], stocks: dict[str, tuple[float | None, float | None]],
                  show_all: bool = False, top: int = 5) -> dict:
    """stocks: symbol -> (ltp, prev_close). Points are index points."""
    pts = {}
    for sym, w in weights.items():
        ltp, prev = stocks.get(sym, (None, None))
        if ltp and prev:
            pts[sym] = index_prev * w * (ltp - prev) / prev
    total = sum(pts.values())
    actual = (index_ltp - index_prev) if index_ltp is not None and index_prev else None
    ordered = sorted(pts.items(), key=lambda kv: -kv[1])
    if show_all:
        bars = [{"symbol": s, "points": p} for s, p in ordered]
    else:
        adders = [(s, p) for s, p in ordered if p > 0][:top]
        draggers = [(s, p) for s, p in reversed(ordered) if p < 0][:top][::-1]
        shown = {s for s, _ in adders + draggers}
        others = sum(p for s, p in pts.items() if s not in shown)
        bars = [{"symbol": s, "points": p} for s, p in adders + draggers] + [{"symbol": f"Others ({len(pts) - len(shown)})", "points": others, "others": True}]
    return {"bars": bars, "sum": total, "actual": actual,
            "tracking_difference": (total - actual) if actual is not None else None, "missing": sorted(set(weights) - set(pts))}
