-- @file  packages/db/migrations/0001_schema.sql
-- @area  Database
-- @what  Core tables: users, otp_codes, payments, credits, reports, audit_log.
-- PnL Lens — core schema
create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.users (
  id                uuid primary key default gen_random_uuid(),
  email             citext unique not null,
  phone_e164        text unique,
  country           char(2) not null default 'IN',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  created_at        timestamptz not null default now(),
  last_login_at     timestamptz,
  status            text not null default 'active' check (status in ('active', 'blocked'))
);

create table if not exists public.otp_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  channel     text not null check (channel in ('email', 'sms')),
  destination text not null,
  code_hash   text not null,
  purpose     text not null check (purpose in ('signup', 'login')),
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index if not exists otp_codes_lookup on public.otp_codes (user_id, channel, created_at desc);

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id),
  gateway            text not null default 'razorpay',
  gateway_order_id   text unique not null,
  gateway_payment_id text unique,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null,
  status             text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  credits_granted    int not null default 1,
  raw_payload        jsonb,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index if not exists payments_user on public.payments (user_id, created_at desc);

create table if not exists public.credits (
  user_id    uuid primary key references public.users(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  payment_id    uuid references public.payments(id),
  report        jsonb,
  file_names    text[] not null,
  file_hashes   text[] not null,
  market        text,
  currency      char(3),
  trade_count   int,
  net_pnl_minor bigint,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  purged_at     timestamptz,
  constraint reports_files_max3 check (cardinality(file_names) between 1 and 3)
);
create index if not exists reports_user on public.reports (user_id, created_at desc);
create index if not exists reports_expiry on public.reports (expires_at) where purged_at is null;

create table if not exists public.audit_log (
  id         bigserial primary key,
  user_id    uuid,
  action     text not null,
  meta       jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists audit_user on public.audit_log (user_id, created_at desc);
