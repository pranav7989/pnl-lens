-- @file  packages/db/migrations/0012_plans_v2.sql
-- @area  Database
-- @what  Server-side plan enforcement: create_report_from_analysis(), add_analysis_to_report() (file-set lock), owner-only admin_grant_plan().
-- ============================================================================
-- 0012 · Plans v2 (plan §9, rules 5 and 6, D4, D5, D6)
--   create_report_from_analysis : turns a finished analysis into a report and
--       spends one report from a valid plan. Checks validity (ends_at), allowance
--       (reports_used < reports_total) and statements per report. Balance-only
--       credits do not count (D6). Reports never expire (D4: expires_at = infinity).
--   add_analysis_to_report : the "+" button. Replaces a report's content with a new
--       analysis over old + new files. Spends nothing. Enforces the file-set lock:
--       at most files_per_report distinct statements ever, removal never frees a place.
--   admin_grant_plan : approved exception to rule 6 (D5). Owner role re-checked in
--       the DB, reason required, written to audit_log.
-- Plans are otherwise granted only by grant_plan() (0007) from the verified webhook.
-- Errors are raised as SQLSTATE P0001 with a short code as the message; the API maps
-- each code to the existing user-facing text.
-- ============================================================================

alter table public.subscriptions add column if not exists granted_by   uuid references public.users(id);
alter table public.subscriptions add column if not exists grant_reason text;
-- every plan has a source: a payment (webhook) or a recorded manual reason
alter table public.subscriptions drop constraint if exists subscriptions_has_source;
alter table public.subscriptions add constraint subscriptions_has_source
  check (payment_id is not null or (grant_reason is not null and char_length(btrim(grant_reason)) > 0));

-- ---- helpers ------------------------------------------------------------------
-- Files of an analysis in upload order, with the fingerprint used by the file-set lock
-- (falls back to the content hash until the worker has set a trade fingerprint).
create or replace function public.analysis_file_set(p_analysis uuid)
returns table (names text[], hashes text[], fingerprints text[])
language sql stable security definer set search_path = public as $$
  select array_agg(f.original_name order by af.position),
         array_agg(f.sha256 order by af.position),
         coalesce(array_agg(distinct coalesce(f.fingerprint, 'sha:' || f.sha256)), '{}')
    from analysis_files af join statement_files f on f.id = af.file_id
   where af.analysis_id = p_analysis
$$;

create or replace function public.file_set_hash(p_fingerprints text[])
returns text language sql immutable set search_path = public as $$
  select encode(digest(coalesce((select string_agg(x, E'\n' order by x) from unnest(p_fingerprints) x), ''), 'sha256'), 'hex')
$$;

