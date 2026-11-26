-- @file  packages/db/migrations/0032_founding_traders.sql
-- @area  Database
-- @what  Founding traders (share card v2): users.founding_no 1–1000, given once on a user's first paid plan (or a manual grant the owner marks as founding), never to staff or test accounts; users.is_test; a gap-free counter.
--
-- Numbers come from a one-row counter updated inside the granting transaction, so a rolled-back grant leaves no gap
-- (a sequence would). A number is never reassigned: account deletion keeps it on the anonymised row. Only the
-- owner can reset numbers, and only before the first paid order (packages/db/scripts/reset-founding.mjs).

alter table public.users add column if not exists founding_no int unique check (founding_no between 1 and 1000);
alter table public.users add column if not exists is_test boolean not null default false;

-- lens_app has table-wide UPDATE on users (0002), so a column revoke would not hold: the app roles may never change
-- these two columns themselves. The SECURITY DEFINER functions below run as the owner and pass.
create or replace function public.guard_founding_columns() returns trigger language plpgsql as $$
begin
  if (case when tg_op = 'INSERT' then new.founding_no is not null or new.is_test
           else new.founding_no is distinct from old.founding_no or new.is_test is distinct from old.is_test end)
     and current_user in ('lens_app', 'lens_worker', 'lens_research') then
    raise exception 'founding columns are set by the database only' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_founding_columns on public.users;
create trigger guard_founding_columns before insert or update on public.users
  for each row execute function public.guard_founding_columns();

create table if not exists public.founding_counter (
  id   boolean primary key default true check (id),
  last int not null default 0 check (last between 0 and 1000)
);
insert into public.founding_counter (id, last) values (true, 0) on conflict (id) do nothing;
revoke all on public.founding_counter from public;

-- Gives the user the next number if they qualify; returns their number (old or new) or null.
create or replace function public.assign_founding_no(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_user users%rowtype; v_no int;
begin
  select * into v_user from users where id = p_user for update;
  if not found then return null; end if;
  if v_user.founding_no is not null then return v_user.founding_no; end if;
  if v_user.role <> 'user' or v_user.is_test or v_user.status <> 'active' then return null; end if;
  update founding_counter set last = last + 1 where id and last < 1000 returning last into v_no;
  if v_no is null then return null; end if;                                  -- all 1000 given
  update users set founding_no = v_no where id = p_user;
  insert into audit_log (user_id, action, meta) values (p_user, 'founding_no_assigned', jsonb_build_object('no', v_no));
  return v_no;
end $$;
revoke all on function public.assign_founding_no(uuid) from public;

-- Paid plans (the verified webhook's grant_plan) always qualify.
create or replace function public.founding_on_paid_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_id is not null then perform assign_founding_no(new.user_id); end if;
  return new;
end $$;
drop trigger if exists founding_on_paid_plan on public.subscriptions;
create trigger founding_on_paid_plan after insert on public.subscriptions
  for each row execute function public.founding_on_paid_plan();

-- Manual grant (D5) that the owner marks as founding: same checks as admin_grant_plan, then a number.
create or replace function public.admin_grant_plan(p_actor uuid, p_user uuid, p_plan text, p_reports int,
                                                   p_files int, p_days int, p_reason text, p_founding boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := admin_grant_plan(p_actor, p_user, p_plan, p_reports, p_files, p_days, p_reason);
  if p_founding then perform assign_founding_no(p_user); end if;
  return v_id;
end $$;
revoke all on function public.admin_grant_plan(uuid, uuid, text, int, int, int, text, boolean) from public;

-- Owner marks or unmarks a test account (never gets a founding number). Audited.
create or replace function public.admin_set_test_account(p_actor uuid, p_user uuid, p_is_test boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = p_actor and role = 'owner' and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update users set is_test = p_is_test where id = p_user;
  if not found then raise exception 'unknown_user' using errcode = 'P0001'; end if;
  insert into audit_log (user_id, action, meta) values (p_user, 'test_account_set', jsonb_build_object('actor', p_actor, 'is_test', p_is_test));
end $$;
revoke all on function public.admin_set_test_account(uuid, uuid, boolean) from public;

-- Before launch only: clear every founding number and restart at 1 (testers got numbers during testing). Refused
-- once any order is paid, so a paying trader's number is never taken back. Not granted to any app role: run by
-- the database owner through packages/db/scripts/reset-founding.mjs.
create or replace function public.reset_founding_numbers() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if exists (select 1 from payments where status = 'paid') then
    raise exception 'paid_orders_exist' using errcode = 'P0001';
  end if;
  perform 1 from founding_counter where id for update;
  update users set founding_no = null where founding_no is not null;
  get diagnostics v_n = row_count;
  update founding_counter set last = 0 where id;
  insert into audit_log (user_id, action, meta) values (null, 'founding_numbers_reset', jsonb_build_object('cleared', v_n));
  return v_n;
end $$;
revoke all on function public.reset_founding_numbers() from public;

-- "Export my data" also includes the founding trader number (same wrapper as 0028, one more key).
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
    'founding_trader', (select u.founding_no from users u where u.id = v_user)
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant execute on function public.admin_grant_plan(uuid, uuid, text, int, int, int, text, boolean) to lens_app;
    grant execute on function public.admin_set_test_account(uuid, uuid, boolean) to lens_app;
  end if;
end $$;
