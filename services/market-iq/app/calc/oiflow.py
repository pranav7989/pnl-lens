# @file  services/market-iq/app/calc/oiflow.py
# @area  Market IQ
# @what  Change in OI (parameters PDF 4.6): CE vs PE totals over ATM +-20, the donut shares and ΔOI PCR, and the OI compass rows (ATM +-8); plus the option buildup tag (4.7) and the sentiment score (4.2) with positioning wording.
from __future__ import annotations

from app.calc.kpis import Rows

# owner's wording rule ("no SEBI issues"): the score describes positioning, never Buy/Sell
BANDS = [(20, "Strongly bearish"), (40, "Bearish"), (60, "Neutral"), (80, "Bullish"), (101, "Strongly bullish")]
SENTIMENT_WEIGHTS = {"price": 15.0, "writing": 25.0, "positioning": 20.0}


def doi(side: dict | None) -> float | None:
    if not side or side.get("oi") is None or side.get("prev_oi") is None:
        return None
    return float(side["oi"]) - float(side["prev_oi"])


def premium_change(side: dict | None) -> float | None:
    if not side or side.get("ltp") is None or not side.get("prev_close"):
        return None
    return float(side["ltp"]) - float(side["prev_close"])


def buildup(side: dict | None) -> str | None:
    """LB long buildup (premium up, OI up), SB short buildup (down, up), SC short covering (up, down),
    LU long unwinding (down, down). Zero counts as up, as in the PDF."""
    p, d = premium_change(side), doi(side)
    if p is None or d is None:
        return None
    if p >= 0:
        return "LB" if d >= 0 else "SC"
    return "SB" if d >= 0 else "LU"


BUILDUP_TEXT = {"LB": "Long buildup: premium up, OI up: fresh buying.", "SB": "Short buildup: premium down, OI up: fresh writing.",
                "SC": "Short covering: premium up, OI down: writers exiting.", "LU": "Long unwinding: premium down, OI down: buyers exiting."}


def doi_totals(rows: Rows, strikes: list[float]) -> dict:
    ce = sum(doi(rows[k].get("ce")) or 0 for k in strikes)
    pe = sum(doi(rows[k].get("pe")) or 0 for k in strikes)
    pos_ce, pos_pe = max(0.0, ce), max(0.0, pe)
    total = pos_ce + pos_pe
    return {"ce": ce, "pe": pe,
            "pe_share": pos_pe / total if total else None, "ce_share": pos_ce / total if total else None,
            "doi_pcr": pe / ce if ce else None}


def compass(rows: Rows, strikes: list[float]) -> list[dict]:
    """Two bars per strike from a zero line, scaled to the largest |ΔOI| in view (-1 ... 1)."""
    vals = [(k, doi(rows[k].get("ce")) or 0.0, doi(rows[k].get("pe")) or 0.0) for k in strikes]
    top = max([abs(v) for _, c, p in vals for v in (c, p)] or [0]) or 1.0
    return [{"strike": k, "ce": c, "pe": p, "ce_scaled": c / top, "pe_scaled": p / top} for k, c, p in vals]


def sentiment(spot_pct: float | None, doi_ce: float, doi_pe: float, pcr: float | None, w: dict | None = None) -> dict:
    """score = 50 + 15 x spot % change + 25 x (dOI_PE - dOI_CE) / (|dOI_PE| + |dOI_CE|) + 20 x (PCR - 1), clamped 0-100.
    A summary of the other tiles, not a signal."""
    w = w or SENTIMENT_WEIGHTS
    denom = abs(doi_pe) + abs(doi_ce)
    score = 50.0 + w["price"] * (spot_pct or 0.0) + (w["writing"] * (doi_pe - doi_ce) / denom if denom else 0.0) + w["positioning"] * ((pcr or 1.0) - 1.0)
    score = max(0.0, min(100.0, score))
    return {"score": round(score), "band": next(name for upper, name in BANDS if score < upper)}