-- ---- create_report_from_analysis -------------------------------------------------
create or replace function public.create_report_from_analysis(p_user uuid, p_analysis uuid, p_title text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a   analyses%rowtype;
  v_s   subscriptions%rowtype;
  v_set record;
  v_id  uuid;
  v_m   jsonb;
begin
  if exists (select 1 from users where id = p_user and status <> 'active') then
    raise exception 'user_blocked' using errcode = 'P0001';
  end if;

  select * into v_a from analyses where id = p_analysis and user_id = p_user for update;
  if not found then raise exception 'analysis_not_found' using errcode = 'P0001'; end if;
  if v_a.claimed_at is not null then raise exception 'already_claimed' using errcode = 'P0001'; end if;
  if v_a.target_report_id is not null then raise exception 'analysis_targets_report' using errcode = 'P0001'; end if;
  if v_a.status <> 'ready' then raise exception 'analysis_not_ready' using errcode = 'P0001'; end if;
  if v_a.expires_at <= now() then raise exception 'analysis_expired' using errcode = 'P0001'; end if;

  select * into v_set from analysis_file_set(p_analysis);

  -- Serialise claims per user: lock all of the user's plans (stable order), then choose.
  perform 1 from subscriptions where user_id = p_user order by id for update;
  select * into v_s from subscriptions
   where user_id = p_user and starts_at <= now() and ends_at > now()
     and reports_used < reports_total
     and files_per_report >= greatest(v_a.file_count, cardinality(v_set.fingerprints))
   order by ends_at asc, created_at asc
   limit 1;
  if not found then
    if not exists (select 1 from subscriptions where user_id = p_user) then
      raise exception 'no_plan' using errcode = 'P0001';
    elsif not exists (select 1 from subscriptions where user_id = p_user and starts_at <= now() and ends_at > now()) then
      raise exception 'plan_expired' using errcode = 'P0001';
    elsif not exists (select 1 from subscriptions where user_id = p_user and starts_at <= now() and ends_at > now() and reports_used < reports_total) then
      raise exception 'plan_used_up' using errcode = 'P0001';
    else
      raise exception 'too_many_files' using errcode = 'P0001';
    end if;
  end if;

  update subscriptions set reports_used = reports_used + 1 where id = v_s.id;
  -- credits mirror the plan allowance for the header and dashboard
  update credits set balance = greatest(balance - 1, 0), updated_at = now() where user_id = p_user;

  v_m := v_a.payload -> 'm';
  insert into reports (user_id, payment_id, report, file_names, file_hashes, market, currency, trade_count, net_pnl_minor,
                       expires_at, analysis_id, engine_version, subscription_id, title, month_label, used_fingerprints, fingerprint)
  values (p_user, v_s.payment_id, v_a.payload, v_set.names, v_set.hashes, v_m ->> 'market', v_m ->> 'currency',
          (v_m ->> 'n')::int, round((v_m ->> 'net')::numeric * 100)::bigint,
          'infinity', p_analysis, v_a.engine_version, v_s.id, nullif(btrim(p_title), ''),
          to_char(now() at time zone 'Asia/Kolkata', 'MON-YY'), v_set.fingerprints, file_set_hash(v_set.fingerprints))
  returning id into v_id;

  update analyses set report_id = v_id, claimed_at = now(), payload = null where id = p_analysis;

  insert into audit_log (user_id, action, meta)
  values (p_user, 'report_created', jsonb_build_object('report_id', v_id, 'analysis_id', p_analysis,
          'subscription_id', v_s.id, 'plan', v_s.plan_id, 'trades', (v_m ->> 'n')::int));
  return v_id;
end $$;

-- ---- add_analysis_to_report (file-set lock) -------------------------------------
create or replace function public.add_analysis_to_report(p_user uuid, p_report uuid, p_analysis uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a     analyses%rowtype;
  v_r     reports%rowtype;
  v_files int;
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
  select files_per_report into v_files from subscriptions where id = v_r.subscription_id;
  if v_files is null then raise exception 'report_locked' using errcode = 'P0001'; end if;   -- pre-v2 report: no plan link

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

-- ---- admin_grant_plan (D5, owner only) ------------------------------------------
create or replace function public.admin_grant_plan(p_actor uuid, p_user uuid, p_plan text, p_reports int,
                                                   p_files int, p_days int, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from users where id = p_actor and role = 'owner' and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from users where id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0001';
  end if;
  if p_plan not in ('single', 'snapshot', 'progress', 'discipline') or p_reports is null or p_reports < 1
     or p_files is null or p_files not between 1 and 3 or p_days is null or p_days not between 1 and 3660 then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;

  insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, payment_id, granted_by, grant_reason)
  values (p_user, p_plan, p_reports, p_files, now() + make_interval(days => p_days), null, p_actor, btrim(p_reason))
  returning id into v_id;
  insert into credits (user_id, balance) values (p_user, p_reports)
    on conflict (user_id) do update set balance = credits.balance + p_reports, updated_at = now();
  insert into audit_log (user_id, action, meta)
  values (p_user, 'plan_granted_manual', jsonb_build_object('actor', p_actor, 'subscription_id', v_id, 'plan', p_plan,
          'reports', p_reports, 'files', p_files, 'days', p_days, 'reason', btrim(p_reason)));
  return v_id;
end $$;

-- ---- privileges ---------------------------------------------------------------
revoke all on function public.analysis_file_set(uuid) from public;
revoke all on function public.create_report_from_analysis(uuid, uuid, text) from public;
revoke all on function public.add_analysis_to_report(uuid, uuid, uuid) from public;
revoke all on function public.admin_grant_plan(uuid, uuid, text, int, int, int, text) from public;
grant execute on function public.create_report_from_analysis(uuid, uuid, text) to lens_app;
grant execute on function public.add_analysis_to_report(uuid, uuid, uuid) to lens_app;
grant execute on function public.admin_grant_plan(uuid, uuid, text, int, int, int, text) to lens_app;

-- 0007 left grant_plan() executable by PUBLIC (the default for functions); only the app needs it.
revoke all on function public.grant_plan(text, text, jsonb, int, int, int) from public;
grant execute on function public.grant_plan(text, text, jsonb, int, int, int) to lens_app;

-- D6 / rule 5: only the SECURITY DEFINER functions write credits, subscriptions and reports.
-- The app keeps SELECT, and may only rename a report.
revoke insert, update on public.credits from lens_app;
revoke insert, update on public.reports from lens_app;
grant update (title) on public.reports to lens_app;
