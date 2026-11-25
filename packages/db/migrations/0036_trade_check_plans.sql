-- @file  packages/db/migrations/0036_trade_check_plans.sql
-- @area  Database
-- @what  Trade Check phase 2 (architecture doc §5, §8): the trader's own rules, the day's trade plan and its typed lines (parsed, features, check result, decision: edited / removed / kept with a reason), the pre-trade checklist, chips shown and acted on; the trader's usual size per instrument on the profile; all per user, cleared on account deletion, in "Export my data".
--
-- Everything here is the trader's own: the API always filters by the signed-in user and writes only their rows.
-- check_result is what the API's check() returned (same pure function as the browser), with its check_version.

alter table public.trader_profiles add column if not exists usual_qty jsonb not null default '{}';   -- "UNDERLYING|instrument" -> median quantity

create table if not exists public.trader_rules (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in ('max_trades_day', 'max_daily_loss', 'stop_after_losses', 'max_lots', 'no_segment', 'time_window')),
  params      jsonb not null,
  source      text not null check (source in ('plan', 'manual', 'suggested')),
  suggestion  text,                                   -- what it was suggested from (segment key or 30-day plan rule id): never suggested twice
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists trader_rules_user on public.trader_rules (user_id, active);
create unique index if not exists trader_rules_one_suggestion on public.trader_rules (user_id, suggestion) where suggestion is not null;

create table if not exists public.trade_plans (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  plan_date  date not null,
  created_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create table if not exists public.trade_plan_lines (
  id            bigserial primary key,
  plan_id       bigint not null references public.trade_plans(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  position      int not null,
  raw_text      text not null check (length(raw_text) between 1 and 300),
  input         text not null default 'typed' check (input in ('typed', 'voice')),
  parsed        jsonb not null,
  features      jsonb not null,
  check_result  jsonb not null,
  check_version text not null,
  decision      text check (decision is null or decision in ('edited', 'removed', 'kept')),
  keep_reason   text check (keep_reason is null or length(keep_reason) between 3 and 300),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint trade_plan_lines_keep_reason check (decision is distinct from 'kept' or keep_reason is not null)
);
create index if not exists trade_plan_lines_plan on public.trade_plan_lines (plan_id, position);

create table if not exists public.plan_checklist (
  user_id    uuid not null references public.users(id) on delete cascade,
  plan_date  date not null,
  items      jsonb not null,                          -- [{ text, done }]
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_date)
);

create table if not exists public.insight_events (
  id        bigserial primary key,
  user_id   uuid not null references public.users(id) on delete cascade,
  line_id   bigint references public.trade_plan_lines(id) on delete cascade,
  chip_key  text not null,                            -- rule:<id> | history:<segment key> | info:<name>
  shown_at  timestamptz not null default now(),
  action    text check (action is null or action in ('edited', 'removed', 'kept'))
);
create index if not exists insight_events_user on public.insight_events (user_id, shown_at);

-- ---------------------------------------------------------------- privileges
revoke all on public.trader_rules, public.trade_plans, public.trade_plan_lines, public.plan_checklist, public.insight_events from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert, update on public.trader_rules, public.trade_plans, public.trade_plan_lines, public.plan_checklist to lens_app;
    grant select, insert, update on public.insight_events to lens_app;
    grant usage on sequence public.trader_rules_id_seq, public.trade_plans_id_seq, public.trade_plan_lines_id_seq, public.insight_events_id_seq to lens_app;
  end if;
end $$;

-- ---------------------------------------------------------------- account deletion and export
create or replace function public.forget_trade_check_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from insight_events where user_id = new.id;
  delete from trade_plan_lines where user_id = new.id;
  delete from trade_plans where user_id = new.id;
  delete from plan_checklist where user_id = new.id;
  delete from trader_rules where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_trade_check_on_account_delete() from public;
drop trigger if exists users_forget_trade_check on public.users;
create trigger users_forget_trade_check after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_trade_check_on_account_delete();

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
      from trader_profiles p where p.user_id = v_user),
    'trade_check_rules', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'params', r.params, 'source', r.source, 'active', r.active,
                  'created_at', r.created_at) order by r.created_at)
                from trader_rules r where r.user_id = v_user), '[]'),
    'trade_plans', coalesce((select jsonb_agg(jsonb_build_object('date', p.plan_date,
                  'lines', coalesce((select jsonb_agg(jsonb_build_object('text', l.raw_text, 'parsed', l.parsed, 'checks', l.check_result, 'decision', l.decision,
                                'keep_reason', l.keep_reason, 'created_at', l.created_at) order by l.position)
                              from trade_plan_lines l where l.plan_id = p.id), '[]'),
                  'checklist', (select c.items from plan_checklist c where c.user_id = v_user and c.plan_date = p.plan_date)) order by p.plan_date)
                from trade_plans p where p.user_id = v_user), '[]')
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
