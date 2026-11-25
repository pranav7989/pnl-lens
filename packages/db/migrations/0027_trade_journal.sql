-- @file  packages/db/migrations/0027_trade_journal.sql
-- @area  Database
-- @what  Trade journal: the user's own setup, tags, emotion and note per trade (keyed by the trade's identity, so a note follows the trade into every report); private (never in research); in "Export my data"; removed with the account.
--
-- trade_key is packages/shared/src/insights/lifetime.ts tradeKey(): symbol | dates | entry hour | qty | buy | sell | P&L.
-- The journal is the user's own writing about their trades: it is never part of the research views (0014) or the
-- research datasets (0021). export_user_data() now also returns the journal, the saved 30-day plans and the
-- check-up reminder: the 0017 function is kept as export_user_data_base() and wrapped (no copy of its body).

create table if not exists public.trade_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  trade_key  text not null check (char_length(trade_key) between 3 and 300),
  setup      text check (setup is null or char_length(setup) <= 60),
  tags       text[] not null default '{}' check (cardinality(tags) <= 8),
  emotion    text check (emotion is null or emotion in ('calm', 'confident', 'fomo', 'fear', 'revenge', 'bored', 'tired', 'greedy')),
  note       text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trade_key)
);
revoke all on public.trade_notes from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert, delete on public.trade_notes to lens_app;
    grant update (setup, tags, emotion, note, updated_at) on public.trade_notes to lens_app;
  end if;
end $$;

-- account deletion anonymises the user row (0013), so remove the journal explicitly
create or replace function public.forget_journal_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from trade_notes where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_journal_on_account_delete() from public;
drop trigger if exists users_forget_journal on public.users;
create trigger users_forget_journal after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_journal_on_account_delete();

-- "Export my data": keep the 0017 function as the base and add the newer personal data on top
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'export_user_data_base' and pronamespace = 'public'::regnamespace) then
    alter function public.export_user_data(uuid) rename to export_user_data_base;
  end if;
end $$;
revoke all on function public.export_user_data_base(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then revoke execute on function public.export_user_data_base(uuid) from lens_worker; end if;
end $$;

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
                from plan_reminders r where r.user_id = v_user), '[]')
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
