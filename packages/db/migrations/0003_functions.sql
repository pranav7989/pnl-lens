-- @file  packages/db/migrations/0003_functions.sql
-- @area  Database
-- @what  create_report_with_credit(), purge_expired_reports(), delete_report().
-- Atomic: consume one credit and insert the report. Returns the new report id,
-- or raises 'no_credits' (SQLSTATE P0001) if the balance is zero.
create or replace function public.create_report_with_credit(
  p_user_id      uuid,
  p_report       jsonb,
  p_file_names   text[],
  p_file_hashes  text[],
  p_market       text,
  p_currency     char(3),
  p_trade_count  int,
  p_net_minor    bigint,
  p_ttl_days     int default 30
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payment uuid;
begin
  update public.credits
     set balance = balance - 1, updated_at = now()
   where user_id = p_user_id and balance > 0;
  if not found then
    raise exception 'no_credits' using errcode = 'P0001';
  end if;

  select id into v_payment
    from public.payments
   where user_id = p_user_id and status = 'paid'
   order by paid_at desc nulls last
   limit 1;

  insert into public.reports (user_id, payment_id, report, file_names, file_hashes, market, currency,
                              trade_count, net_pnl_minor, expires_at)
  values (p_user_id, v_payment, p_report, p_file_names, p_file_hashes, p_market, p_currency,
          p_trade_count, p_net_minor, now() + make_interval(days => p_ttl_days))
  returning id into v_id;

  insert into public.audit_log (user_id, action, meta)
  values (p_user_id, 'report_created', jsonb_build_object('report_id', v_id, 'trades', p_trade_count));

  return v_id;
end;
$$;

-- Null out expired payloads. Keeps the row for billing history.
create or replace function public.purge_expired_reports() returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  with purged as (
    update public.reports
       set report = null, file_names = array['[purged]'], purged_at = now()
     where expires_at < now() and purged_at is null
    returning user_id, id
  )
  insert into public.audit_log (user_id, action, meta)
  select user_id, 'report_purged', jsonb_build_object('report_id', id) from purged;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- User-initiated delete: hard-null immediately.
create or replace function public.delete_report(p_user_id uuid, p_report_id uuid) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reports
     set report = null, file_names = array['[deleted]'], purged_at = now()
   where id = p_report_id and user_id = p_user_id and purged_at is null;
  if not found then return false; end if;
  insert into public.audit_log (user_id, action, meta)
  values (p_user_id, 'report_deleted', jsonb_build_object('report_id', p_report_id));
  return true;
end;
$$;

revoke all on function public.create_report_with_credit from public;
revoke all on function public.purge_expired_reports      from public;
revoke all on function public.delete_report              from public;
grant execute on function public.create_report_with_credit(uuid, jsonb, text[], text[], text, char, int, bigint, int) to lens_app;
grant execute on function public.purge_expired_reports() to lens_app;
grant execute on function public.delete_report(uuid, uuid) to lens_app;
