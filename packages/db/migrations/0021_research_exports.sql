-- @file  packages/db/migrations/0021_research_exports.sql
-- @area  Database
-- @what  Research datasets every 15 days: research_exports records, and read access for the worker to the pseudonymised research views (0014) only.
--
-- Owner request (19 Oct 2026): a dataset for future model training, built on the 1st and 16th of each month and
-- downloaded by the owner from the admin console. Only users whose CURRENT research consent is yes are included —
-- the research views (0014) already filter on that and replace the user id with an HMAC pseudonym. This is the
-- separately approved step 0014 anticipated; lens_research stays NOLOGIN, and the worker gets no access to
-- research.consenting_users (real user ids) or research.pseudonym_key.

create table if not exists public.research_exports (
  id           uuid primary key default gen_random_uuid(),
  requested_by uuid references public.users(id) on delete set null,          -- null = the schedule
  status       text not null default 'pending' check (status in ('pending', 'building', 'ready', 'failed')),
  subjects     int, reports int, trades int,
  storage_key  text, enc_key_id text, wrapped_dek bytea, iv bytea, size_bytes bigint,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  expires_at   timestamptz,
  deleted_at   timestamptz
);
-- one build at a time
create unique index if not exists research_exports_one_running on public.research_exports ((true)) where status in ('pending', 'building');
create index if not exists research_exports_created on public.research_exports (created_at desc);

revoke all on public.research_exports from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select on public.research_exports to lens_app;
    grant insert (requested_by) on public.research_exports to lens_app;          -- "Build now" (owner, checked in the API)
  end if;
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then
    grant select, insert, update on public.research_exports to lens_worker;
    grant usage on schema research to lens_worker;
    grant select on research.subjects, research.trades, research.report_metrics, research.report_traits to lens_worker;
  end if;
end $$;
