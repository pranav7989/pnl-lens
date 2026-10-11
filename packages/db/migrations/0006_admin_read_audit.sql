-- @file  packages/db/migrations/0006_admin_read_audit.sql
-- @area  Database
-- @what  Lets the app read the audit log for the support timeline.
-- The admin console's user timeline reads the audit log (still no UPDATE/DELETE for the app role).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select on public.audit_log to lens_app;
  end if;
end $$;
