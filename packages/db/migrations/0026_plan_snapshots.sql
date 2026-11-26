-- @file  packages/db/migrations/0026_plan_snapshots.sql
-- @area  Database
-- @what  The 30-day plan as it was given to the user (rules, metrics, targets), kept so the next report can score it (check-up: Met / Missed per rule).
--
-- Written when the plan PDF is downloaded (one row per user, report and IST day: the plan is deterministic for that
-- day). The next report scores the newest snapshot made before it (packages/shared/src/plan/score.ts). Holds only
-- the plan's own text and numbers from the user's report; removed with the account.

create table if not exists public.plan_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  report_id    uuid references public.reports(id) on delete set null,
  generated_on date not null,
  checkup_on   date not null,
  plan         jsonb not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists plan_snapshots_one_a_day on public.plan_snapshots (user_id, report_id, generated_on);
create index if not exists plan_snapshots_user on public.plan_snapshots (user_id, generated_on desc);

revoke all on public.plan_snapshots from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert on public.plan_snapshots to lens_app;
  end if;
end $$;

-- delete_account() (0013) anonymises the user row instead of deleting it, so the foreign keys do not cascade:
-- remove the plan snapshots and check-up reminders (0024) when an account is closed.
create or replace function public.forget_plans_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from plan_snapshots where user_id = new.id;
  delete from plan_reminders where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_plans_on_account_delete() from public;
drop trigger if exists users_forget_plans on public.users;
create trigger users_forget_plans after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_plans_on_account_delete();
