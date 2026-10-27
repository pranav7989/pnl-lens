-- @file  packages/db/migrations/0020_passwords.sql
-- @area  Database
-- @what  Email + password sign-in: password hash (scrypt), lockout counters, and sessions_valid_after (a password change signs out other devices).
--
-- The first sign-in with an email proves the address with a one-time code; the user then sets a password and signs
-- in with it from then on (codes only for "Forgot password"). The hash is never returned by the API or the data export
-- (export_user_data lists account fields explicitly). Deleting an account clears all of it (trigger below).

alter table public.users add column if not exists password_hash text
  check (password_hash is null or password_hash like 'scrypt$%');
alter table public.users add column if not exists password_set_at timestamptz;
alter table public.users add column if not exists password_failed int not null default 0;
alter table public.users add column if not exists password_locked_until timestamptz;
alter table public.users add column if not exists sessions_valid_after timestamptz;

-- delete_account() (0013) marks the row deleted; also drop the password and end every session
create or replace function public.users_clear_password_on_delete() returns trigger
language plpgsql as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    new.password_hash := null; new.password_set_at := null; new.password_failed := 0; new.password_locked_until := null;
    new.sessions_valid_after := now();
  end if;
  return new;
end $$;
drop trigger if exists users_clear_password_on_delete on public.users;
create trigger users_clear_password_on_delete before update of status on public.users
  for each row execute function public.users_clear_password_on_delete();
