-- @file  db/migrations/0005_admin.sql
-- @area  Database
-- @what  Roles, events, error_events, support_tickets, costs (admin console).
-- Roles, product analytics, error center, support tickets and cost tracking for the admin console.
alter table public.users add column if not exists role text not null default 'user'
  check (role in ('user', 'owner', 'admin', 'support', 'finance', 'analyst'));
alter table public.payments add column if not exists plan_id text;

create table if not exists public.events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  name text not null check (char_length(name) <= 64),
  props jsonb,
  day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index if not exists events_day on public.events (day, name);
create index if not exists events_user on public.events (user_id, created_at desc);
-- one "active" row per user per day keeps DAU/MAU cheap
create unique index if not exists events_active_once on public.events (user_id, day) where name = 'active';

create table if not exists public.error_events (
  id bigserial primary key,
  fingerprint text not null,
  message text not null,
  stack text,
  source text not null check (source in ('server', 'client')),
  route text,
  user_id uuid references public.users(id) on delete set null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists error_events_fp on public.error_events (fingerprint, created_at desc);
create index if not exists error_events_user on public.error_events (user_id, created_at desc);

create table if not exists public.support_tickets (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  email citext not null,
  subject text not null,
  body text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_status on public.support_tickets (status, created_at desc);

create table if not exists public.costs (
  id bigserial primary key,
  month date not null,
  category text not null,               -- hosting, database, email, sms, marketing, tools, other
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'INR',
  note text,
  created_at timestamptz not null default now()
);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert on public.events, public.error_events to lens_app;
    grant select, insert, update on public.support_tickets, public.costs to lens_app;
    grant usage, select on sequence public.events_id_seq, public.error_events_id_seq, public.support_tickets_id_seq, public.costs_id_seq to lens_app;
    grant update (role) on public.users to lens_app;
  end if;
end $$;
