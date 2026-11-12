# @file  services/market-iq/app/calc/kpis.py
# @area  Market IQ
# @what  Sheet 1/2 KPI tiles (parameters PDF 4.1): ATM strike, % change, basis, PCR (OI), max pain, ATM IV, support/resistance; pure functions on a chain.
"""A chain here is {strike: {"ce": {...} | None, "pe": {...} | None}} with the fields of app/dhan/chain.py
(ltp, prev_close, oi, prev_oi, volume, iv, delta, gamma, theta, vega, bid, ask)."""
from __future__ import annotations

import itertools

Rows = dict[float, dict[str, dict | None]]


def _oi(side: dict | None) -> float:
    return float(side.get("oi") or 0) if side else 0.0


def strike_step(strikes: list[float]) -> float | None:
    """The most common gap between strikes (read from the chain, never hard-coded)."""
    gaps = [round(b - a, 4) for a, b in itertools.pairwise(strikes) if b > a]
    return max(set(gaps), key=gaps.count) if gaps else None


def atm_strike(spot: float | None, strikes: list[float]) -> float | None:
    """round(spot / step) x step, snapped to a listed strike."""
    if spot is None or not strikes:
        return None
    step = strike_step(sorted(strikes))
    target = round(spot / step) * step if step else spot
    return min(strikes, key=lambda k: (abs(k - target), k))


def window(strikes: list[float], atm: float | None, n: int) -> list[float]:
    """ATM -n ... ATM +n strikes (2n + 1 rows)."""
    s = sorted(strikes)
    if atm is None or atm not in s:
        return s
    i = s.index(atm)
    return s[max(0, i - n): i + n + 1]


def pct_change(ltp: float | None, prev_close: float | None) -> float | None:
    if not ltp or not prev_close:
        return None
    return (ltp - prev_close) / prev_close * 100


def basis(fut_ltp: float | None, spot: float | None) -> float | None:
    return None if fut_ltp is None or spot is None else fut_ltp - spot


def pcr_oi(rows: Rows) -> float | None:
    """Sum of PE OI / sum of CE OI over every strike of the expiry."""
    ce = sum(_oi(v.get("ce")) for v in rows.values())
    pe = sum(_oi(v.get("pe")) for v in rows.values())
    return pe / ce if ce else None


def pcr_band(pcr: float | None) -> str | None:
    if pcr is None:
        return None
    return "call-heavy" if pcr < 0.8 else "put-heavy" if pcr > 1.2 else "balanced"


def max_pain(rows: Rows) -> float | None:
    """The strike X with the lowest total payout to option holders at expiry:
    Pain(X) = sum CE_oi(k) * max(0, X - k) + sum PE_oi(k) * max(0, k - X)."""
    strikes = sorted(rows)
    if not strikes or not any(_oi(v.get("ce")) or _oi(v.get("pe")) for v in rows.values()):
        return None
    ce = [(k, _oi(rows[k].get("ce"))) for k in strikes]
    pe = [(k, _oi(rows[k].get("pe"))) for k in strikes]
    def pain(x: float) -> float:
        return sum(o * max(0.0, x - k) for k, o in ce) + sum(o * max(0.0, k - x) for k, o in pe)
    return min(strikes, key=lambda x: (pain(x), x))


def atm_iv(rows: Rows, atm: float | None) -> float | None:
    """(CE IV + PE IV) / 2 at the ATM strike (one side if only one has an IV)."""
    if atm is None or atm not in rows:
        return None
    ivs = [s.get("iv") for s in (rows[atm].get("ce"), rows[atm].get("pe")) if s and s.get("iv")]
    return sum(ivs) / len(ivs) if ivs else None


def support_resistance(rows: Rows, strikes: list[float]) -> tuple[float | None, float | None]:
    """Support = strike with the most PE OI, resistance = strike with the most CE OI, inside the window."""
    if not strikes:
        return None, None
    sup = max(strikes, key=lambda k: (_oi(rows[k].get("pe")), -k))
    res = max(strikes, key=lambda k: (_oi(rows[k].get("ce")), k))
    return (sup if _oi(rows[sup].get("pe")) else None), (res if _oi(rows[res].get("ce")) else None)
