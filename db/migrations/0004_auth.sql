-- @file  db/migrations/0004_auth.sql
-- @area  Database
-- @what  Email + Google sign-in columns; credits row created for every new user.
-- Auth v2: email one-time codes + Google sign-in. SMS/phone removed (global launch).
alter table public.users drop column if exists phone_e164;
alter table public.users drop column if exists phone_verified_at;
alter table public.users add column if not exists google_sub text unique;
alter table public.users add column if not exists name text;
alter table public.users alter column country drop default;
alter table public.users alter column country drop not null;

alter table public.otp_codes drop constraint if exists otp_codes_channel_check;
alter table public.otp_codes add constraint otp_codes_channel_check check (channel = 'email');
create index if not exists otp_codes_destination on public.otp_codes (destination, created_at desc);
create index if not exists otp_codes_ip on public.otp_codes (ip, created_at desc);

-- New users start with a zero-credit row so credit queries never miss.
create or replace function public.ensure_credits_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.credits (user_id, balance) values (new.id, 0) on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists users_ensure_credits on public.users;
create trigger users_ensure_credits after insert on public.users for each row execute function public.ensure_credits_row();
