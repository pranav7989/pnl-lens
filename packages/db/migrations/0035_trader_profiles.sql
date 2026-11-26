-- @file  packages/db/migrations/0035_trader_profiles.sql
-- @area  Database
-- @what  Trade Check foundation (architecture doc 24 Nov 2026, phase 1): per-trade features, the trader's pattern profile (baselines + segment patterns, versioned, swapped atomically), the worker's read of live reports' trades; cleared on account deletion and in "Export my data".
--
-- Built by the worker (job profile.rebuild) from the trades of the trader's live reports; the app only reads, and the
-- API always filters by the signed-in user. A rebuild writes a new profile_version and switches
-- trader_profiles.active_version in the same transaction, so a check never sees half a profile.

create table if not exists public.trader_profiles (
  user_id           uuid primary key references public.users(id) on delete cascade,
  active_version    int not null check (active_version > 0),
  built_at          timestamptz not null default now(),
  period_from       date,
  period_to         date,
  newest_trade      date,
  n_trades          int not null default 0,
  currency          text not null default 'INR' check (length(currency) between 1 and 8),   -- the trader's main currency (the profile uses those reports)
  source_report_ids uuid[] not null default '{}',
  unavailable       text[] not null default '{}'          -- features the trader's data can't give (e.g. time_bucket)
);

-- one row per stored trade (trades.id); features as of feature_version
create table if not exists public.trade_features (
  trade_id        bigint primary key references public.trades(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  underlying      text,
  instrument      text check (instrument is null or instrument in ('option', 'future', 'equity')),
  option_type     text check (option_type is null or option_type in ('CE', 'PE')),
  side            text check (side is null or side in ('buy', 'sell')),
  expiry_kind     text check (expiry_kind is null or expiry_kind in ('weekly', 'monthly')),
  dte             text check (dte is null or dte in ('0', '1', '2-4', '5+')),
  weekday         text check (weekday is null or weekday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  time_bucket     text check (time_bucket is null or time_bucket in ('open', 'mid', 'late')),
  size_ratio      text check (size_ratio is null or size_ratio in ('<=1x', '1-2x', '>2x')),
  session_seq     text check (session_seq is null or session_seq in ('1st', '2nd', '3rd+')),
  after_losses    text check (after_losses is null or after_losses in ('0', '1', '2+')),
  premium_bucket  text check (premium_bucket is null or premium_bucket in ('<50', '50-150', '>150')),
  feature_version text not null
);
create index if not exists trade_features_user on public.trade_features (user_id);

create table if not exists public.trader_baselines (
  user_id           uuid not null references public.users(id) on delete cascade,
  profile_version   int not null,
  n_trades          int not null,
  n_days            int not null,
  median_qty        numeric(20, 6),
  trades_per_day    numeric(12, 4),
  win_rate          numeric(8, 6),
  avg_pnl           numeric(20, 6),
  avg_abs_pnl       numeric(20, 6),
  period_from       date,
  period_to         date,
  source_report_ids uuid[] not null default '{}',
  primary key (user_id, profile_version)
);

create table if not exists public.trader_patterns (
  user_id            uuid not null references public.users(id) on delete cascade,
  profile_version    int not null,
  segment_key        text not null,
  dims               jsonb not null,
  n_trades           int not null,
  n_days             int not null,
  n_expiries         int,                                  -- distinct expiry days (dte = 0 segments)
  wins               int not null,
  win_days           int not null,                         -- days that ended in profit within the segment
  win_rate           numeric(8, 6) not null,
  wr_low             numeric(8, 6) not null,
  wr_high            numeric(8, 6) not null,
  total_pnl          numeric(20, 6) not null,
  expectancy         numeric(20, 6) not null,
  expectancy_low     numeric(20, 6),
  expectancy_high    numeric(20, 6),
  expectancy_shrunk  numeric(20, 6) not null,
  recency            numeric(8, 6) not null,               -- mean recency weight of the segment's trades (90-day half-life)
  score              numeric(20, 6) not null,
  shown              boolean not null,                      -- passes the minimum evidence (8 trades on 4 days)
  verdict            text not null check (verdict in ('weak', 'neutral', 'strong')),
  period_from        date,
  period_to          date,
  last_trade_at      date,
  primary key (user_id, profile_version, segment_key)
);

-- ---------------------------------------------------------------- the worker's read of a trader's live reports
-- The worker has no access to reports; this returns only what the profile needs: each live report's trades, with the
-- stored trade id (trades.seq = position in report.trades).
create or replace function public.profile_source_trades(p_user uuid)
returns table (report_id uuid, created_at timestamptz, currency text, trade_id bigint, trade jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, upper(coalesce(r.report->'m'->>'currency', r.currency, 'INR')), t.id, e.value
    from reports r
    cross join lateral jsonb_array_elements(coalesce(r.report->'trades', '[]'::jsonb)) with ordinality as e(value, ord)
    left join trades t on t.analysis_id = r.analysis_id and t.seq = e.ord - 1
   where r.user_id = p_user and r.purged_at is null and r.report is not null
   order by r.created_at, e.ord
$$;
revoke all on function public.profile_source_trades(uuid) from public;

-- users whose profile is missing or older than their newest live report (the nightly catch-up)
create or replace function public.profiles_due(p_limit int default 500)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select r.user_id from reports r
    left join trader_profiles p on p.user_id = r.user_id
   where r.purged_at is null and r.report is not null
   group by r.user_id, p.built_at
  having p.built_at is null or p.built_at < max(r.created_at)
  union
  select p.user_id from trader_profiles p
   where not exists (select 1 from reports r where r.user_id = p.user_id and r.purged_at is null and r.report is not null)
  limit p_limit
$$;
revoke all on function public.profiles_due(int) from public;

-- ---------------------------------------------------------------- privileges
revoke all on public.trader_profiles, public.trade_features, public.trader_baselines, public.trader_patterns from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then
    grant select, insert, update, delete on public.trader_profiles, public.trade_features, public.trader_baselines, public.trader_patterns to lens_worker;
    grant execute on function public.profile_source_trades(uuid), public.profiles_due(int) to lens_worker;
  end if;
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select on public.trader_profiles, public.trader_baselines, public.trader_patterns to lens_app;   -- read only; the API filters by user
  end if;
end $$;

-- ---------------------------------------------------------------- account deletion and export
create or replace function public.forget_profile_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from trade_features where user_id = new.id;
  delete from trader_patterns where user_id = new.id;
  delete from trader_baselines where user_id = new.id;
  delete from trader_profiles where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_profile_on_account_delete() from public;
drop trigger if exists users_forget_profile on public.users;
create trigger users_forget_profile after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_profile_on_account_delete();

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
    'desk_settings', (select to_jsonb(s) - 'user_id' from desk_settings s where s.user_id = v_user),
    'trade_check_profile', (select jsonb_build_object(
        'built_at', p.built_at, 'version', p.active_version, 'period_from', p.period_from, 'period_to', p.period_to,
        'baseline', (select to_jsonb(b) - 'user_id' from trader_baselines b where b.user_id = v_user and b.profile_version = p.active_version),
        'patterns', coalesce((select jsonb_agg(jsonb_build_object('segment', t.segment_key, 'trades', t.n_trades, 'days', t.n_days, 'win_rate', t.win_rate,
                      'total_pnl', t.total_pnl, 'verdict', t.verdict) order by t.segment_key)
                    from trader_patterns t where t.user_id = v_user and t.profile_version = p.active_version and t.shown), '[]'))
      from trader_profiles p where p.user_id = v_user)
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
