"""SQLite (WAL mode): one file in data/, tables created on first use. Schema follows the build manual §5,
with one correction: instruments are keyed by (exch_id, segment, security_id) because Dhan reuses a
security id across segments."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app import config

SCHEMA = """
create table if not exists token (
  id integer primary key check (id = 1),
  access_token text not null,
  expires_at text not null,          -- ISO time, IST
  created_at text not null
);
create table if not exists instruments (
  exch_id text not null,             -- NSE / BSE / MCX
  segment text not null,             -- I index, E equity, D derivatives, C currency, M commodity
  security_id text not null,
  exch_segment text not null,        -- API code: IDX_I, NSE_EQ, NSE_FNO ...
  symbol text not null,              -- ticker / underlying symbol
  name text,
  instrument text not null,          -- INDEX, EQUITY, FUTIDX, OPTIDX, FUTSTK, OPTSTK ...
  expiry text,                       -- YYYY-MM-DD for derivatives
  strike real,
  option_type text,                  -- CE / PE
  lot_size real,
  underlying_id text,
  underlying_symbol text,
  expiry_flag text,                  -- W / M
  as_of text not null,
  primary key (exch_id, segment, security_id)
);
create index if not exists instruments_und on instruments (underlying_symbol, instrument, expiry);
create table if not exists job_log (
  id integer primary key autoincrement,
  job text not null, started_at text not null, ended_at text, status text, message text
);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = Path(path or config.DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("pragma journal_mode=wal")
    con.execute("pragma foreign_keys=on")
    con.executescript(SCHEMA)
    return con
