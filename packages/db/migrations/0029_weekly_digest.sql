-- @file  packages/db/migrations/0029_weekly_digest.sql
-- @area  Database
-- @what  Weekly summary email (analysis roadmap B5): an opt-in flag per user (off by default) and one row per user and week, claimed before sending so the email goes out at most once a week.
--
-- users.weekly_digest is the user's own choice (Dashboard → Your data, or the unsubscribe link in each email).
-- digest_sends records which weeks were sent (week = the Monday, IST); the api inserts the row first and sends
-- only if the insert succeeded. Removed with the account (users row is anonymised; the trigger clears both).

alter table public.users add column if not exists weekly_digest boolean not null default false;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant update (weekly_digest) on public.users to lens_app;
  end if;
end $$;

create table if not exists public.digest_sends (
  user_id    uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, week_start)
);
revoke all on public.digest_sends from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert on public.digest_sends to lens_app;
  end if;
end $$;

create or replace function public.forget_digest_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update users set weekly_digest = false where id = new.id;
  delete from digest_sends where user_id = new.id;
  return new;
end $$;
revoke all on function public.forget_digest_on_account_delete() from public;
drop trigger if exists users_forget_digest on public.users;
create trigger users_forget_digest after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.forget_digest_on_account_delete();
