-- @file  packages/db/migrations/0031_market_daily.sql
-- @area  Database
-- @what  Market context (India only): daily closes of NIFTY 50, NIFTY BANK and India VIX, fetched automatically by the api (Upstox public history, NSE as fallback), and a sync status row per symbol for monitoring.
--
-- Public market data, no personal data. The api (the only service with internet access) fills gaps itself: every
-- run asks only for the days after the last stored one, so missed days are caught up automatically. Reports use
-- only derived figures (index return over the period, results by VIX level and by index move), never raw prices.

create table if not exists public.market_daily (
  symbol     text not null check (symbol in ('NIFTY', 'BANKNIFTY', 'INDIAVIX')),
  day        date not null,
  open       numeric(14, 4),
  high       numeric(14, 4),
  low        numeric(14, 4),
  close      numeric(14, 4) not null check (close > 0),
  source     text not null check (source in ('upstox', 'nse')),
  fetched_at timestamptz not null default now(),
  primary key (symbol, day)
);

create table if not exists public.market_sync (
  symbol          text primary key check (symbol in ('NIFTY', 'BANKNIFTY', 'INDIAVIX')),
  last_day        date,
  last_ok_at      timestamptz,
  last_attempt_at timestamptz,
  last_source     text,
  last_error      text check (last_error is null or char_length(last_error) <= 500)
);

revoke all on public.market_daily, public.market_sync from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert, update on public.market_daily, public.market_sync to lens_app;
  end if;
end $$;
