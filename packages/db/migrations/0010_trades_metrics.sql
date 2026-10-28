-- @file  packages/db/migrations/0010_trades_metrics.sql
-- @area  Database
-- @what  Normalised engine output: trades, fills, report_metrics, report_traits; new reports columns (title, MON-YY, file-set lock).
-- ============================================================================
-- 0010 · Trades and metrics (plan §7; fills / report_traits / reports.title,
--        month_label, fingerprint per D15)
-- Every derived row is keyed by the analysis (one engine run) that produced it and
-- carries engine_version. Derived rows are append-only: a report always points at
-- its CURRENT analysis (reports.analysis_id); older analyses of the same report
-- (before files were added) keep their rows as history. Use the view
-- current_trades for "a user's trades" so nothing is counted twice.
-- reports.report (ReportV1 jsonb) stays what the UI renders; these rows come from
-- the same engine run and are written in the same transaction, so they agree.
-- ============================================================================

create table if not exists public.trades (
  id             bigserial primary key,
  analysis_id    uuid not null references public.analyses(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  source_file_id uuid references public.statement_files(id) on delete set null,
  seq            int  not null check (seq >= 0),             -- position in report.trades
  symbol         text not null,
  underlying     text,
  market         text,
  segment        text,
  kind           text not null check (kind in ('EQ', 'FUT', 'CE', 'PE')),
  option_type    text generated always as (case when kind in ('CE', 'PE') then kind end) stored,
  grp            text,                                       -- engine `group`
  family         text,
  direction      text check (direction is null or direction in ('Long', 'Short')),
  entry_date     date,
  exit_date      date,
  entry_hour     smallint check (entry_hour is null or entry_hour between 0 and 23),
  hold_days      numeric(12, 4),
  sell_days      numeric(12, 4),
  expiry         date,
  expiry_type    text,
  weekday        text,
  strike         numeric(20, 6),                             -- not emitted by the engine yet
  qty            numeric(20, 6) not null,
  open_qty       numeric(20, 6),
  avg_buy        numeric(20, 6),
  buy            numeric(20, 6),                             -- buy value (gross)
  sell           numeric(20, 6),                             -- sell value (gross)
  pnl            numeric(20, 6) not null,                    -- gross P&L
  net_est        numeric(20, 6),                             -- after estimated charges
  pct            numeric(20, 6),
  style          text,
  n_legs         int,
  mult           numeric(20, 6),
  is_opt         boolean,
  currency       text not null,
  broker         text,
  source_row     text,                                       -- sheet/row reference when known
  fingerprint    text,
  engine_version text not null,
  unique (analysis_id, seq)                                  -- idempotent store step
);
create index if not exists trades_analysis on public.trades (analysis_id);
-- a user's trade history by close date (Progress, later analytics)
create index if not exists trades_user_exit on public.trades (user_id, exit_date);

create table if not exists public.fills (
  id             bigserial primary key,
  analysis_id    uuid not null references public.analyses(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  source_file_id uuid references public.statement_files(id) on delete set null,
  seq            int  not null check (seq >= 0),
  symbol         text not null,
  side           text not null check (side in ('buy', 'sell')),
  qty            numeric(20, 6) not null,
  price          numeric(20, 6),
  fees           numeric(20, 6),
  trade_date     date,
  trade_time     time,
  exchange       text,
  segment        text,
  order_ref      text,
  currency       text,
  source_row     text,
  engine_version text not null,
  unique (analysis_id, seq)
);
create index if not exists fills_analysis on public.fills (analysis_id);

create table if not exists public.report_metrics (
  analysis_id    uuid primary key references public.analyses(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  n              int not null,
  wins           int,
  losses         int,
  win_rate       numeric(12, 6),
  payoff         numeric(20, 6),
  profit_factor  numeric(20, 6),
  realized       numeric(20, 6),
  charges        numeric(20, 6),
  other          numeric(20, 6),
  net            numeric(20, 6),
  from_date      date,
  to_date        date,
  source         text check (source is null or source in ('tradebook', 'statement')),
  market         text,
  currency       text not null,
  progress_score numeric(6, 2),
  extra          jsonb,                                       -- the rest of `m`
  engine_version text not null,
  created_at     timestamptz not null default now()
);
-- Progress history: a user's metrics over time
create index if not exists report_metrics_user on public.report_metrics (user_id, to_date);

create table if not exists public.report_traits (
  analysis_id    uuid not null references public.analyses(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  trait_id       int  not null,
  area           text not null,
  name           text not null,
  score          numeric(6, 2) not null,
  level          text check (level is null or level in ('Strong', 'Clear', 'Emerging')),
  is_primary     boolean not null,                            -- behaviour.traits (true) vs behaviour.more (false)
  evidence       jsonb not null,                              -- { now, why, ideal }
  engine_version text not null,
  primary key (analysis_id, trait_id)
);
create index if not exists report_traits_user on public.report_traits (user_id, trait_id);

-- ---- reports: new columns ---------------------------------------------------
alter table public.reports add column if not exists analysis_id       uuid unique references public.analyses(id);
alter table public.reports add column if not exists engine_version    text;
alter table public.reports add column if not exists subscription_id   uuid references public.subscriptions(id);
alter table public.reports add column if not exists title             text check (title is null or char_length(title) between 1 and 120);
alter table public.reports add column if not exists month_label       text check (month_label is null or month_label ~ '^[A-Z]{3}-[0-9]{2}$');
-- file-set lock: every file fingerprint ever accepted into this report. Removing a file
-- never frees its place; re-adding the same statement is always fine (HANDOFF §6).
alter table public.reports add column if not exists used_fingerprints text[] not null default '{}';
-- hash of the report's current file set (sorted file fingerprints)
alter table public.reports add column if not exists fingerprint       text;
-- F12: the engine can emit 4-letter currencies (USDT); char(3) would reject them.
alter table public.reports alter column currency type text;

-- ---- current_trades: the trades of each live report's current analysis ------
create or replace view public.current_trades with (security_invoker = true) as
  select t.*, r.id as report_id
    from public.trades t
    join public.reports r on r.analysis_id = t.analysis_id
   where r.purged_at is null;

-- ---- grants -----------------------------------------------------------------
grant select on public.trades, public.fills, public.report_metrics, public.report_traits, public.current_trades to lens_app;
-- worker: writes engine output once per analysis (unique keys make a re-run a no-op)
grant select, insert on public.trades, public.fills, public.report_metrics, public.report_traits to lens_worker;
grant usage on sequence public.trades_id_seq, public.fills_id_seq to lens_worker;
