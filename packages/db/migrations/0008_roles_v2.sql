-- @file  packages/db/migrations/0008_roles_v2.sql
-- @area  Database
-- @what  Backend v2 roles: lens_worker (job worker) and lens_research (no login, for later). Base grants only.
-- ============================================================================
-- 0008 · Roles for backend v2 (plan §7 "Roles")
--   lens_app      : api / web (0002). Unchanged here.
--   lens_worker   : apps/worker. Table grants are added by each later migration,
--                   next to the table they cover. Nothing on users, payments or credits.
--   lens_research : nobody yet. NOLOGIN until a separately approved future phase.
-- Passwords are never in SQL: infra runs packages/db/scripts/setup-roles.mjs after
-- migrations, which turns on LOGIN for lens_app / lens_worker with passwords from env.
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lens_worker') then
    create role lens_worker nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'lens_research') then
    create role lens_research nologin;
  end if;
end $$;

-- lens_research must never log in, even if someone adds a password by mistake.
alter role lens_research nologin;

grant usage on schema public to lens_worker;

-- The worker reports its own failures to the admin console's Errors tab.
grant insert on public.error_events to lens_worker;
grant usage on sequence public.error_events_id_seq to lens_worker;
