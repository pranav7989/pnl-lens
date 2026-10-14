-- @file  packages/db/migrations/0018_log_retention.sql
-- @area  Database
-- @what  Retention for logs (privacy policy draft): product/error events after 12 months, audit and file-access logs after 24 months.
-- ============================================================================
-- 0018 · Log retention (Phase 7; periods are LAWYER CHECK items in docs/legal)
-- purge_logs() runs in the worker's nightly job. The periods are parameters so a
-- change agreed with the lawyer needs no migration: the worker passes them from env.
-- Rows needed as proof are kept elsewhere: payments (billing law) and consents.
-- ============================================================================
create or replace function public.purge_logs(p_usage_months int default 12, p_audit_months int default 24)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare e int; er int; a int; f int;
begin
  if p_usage_months < 1 or p_audit_months < 1 then raise exception 'invalid_period' using errcode = 'P0001'; end if;
  delete from events where created_at < now() - make_interval(months => p_usage_months);
  get diagnostics e = row_count;
  delete from error_events where created_at < now() - make_interval(months => p_usage_months);
  get diagnostics er = row_count;
  delete from audit_log where created_at < now() - make_interval(months => p_audit_months);
  get diagnostics a = row_count;
  delete from file_access_log where created_at < now() - make_interval(months => p_audit_months);
  get diagnostics f = row_count;
  return jsonb_build_object('events', e, 'error_events', er, 'audit_log', a, 'file_access_log', f);
end $$;

revoke all on function public.purge_logs(int, int) from public;
grant execute on function public.purge_logs(int, int) to lens_worker;
