-- @file  packages/db/migrations/0037_plan_actuals.sql
-- @area  Database
-- @what  Trade Check phase 3, "actuals" (architecture doc §8.6–8.7): per plan line taken or not with its result (by the trader, or matched from their next tradebook), trades taken that were not in the plan (journal), and each day's plan-vs-actual score; cleared on account deletion, in "Export my data".
--
-- The trader marks lines on the Desk (owner decision, 25 Nov 2026). When a tradebook arrives, the worker matches lines
-- to its trades by instrument, date and side (job profile.rebuild) and fills matched_trade_ids / matched_pnl; a
-- matched result wins over a typed one. Scores are recomputed whenever the day changes.

create table if not exists public.plan_outcomes (
  line_id           bigint primary key references public.trade_plan_lines(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  taken             boolean,                               -- null = not said yet
  manual_pnl        numeric(20, 6),                        -- the result the trader typed
  matched_trade_ids bigint[] not null default '{}',        -- trades.id from their tradebook
  matched_pnl       numeric(20, 6),
  matched_at        timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists plan_outcomes_user on public.plan_outcomes (user_id);

-- trades the trader took that were not in the day's plan (their journal of the day)
create table if not exists public.journal_trades (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  plan_date  date not null,
  raw_text   text not null check (length(raw_text) between 1 and 300),
  parsed     jsonb not null,
  pnl        numeric(20, 6),
  created_at timestamptz not null default now()
);
create index if not exists journal_trades_day on public.journal_trades (user_id, plan_date);

create table if not exists public.plan_day_scores (
  user_id        uuid not null references public.users(id) on delete cascade,
  plan_date      date not null,
  planned        int not null,
  taken          int not null,
  not_taken      int not null,
  unmarked       int not null,
  off_plan       int not null,
  on_plan_pnl    numeric(20, 6) not null,
  off_plan_pnl   numeric(20, 6) not null,
  rules_kept     int not null,                           -- taken lines that broke none of the trader's rules
  rules_total    int not null,                           -- taken lines
  source         text not null check (source in ('journal', 'tradebook')),
  scored_at      timestamptz not null default now(),
  primary key (user_id, plan_date)
);

-- ---------------------------------------------------------------- privileges
revoke all on public.plan_outcomes, public.journal_trades, public.plan_day_scores from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert, update on public.plan_outcomes, public.plan_day_scores to lens_app;
    grant select, insert, delete on public.journal_trades to lens_app;          -- the trader may remove a journal entry
    grant usage on sequence public.journal_trades_id_seq to lens_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then
    -- matching a new tradebook to the trader's plan lines
    grant select on public.trade_plans, public.trade_plan_lines, public.journal_trades to lens_worker;
    grant select, insert, update on public.plan_outcomes, public.plan_day_scores to lens_worker;
  end if;
end $$;

-- ---------------------------------------------------------------- account deletion and export
create or replace function public.forget_actuals_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from plan_outcomes where user_id = new.id;
  delete from journal_trades where user_id = new.id;
  delete from plan_day_scores where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_actuals_on_account_delete() from public;
drop trigger if exists users_forget_actuals on public.users;
create trigger users_forget_actuals after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_actuals_on_account_delete();

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
                                'keep_reason', l.keep_reason, 'created_at', l.created_at,
                                'outcome', (select jsonb_build_object('taken', o.taken, 'result', o.manual_pnl, 'matched_result', o.matched_pnl)
                                              from plan_outcomes o where o.line_id = l.id)) order by l.position)
                              from trade_plan_lines l where l.plan_id = p.id), '[]'),
                  'checklist', (select c.items from plan_checklist c where c.user_id = v_user and c.plan_date = p.plan_date),
                  'score', (select to_jsonb(s) - 'user_id' - 'plan_date' from plan_day_scores s where s.user_id = v_user and s.plan_date = p.plan_date)) order by p.plan_date)
                from trade_plans p where p.user_id = v_user), '[]'),
    'journal_trades', coalesce((select jsonb_agg(jsonb_build_object('date', j.plan_date, 'text', j.raw_text, 'result', j.pnl, 'created_at', j.created_at) order by j.created_at)
                from journal_trades j where j.user_id = v_user), '[]')
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
