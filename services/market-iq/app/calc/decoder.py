# @file  services/market-iq/app/calc/decoder.py
# @area  Market IQ
# @what  Strike decoder (parameters PDF 4.8): plain-English lines for one option (delta, theta, gamma, vega, IV vs ATM, OI buildup) and a one-line summary, each printing the rule it used; bands are an editable table; data wording only.
"""Wording rule (owner): describe data, never advise. Overrides of the PDF: the IV line says "priced above/below ATM
IV" (not "edge leans to sellers"); the gamma line says how fast delta changes (not "risky to short"). The panel shows
the caveat that OI and premium alone cannot tell a buyer from a writer with certainty."""
from __future__ import annotations

from app.calc.oiflow import BUILDUP_TEXT, buildup

CAVEAT = "OI and premium alone cannot tell a buyer from a writer with certainty; the tags follow the usual market convention."

DEFAULT_RULES = {
    "delta": [(0.80, "Deep ITM"), (0.55, "ITM"), (0.45, "ATM"), (0.20, "OTM"), (0.0, "Far OTM")],      # |delta| >= value
    "theta": [(3.0, "Heavy"), (1.0, "High"), (0.3, "Moderate"), (0.0, "Low")],                           # |theta| Rs/day >= value
    "gamma": [(0.20, "High"), (0.60, "Medium"), (1.01, "Low")],                                           # rank share in window <= value
    "iv": [(2.0, "Rich"), (-2.0, "Fair")],                                                                 # iv - atm_iv > value; else Cheap
}
DELTA_TEXT = {"Deep ITM": "very likely to expire in the money", "ITM": "more likely than not to expire in the money",
              "ATM": "roughly a coin flip of expiring in the money", "OTM": "less likely to expire in the money",
              "Far OTM": "unlikely to expire in the money"}
THETA_TEXT = {"Heavy": "Heavy decay", "High": "High decay", "Moderate": "Moderate decay", "Low": "Low decay"}
GAMMA_TEXT = {"High": "delta changes fast when the index moves", "Medium": "delta changes at a moderate pace",
              "Low": "delta changes slowly"}
IMPLICATION = {("CE", "SB"): "Call writers adding: {s} acting as resistance.", ("PE", "SB"): "Put writers adding: {s} acting as support.",
               ("CE", "SC"): "Call writers exiting: resistance at {s} weakening.", ("PE", "SC"): "Put writers exiting: support at {s} weakening.",
               ("CE", "LB"): "Call buyers adding positions at {s}.", ("PE", "LB"): "Put buyers adding hedges or positions at {s}.",
               ("CE", "LU"): "Buyers closing positions at {s}.", ("PE", "LU"): "Buyers closing positions at {s}."}


def _fmt_strike(k: float) -> str:
    return f"{k:,.0f}" if float(k).is_integer() else f"{k:,.2f}"


def _band(value: float, bands: list[tuple[float, str]]) -> str:
    for edge, name in bands:
        if value >= edge:
            return name
    return bands[-1][1]


def decode(side: str, strike: float, opt: dict, atm_iv: float | None, gamma_rank_share: float | None,
           max_oi_side: bool = False, rules: dict | None = None) -> dict:
    """side 'CE' | 'PE'; gamma_rank_share = this option's gamma rank in the window / count (0 = highest)."""
    r = rules or DEFAULT_RULES
    lines = []
    d = opt.get("delta")
    kind = "call" if side == "CE" else "put"
    if d is not None:
        b = _band(abs(d), r["delta"])
        lines.append({"line": "Delta", "value": round(d, 2), "band": b,
                      "text": f"{b}: {DELTA_TEXT[b]}; about ₹{abs(d):.2f} per 1-point move.", "rule": "ATM = |delta| 0.45-0.55"})
    t = opt.get("theta")
    if t is not None:
        b = _band(abs(t), r["theta"])
        lines.append({"line": "Theta", "value": round(t, 2), "band": b,
                      "text": f"{THETA_TEXT[b]}: loses about ₹{abs(t):.2f} a day from time alone.", "rule": "heavy ≥ 3 · high 1–3 · moderate 0.3–1 · low < 0.3 ₹/day"})
    g = opt.get("gamma")
    if g is not None and gamma_rank_share is not None:
        b = next(name for edge, name in r["gamma"] if gamma_rank_share <= edge)
        lines.append({"line": "Gamma", "value": round(g, 4), "band": b, "text": f"{b}: {GAMMA_TEXT[b]}.",
                      "rule": "high = top 20% of the window · medium = top 60%"})
    v = opt.get("vega")
    if v is not None:
        lines.append({"line": "Vega", "value": round(v, 2), "band": None,
                      "text": f"IV +1% adds about ₹{abs(v):.2f} to the premium; IV −1% takes it off.", "rule": "₹ change per 1% IV"})
    iv = opt.get("iv")
    if iv and atm_iv:
        diff = iv - atm_iv
        b = "Rich" if diff > r["iv"][0][0] else "Cheap" if diff < r["iv"][1][0] else "Fair"
        text = {"Rich": f"Rich: priced above ATM IV ({diff:+.1f} pts vs {atm_iv:.1f}%).", "Cheap": f"Cheap: priced below ATM IV ({diff:+.1f} pts vs {atm_iv:.1f}%).",
                "Fair": f"Fair: in line with ATM IV ({diff:+.1f} pts vs {atm_iv:.1f}%)."}[b]
        lines.append({"line": "IV", "value": round(iv, 1), "band": b, "text": text, "rule": "rich > ATM +2 · cheap < ATM −2"})
    tag = buildup(opt)
    if tag:
        dv = (opt.get("oi") or 0) - (opt.get("prev_oi") or 0)
        lines.append({"line": "OI", "value": dv, "band": tag, "text": BUILDUP_TEXT[tag], "rule": "premium change × OI change"})
    bands = {x["line"]: x["band"] for x in lines}
    parts = [f"{bands.get('Delta') or ''} {kind}".strip()]
    if bands.get("Theta"):
        parts.append(f"{bands['Theta'].lower()} decay")
    if bands.get("IV"):
        parts.append(f"IV {bands['IV'].lower()}")
    if tag:
        parts.append({"LB": "long buildup", "SB": "short buildup", "SC": "short covering", "LU": "long unwinding"}[tag])
    summary = ", ".join(parts) + "."
    if tag and (side, tag) in IMPLICATION:
        summary += " " + IMPLICATION[(side, tag)].format(s=_fmt_strike(strike))
    if max_oi_side:
        summary += f" Highest {kind} OI in the chain: key {'resistance' if side == 'CE' else 'support'}."
    return {"side": side, "strike": strike, "lines": lines, "summary": summary[0].upper() + summary[1:], "caveat": CAVEAT}
