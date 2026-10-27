-- @file  packages/db/migrations/0023_credits_spec.sql
-- @area  Database
-- @what  Credits spec (19 Oct 2026): "+" refused once the report's plan window has ended; user_reports_left() = usable reports (active plans only).
--
-- Rule 4 / acceptance: after the plan window ends, usable reports show 0, old reports still open, and "+" on old
-- reports is refused. credits.balance is an internal mirror that never drops at expiry, so customer screens use
-- user_reports_left() instead (the word "credit" is internal only).

create or replace function public.add_analysis_to_report(p_user uuid, p_report uuid, p_analysis uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a     analyses%rowtype;
  v_r     reports%rowtype;
  v_files int;
  v_ends  timestamptz;
  v_set   record;
  v_used  text[];
  v_m     jsonb;
begin
  select * into v_a from analyses where id = p_analysis and user_id = p_user for update;
  if not found then raise exception 'analysis_not_found' using errcode = 'P0001'; end if;
  if v_a.claimed_at is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if v_a.target_report_id is distinct from p_report then raise exception 'analysis_targets_other_report' using errcode = 'P0001'; end if;
  if v_a.status <> 'ready' then raise exception 'analysis_not_ready' using errcode = 'P0001'; end if;
  if v_a.expires_at <= now() then raise exception 'analysis_expired' using errcode = 'P0001'; end if;

  select * into v_r from reports where id = p_report and user_id = p_user and purged_at is null for update;
  if not found then raise exception 'report_not_found' using errcode = 'P0001'; end if;
  select files_per_report, ends_at into v_files, v_ends from subscriptions where id = v_r.subscription_id;
  if v_files is null then raise exception 'report_locked' using errcode = 'P0001'; end if;   -- pre-v2 report: no plan link
  -- credits spec rule 3/4: "+" is free only while the report's plan window is open
  if v_ends <= now() then raise exception 'plan_expired' using errcode = 'P0001'; end if;

  select * into v_set from analysis_file_set(p_analysis);
  if v_a.file_count > v_files then raise exception 'too_many_files' using errcode = 'P0001'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_used from unnest(v_r.used_fingerprints || v_set.fingerprints) x;
  if cardinality(v_used) > v_files then raise exception 'report_files_full' using errcode = 'P0001'; end if;

  v_m := v_a.payload -> 'm';
  update reports
     set report = v_a.payload, analysis_id = p_analysis, engine_version = v_a.engine_version,
         file_names = v_set.names, file_hashes = v_set.hashes,
         market = v_m ->> 'market', currency = v_m ->> 'currency',
         trade_count = (v_m ->> 'n')::int, net_pnl_minor = round((v_m ->> 'net')::numeric * 100)::bigint,
         used_fingerprints = v_used, fingerprint = file_set_hash(v_set.fingerprints)
   where id = p_report;

  update analyses set report_id = p_report, claimed_at = now(), payload = null where id = p_analysis;

  insert into audit_log (user_id, action, meta)
  values (p_user, 'report_files_changed', jsonb_build_object('report_id', p_report, 'analysis_id', p_analysis,
          'files', cardinality(v_set.names), 'used', cardinality(v_used)));
  return p_report;
end $$;

-- usable reports right now: unused reports of plans whose window is open (expired plans lapse)
create or replace function public.user_reports_left(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(reports_total - reports_used, 0)), 0)::int
    from subscriptions where user_id = p_user and starts_at <= now() and ends_at > now()
$$;

revoke all on function public.add_analysis_to_report(uuid, uuid, uuid), public.user_reports_left(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant execute on function public.add_analysis_to_report(uuid, uuid, uuid), public.user_reports_left(uuid) to lens_app;
  end if;
end $$;
