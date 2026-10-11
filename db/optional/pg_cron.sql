-- @file  db/optional/pg_cron.sql
-- @area  Database
-- @what  Optional: schedule the purge inside Postgres if pg_cron is available.
-- OPTIONAL. Primary purge trigger is Amazon EventBridge Scheduler → POST /api/cron/purge (see infra/AWS.md).
-- Use this instead only if pg_cron is enabled on RDS: add `pg_cron` to shared_preload_libraries in the
-- DB parameter group, set cron.database_name, reboot, then run this file as the master user.
create extension if not exists pg_cron;
select cron.schedule('purge-expired-reports', '30 20 * * *', $$select public.purge_expired_reports();$$);  -- 02:00 IST
