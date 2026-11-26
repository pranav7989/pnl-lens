-- @file  packages/db/migrations/0033_desk_reference.sql
-- @area  Database
-- @what  Desk (spec v1.0, PR 1): reference data (market calendar 2026, expiry calendar, instrument master, charge rates with effective dates, brokerage plans) and per-trader desk_settings; seeds the 1 Apr 2026 rates and 2026 NSE holidays.
--
-- Reference tables hold public facts, no user data: everyone may read them; only owner/admin change them, through
-- the API (permission desk:admin, every change written to audit_log). desk_settings is the trader's own: the API
-- always filters by the signed-in user; it is cleared when the account is deleted and included in "Export my data".
-- The trade plan tables (rules, plans, plan lines, checklist) follow the Trade Check architecture doc in PR 3.

create table if not exists public.market_calendar (
  day        date not null,
  segment    text not null check (segment in ('equity', 'currency', 'commodity')),
  exchange   text not null check (exchange in ('NSE', 'BSE', 'MCX')),
  is_holiday boolean not null default false,
  pre_open   time,
  open       time,
  close      time,
  note       text,
  primary key (day, segment, exchange)
);

create table if not exists public.expiry_calendar (
  underlying text not null,
  exchange   text not null,
  expiry     date not null,
  kind       text not null check (kind in ('weekly', 'monthly')),
  primary key (underlying, exchange, expiry)
);

create table if not exists public.instrument_master (
  id          bigserial primary key,
  exchange    text not null,
  segment     text not null,
  symbol      text not null,
  underlying  text,
  instrument  text,
  option_type text,
  strike      numeric,
  expiry      date,
  lot_size    int,
  tick_size   numeric,
  valid_from  date not null,
  valid_to    date,
  source      text,
  loaded_at   timestamptz not null default now(),
  unique (exchange, symbol, valid_from)
);
create index if not exists instrument_master_underlying on public.instrument_master (underlying, expiry);

-- Rates are fractions (0.0015 = 0.15%); sebi_per_crore and ipft_per_crore in rupees per crore of turnover.
create table if not exists public.charge_rates (
  id              serial primary key,
  segment         text not null check (segment in ('eq_delivery', 'eq_intraday', 'futures', 'options', 'currency_fut', 'currency_opt', 'commodity_fut', 'commodity_opt')),
  exchange        text not null check (exchange in ('NSE', 'BSE', 'MCX')),
  effective_from  date not null,
  stt_buy         numeric not null default 0,
  stt_sell        numeric not null default 0,
  stt_exercise    numeric not null default 0,
  exch_txn        numeric not null default 0,
  sebi_per_crore  numeric not null default 10,
  stamp_buy       numeric not null default 0,
  gst             numeric not null default 0.18,
  ipft_per_crore  numeric not null default 0,
  stt_round_rupee boolean not null default true,
  source_note     text,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  unique (segment, exchange, effective_from)
);

create table if not exists public.brokerage_plans (
  id             serial primary key,
  name           text not null,
  segment        text not null check (segment in ('eq_delivery', 'eq_intraday', 'futures', 'options', 'currency_fut', 'currency_opt', 'commodity_fut', 'commodity_opt')),
  flat_per_order numeric,                -- e.g. 20
  pct            numeric,                -- e.g. 0.0003 (0.03%)
  cap_per_order  numeric,                -- e.g. 20: pct of the order value, at most this
  is_default     boolean not null default false,
  check (flat_per_order is not null or pct is not null),
  unique (name, segment)
);

