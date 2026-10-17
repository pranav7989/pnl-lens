-- @file  packages/db/migrations/0011_consents.sql
-- @area  Database
-- @what  Append-only consent history (processing / research), current-consent view, and data export/delete requests.
-- ============================================================================
-- 0011 · Consents and data requests (plan §10, D2; data_requests per D15)
--   consents      : never updated. The latest row per (user, purpose) wins.
--                   Research has no row by default, which means OFF (rule 7).
--                   Withdrawing = appending a row with granted = false.
--   data_requests : "export my data" / "delete my account" requests and their status.
-- ============================================================================

create table if not exists public.consents (
  id             bigserial primary key,
  user_id        uuid not null references public.users(id) on delete cascade,
  purpose        text not null check (purpose in ('processing', 'research')),
  granted        boolean not null,
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  text_sha256    text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),   -- hash of the exact wording shown
  ip_hash        text,                                                    -- HMAC of the IP, never the raw IP
  user_agent     text check (user_agent is null or char_length(user_agent) <= 400),
  created_at     timestamptz not null default now()
);
-- latest row per user and purpose
create index if not exists consents_latest on public.consents (user_id, purpose, created_at desc, id desc);

create or replace view public.user_consent_current with (security_invoker = true) as
  select distinct on (user_id, purpose)
         user_id, purpose, granted, policy_version, created_at
    from public.consents
   order by user_id, purpose, created_at desc, id desc;

create table if not exists public.data_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null check (kind in ('export', 'delete')),
  status       text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  result_key   text,                 -- storage key of the export archive (exports only)
  error_code   text,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  expires_at   timestamptz           -- when the export archive is removed
);
-- the user's own requests; the worker's queue of open requests
create index if not exists data_requests_user on public.data_requests (user_id, requested_at desc);
create index if not exists data_requests_open on public.data_requests (status, requested_at) where status in ('pending', 'processing');
-- at most one open request of each kind per user
create unique index if not exists data_requests_one_open on public.data_requests (user_id, kind) where status in ('pending', 'processing');

-- ---- grants -----------------------------------------------------------------
grant select, insert on public.consents, public.data_requests to lens_app;
grant select on public.user_consent_current to lens_app;
grant usage on sequence public.consents_id_seq to lens_app;
grant select on public.data_requests to lens_worker;
grant update (status, result_key, error_code, started_at, completed_at, expires_at) on public.data_requests to lens_worker;
