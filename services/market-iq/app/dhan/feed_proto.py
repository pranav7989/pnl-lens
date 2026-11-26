# @file  services/market-iq/app/dhan/feed_proto.py
# @area  Market IQ
# @what  Dhan live feed v2 wire format: subscription messages (max 100 instruments each) and the little-endian binary packet parser (several packets per frame).
"""Pure, no I/O. Verified on the live feed (12 Nov 2026), where it differs from the docs:
- One WebSocket frame can hold several packets back to back; the int16 at bytes 1-2 is each packet's own length
  (header included), so a frame is walked packet by packet. (The official SDK reads only the first one.)
- Previous close (code 6) is sent only for a Ticker subscription (RequestCode 15), once per instrument, so we
  subscribe Ticker AND Quote (17); both work together on one connection.
- In the code-6 packet the previous OI is a float32, not the documented int32.
- Last trade time is IST wall-clock time written as if it were UTC epoch seconds (12:15 IST arrives as 12:15Z).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import UTC, datetime

from app import config

TICKER, QUOTE = 15, 17                      # subscription request codes (docs + SDK)
DISCONNECT_REQUEST = 12
MAX_PER_MESSAGE = 100
SEGMENTS = {0: "IDX_I", 1: "NSE_EQ", 2: "NSE_FNO", 3: "NSE_CURRENCY", 4: "BSE_EQ", 5: "MCX_COMM", 7: "BSE_CURRENCY", 8: "BSE_FNO"}

HEADER = struct.Struct("<BHBI")             # code, packet length, segment, security id
TICK = struct.Struct("<fI")                 # ltp, ltt
QUOTE_BODY = struct.Struct("<fHIfIIIffff")  # ltp, ltq, ltt, atp, volume, sell qty, buy qty, open, close, high, low
PREV = struct.Struct("<ff")                 # prev close, prev OI (float32 on the wire)
OI = struct.Struct("<I")
DISC = struct.Struct("<H")


def px(v: float) -> float:
    """Prices arrive as float32 (25242.900390625); exchange ticks are 0.05, so 2 decimals are exact."""
    return round(v, 2)


@dataclass(frozen=True)
class Packet:
    code: int
    segment: str
    security_id: str
    data: dict


def ltt_to_ist(raw: int) -> datetime | None:
    """Dhan's last trade time: IST wall-clock time encoded as UTC epoch seconds."""
    if raw <= 0:
        return None
    return datetime.fromtimestamp(raw, UTC).replace(tzinfo=config.IST)


def parse_frame(frame: bytes) -> list[Packet]:
    """Every packet in one binary frame. Unknown codes are skipped; a broken length ends the frame safely."""
    out: list[Packet] = []
    o, n = 0, len(frame)
    while o + HEADER.size <= n:
        code, length, seg, sid = HEADER.unpack_from(frame, o)
        if length < HEADER.size or o + length > n:
            break
        body = o + HEADER.size
        segment = SEGMENTS.get(seg, str(seg))
        d: dict | None = None
        if code == 2 and length >= 16:
            ltp, ltt = TICK.unpack_from(frame, body)
            d = {"ltp": px(ltp), "ltt": ltt_to_ist(ltt)}
        elif code == 4 and length >= 50:
            ltp, ltq, ltt, atp, vol, sell, buy, op, cl, hi, lo = QUOTE_BODY.unpack_from(frame, body)
            d = {"ltp": px(ltp), "ltq": ltq, "ltt": ltt_to_ist(ltt), "avg": px(atp), "volume": vol, "sell_qty": sell, "buy_qty": buy,
                 "open": px(op), "close": px(cl), "high": px(hi), "low": px(lo)}
        elif code == 5 and length >= 12:
            d = {"oi": OI.unpack_from(frame, body)[0]}
        elif code == 6 and length >= 16:
            pc, poi = PREV.unpack_from(frame, body)
            d = {"prev_close": px(pc), "prev_oi": round(poi)}
        elif code == 50 and length >= 10:
            d = {"reason": DISC.unpack_from(frame, body)[0]}
        if d is not None:
            out.append(Packet(code, segment, str(sid), d))
        o += length
    return out


def subscribe_messages(instruments: list[tuple[str, str]], request_code: int) -> list[dict]:
    """(segment, security_id) pairs -> JSON subscription messages of at most 100 instruments each."""
    msgs = []
    for i in range(0, len(instruments), MAX_PER_MESSAGE):
        batch = instruments[i:i + MAX_PER_MESSAGE]
        msgs.append({"RequestCode": request_code, "InstrumentCount": len(batch),
                     "InstrumentList": [{"ExchangeSegment": seg, "SecurityId": sid} for seg, sid in batch]})
    return msgs