create table if not exists public.desk_settings (
  user_id               uuid primary key references public.users(id) on delete cascade,
  risk_per_trade        numeric check (risk_per_trade is null or risk_per_trade > 0),
  max_daily_loss        numeric check (max_daily_loss is null or max_daily_loss > 0),
  max_trades_day        int check (max_trades_day is null or max_trades_day between 1 and 100),
  brokerage_plan        text,               -- brokerage_plans.name (one plan = a row per segment)
  default_exchange      text not null default 'NSE' check (default_exchange in ('NSE', 'BSE', 'MCX')),
  avg_slippage_override numeric check (avg_slippage_override is null or avg_slippage_override >= 0),
  adherence_target      int not null default 80 check (adherence_target between 1 and 100),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------- seeds
-- Charge rates in force from 1 Apr 2026 (spec B1, as published by Zerodha; the Finance Act 2026 raised F&O STT).
-- Verify against the exchange circulars before go-live (an admin can add a new row with a later effective_from).
insert into public.charge_rates (segment, exchange, effective_from, stt_buy, stt_sell, stt_exercise, exch_txn, sebi_per_crore, stamp_buy, source_note) values
  ('eq_delivery',   'NSE', '2026-04-01', 0.001, 0.001,   0,      0.0000307, 10, 0.00015,  'spec v1.0 B1 (Zerodha charges, 1 Apr 2026)'),
  ('eq_delivery',   'BSE', '2026-04-01', 0.001, 0.001,   0,      0.0000375, 10, 0.00015,  'spec v1.0 B1'),
  ('eq_intraday',   'NSE', '2026-04-01', 0,     0.00025, 0,      0.0000307, 10, 0.00003,  'spec v1.0 B1'),
  ('eq_intraday',   'BSE', '2026-04-01', 0,     0.00025, 0,      0.0000375, 10, 0.00003,  'spec v1.0 B1'),
  ('futures',       'NSE', '2026-04-01', 0,     0.0005,  0,      0.0000183, 10, 0.00002,  'spec v1.0 B1 (STT 0.05% from 1 Apr 2026)'),
  ('futures',       'BSE', '2026-04-01', 0,     0.0005,  0,      0,         10, 0.00002,  'spec v1.0 B1'),
  ('options',       'NSE', '2026-04-01', 0,     0.0015,  0.0015, 0.0003553, 10, 0.00003,  'spec v1.0 B1 (STT 0.15% of premium from 1 Apr 2026)'),
  ('options',       'BSE', '2026-04-01', 0,     0.0015,  0.0015, 0.000325,  10, 0.00003,  'spec v1.0 B1'),
  ('currency_fut',  'NSE', '2026-04-01', 0,     0,       0,      0.0000035, 10, 0.000001, 'spec v1.0 B1'),
  ('currency_fut',  'BSE', '2026-04-01', 0,     0,       0,      0.0000045, 10, 0.000001, 'spec v1.0 B1'),
  ('currency_opt',  'NSE', '2026-04-01', 0,     0,       0,      0.000311,  10, 0.000001, 'spec v1.0 B1'),
  ('currency_opt',  'BSE', '2026-04-01', 0,     0,       0,      0.00001,   10, 0.000001, 'spec v1.0 B1'),
  ('commodity_fut', 'MCX', '2026-04-01', 0,     0.0001,  0,      0.000021,  10, 0.00002,  'spec v1.0 B1 (CTT non-agri; agri SEBI fee ₹1/crore not modelled)'),
  ('commodity_fut', 'NSE', '2026-04-01', 0,     0.0001,  0,      0.000001,  10, 0.00002,  'spec v1.0 B1'),
  ('commodity_opt', 'MCX', '2026-04-01', 0,     0.0005,  0,      0.000418,  10, 0.00003,  'spec v1.0 B1'),
  ('commodity_opt', 'NSE', '2026-04-01', 0,     0.0005,  0,      0.00001,   10, 0.00003,  'spec v1.0 B1'),
  -- F&O STT before the Finance Act 2026 change (in force 1 Oct 2024 - 31 Mar 2026): futures 0.02%, options 0.1%
  ('futures',       'NSE', '2024-10-01', 0,     0.0002,  0,      0.0000183, 10, 0.00002,  'previous STT (Oct 2024)'),
  ('futures',       'BSE', '2024-10-01', 0,     0.0002,  0,      0,         10, 0.00002,  'previous STT (Oct 2024)'),
  ('options',       'NSE', '2024-10-01', 0,     0.001,   0.00125, 0.0003553, 10, 0.00003, 'previous STT (Oct 2024)'),
  ('options',       'BSE', '2024-10-01', 0,     0.001,   0.00125, 0.000325,  10, 0.00003, 'previous STT (Oct 2024)')
on conflict (segment, exchange, effective_from) do nothing;

-- Default brokerage (owner decision O4): Rs 20/order flat for options, 0.03% or Rs 20 (lower) for intraday/futures, Rs 0 delivery.
insert into public.brokerage_plans (name, segment, flat_per_order, pct, cap_per_order, is_default) values
  ('Discount broker', 'eq_delivery',   0,    null,   null, true),
  ('Discount broker', 'eq_intraday',   null, 0.0003, 20,   true),
  ('Discount broker', 'futures',       null, 0.0003, 20,   true),
  ('Discount broker', 'options',       20,   null,   null, true),
  ('Discount broker', 'currency_fut',  null, 0.0003, 20,   true),
  ('Discount broker', 'currency_opt',  20,   null,   null, true),
  ('Discount broker', 'commodity_fut', null, 0.0003, 20,   true),
  ('Discount broker', 'commodity_opt', 20,   null,   null, true)
on conflict (name, segment) do nothing;

-- Market calendar for 2026 and Q1 2027: every weekday per segment with its session times; NSE 2026 trading holidays
-- (NSE holiday list, F&O/equity) marked. MCX closes 23:55 while the US is on standard time (Nov-Mar), else 23:30.
-- Weekends are not stored: no row = closed. An admin can correct any day.
insert into public.market_calendar (day, segment, exchange, pre_open, open, close)
select d::date, s.segment, s.exchange, s.pre_open, s.open,
       case when s.segment = 'commodity' and extract(month from d) in (11, 12, 1, 2, 3) then time '23:55' else s.close end
  from generate_series(date '2026-01-01', date '2027-03-31', interval '1 day') d,
       (values ('equity', 'NSE', time '09:00', time '09:15', time '15:30'),
               ('equity', 'BSE', time '09:00', time '09:15', time '15:30'),
               ('currency', 'NSE', null::time, time '09:00', time '17:00'),
               ('commodity', 'MCX', null::time, time '09:00', time '23:30')) s(segment, exchange, pre_open, open, close)
 where extract(isodow from d) < 6
on conflict do nothing;

update public.market_calendar c set is_holiday = true, note = h.note
  from (values ('2026-01-15'::date, 'Municipal Corporation Election - Maharashtra'), ('2026-01-26', 'Republic Day'), ('2026-02-15', 'Mahashivratri'),
               ('2026-03-03', 'Holi'), ('2026-03-21', 'Id-Ul-Fitr (Ramadan Eid)'), ('2026-03-26', 'Shri Ram Navami'), ('2026-03-31', 'Shri Mahavir Jayanti'),
               ('2026-04-03', 'Good Friday'), ('2026-04-14', 'Dr. Baba Saheb Ambedkar Jayanti'), ('2026-05-01', 'Maharashtra Day'), ('2026-05-28', 'Bakri Id'),
               ('2026-06-26', 'Muharram'), ('2026-08-15', 'Independence Day'), ('2026-09-14', 'Ganesh Chaturthi'), ('2026-10-02', 'Mahatma Gandhi Jayanti'),
               ('2026-10-20', 'Dussehra'), ('2026-11-10', 'Diwali-Balipratipada'), ('2026-11-24', 'Prakash Gurpurb Sri Guru Nanak Dev'),
               ('2026-12-25', 'Christmas')) h(day, note)
 where c.day = h.day and c.segment in ('equity', 'currency');

-- ---------------------------------------------------------------- privileges
revoke all on public.market_calendar, public.expiry_calendar, public.instrument_master, public.charge_rates, public.brokerage_plans, public.desk_settings from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    -- reference data: read by everyone; owner/admin edits go through the API (desk:admin permission, audit_log)
    grant select, insert, update on public.market_calendar, public.charge_rates, public.brokerage_plans to lens_app;
    grant select, insert, update, delete on public.expiry_calendar, public.instrument_master to lens_app;
    grant usage on sequence public.charge_rates_id_seq, public.brokerage_plans_id_seq, public.instrument_master_id_seq to lens_app;
    grant select, insert, update on public.desk_settings to lens_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then
    grant select on public.market_calendar, public.expiry_calendar, public.instrument_master, public.charge_rates, public.brokerage_plans to lens_worker;
  end if;
end $$;

-- ---------------------------------------------------------------- account deletion and export
create or replace function public.forget_desk_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from desk_settings where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_desk_on_account_delete() from public;
drop trigger if exists users_forget_desk on public.users;
create trigger users_forget_desk after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_desk_on_account_delete();

create or replace function public.export_user_data(p_request uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from data_requests where id = p_request and kind = 'export' and status = 'processing';
  if not found then raise exception 'not_an_open_export' using errcode = 'P0001'; end if;
  return export_user_data_base(p_request) || jsonb_build_object(
    'journal', coalesce((select jsonb_agg(jsonb_build_object('trade', n.trade_key, 'setup', n.setup, 'tags', n.tags, 'emotion', n.emotion,
                  'note', n.note, 'created_at', n.created_at, 'updated_at', n.updated_at) order by n.created_at)
                from trade_notes n where n.user_id = v_user), '[]'),
    'thirty_day_plans', coalesce((select jsonb_agg(jsonb_build_object('report', p.report_id, 'generated_on', p.generated_on, 'checkup_on', p.checkup_on,
                  'plan', p.plan) order by p.generated_on)
                from plan_snapshots p where p.user_id = v_user), '[]'),
    'checkup_reminders', coalesce((select jsonb_agg(jsonb_build_object('remind_on', r.remind_on, 'created_at', r.created_at, 'sent_at', r.sent_at,
                  'cancelled_at', r.cancelled_at) order by r.created_at)
                from plan_reminders r where r.user_id = v_user), '[]'),
    'report_capital', coalesce((select jsonb_agg(jsonb_build_object('report', r.id, 'capital', r.capital) order by r.created_at)
                from reports r where r.user_id = v_user and r.purged_at is null and r.capital is not null), '[]'),
    'founding_trader', (select u.founding_no from users u where u.id = v_user),
    'desk_settings', (select to_jsonb(s) - 'user_id' from desk_settings s where s.user_id = v_user)
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
