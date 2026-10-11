-- @file  packages/db/migrations/0002_app_role.sql
-- @area  Database
-- @what  Least-privilege lens_app role (no DELETE, no DDL).
-- Least-privilege role the web app connects as. The browser never talks to the database,
-- so access control lives here (grants) and in the API routes (every query is scoped by user_id).
-- After this migration, an admin sets the login password once:
--   alter role lens_app login password '<from Secrets Manager>';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lens_app') then
    create role lens_app nologin;
  end if;
end $$;

grant usage on schema public to lens_app;
grant select, insert, update on public.users, public.otp_codes, public.payments, public.credits, public.reports to lens_app;
grant insert on public.audit_log to lens_app;
grant usage, select on all sequences in schema public to lens_app;
-- No DELETE and no DDL: report removal goes through delete_report()/purge_expired_reports(),
-- which null the payload and keep the row for billing history.
