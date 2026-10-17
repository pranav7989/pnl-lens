-- @file  packages/db/migrations/0013_purge_v2.sql
-- @area  Database
-- @what  Retention and deletion: purge_raw_files() (30 days), purge_drafts() (24 h), purge_otp_codes(), delete_report_v2(), delete_account().
-- ============================================================================
-- 0013 · Purge and delete (plan §6 scheduled jobs, §10 Deletion, D3, D4)
-- Raw files: the functions "shred" a file in one step by deleting its wrapped key
-- (the stored object becomes unreadable everywhere, backups included), mark it, and
-- log it. The worker then removes the object itself (statement_files_sweep index)
-- and sets object_deleted_at; the api's storage key is write-only by design.
-- Reports and trades are never purged by time (D4); only the user removes them.
-- ============================================================================

alter table public.users drop constraint if exists users_status_check;
alter table public.users add constraint users_status_check check (status in ('active', 'blocked', 'deleted'));

-- Shred one set of files. Internal helper (no grants).
create or replace function public.shred_files(p_ids uuid[], p_status text, p_reason text, p_actor_kind text, p_actor uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with s as (
    update statement_files
       set status = p_status, purged_at = now(), wrapped_dek = null, iv = null
     where id = any(p_ids) and status = 'stored'
    returning id, user_id
  )
  insert into file_access_log (file_id, owner_user_id, actor_kind, actor_user_id, action, reason)
  select id, user_id, p_actor_kind, p_actor, 'delete', p_reason from s;
  get diagnostics n = row_count;
  return n;
end $$;

-- D3: raw files are deleted 30 days after upload. Returns the number shredded.
create or replace function public.purge_raw_files(p_limit int default 1000)
returns int
language plpgsql security definer set search_path = public as $$
begin
  return shred_files(array(select id from statement_files
                            where status = 'stored' and delete_after <= now()
                            order by delete_after limit p_limit),
                     'purged', 'retention_30d', 'system', null);
end $$;

-- D3: unclaimed analyses (previews never saved, and failed jobs) are removed after 24 h,
-- with their derived rows; files no longer used by any analysis are shredded.
create or replace function public.purge_drafts(p_limit int default 1000)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with d as (
    delete from analyses where id in (
      select id from analyses where claimed_at is null and expires_at <= now() order by expires_at limit p_limit)
    returning id
  ) select count(*) into n from d;
  perform shred_files(array(select f.id from statement_files f
                             where f.status = 'stored' and f.created_at < now() - interval '1 hour'
                               and not exists (select 1 from analysis_files af where af.file_id = f.id)),
                      'purged', 'draft_expired', 'system', null);
  return n;
end $$;

-- One-time codes are useless after expiry; keep 7 days for abuse checks (HANDOFF phase 7).
create or replace function public.purge_otp_codes()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from otp_codes where created_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- Remove everything one report holds. Internal helper (no grants).
create or replace function public.wipe_report(p_report uuid, p_label text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_files uuid[];
begin
  select coalesce(array_agg(distinct af.file_id), '{}') into v_files
    from analyses a join analysis_files af on af.analysis_id = a.id
   where a.report_id = p_report or a.target_report_id = p_report;
  update reports
     set report = null, file_names = array[p_label], file_hashes = '{}', title = null,
         analysis_id = null, used_fingerprints = '{}', fingerprint = null, purged_at = coalesce(purged_at, now())
   where id = p_report;
  -- derived rows (trades, fills, metrics, traits, analysis_files) go with their analyses
  delete from analyses where report_id = p_report or target_report_id = p_report;
  -- shred the report's files unless another live report still uses them
  perform shred_files(array(select f from unnest(v_files) f
                             where not exists (select 1 from analysis_files af where af.file_id = f)),
                      'deleted', 'report_deleted', 'user', p_actor);
end $$;

-- User deletes a report (DELETE /reports/:id). Idempotent: false if already gone.
create or replace function public.delete_report_v2(p_user uuid, p_report uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from reports where id = p_report and user_id = p_user and purged_at is null for update;
  if not found then return false; end if;
  perform wipe_report(p_report, '[deleted]', p_user);
  insert into audit_log (user_id, action, meta) values (p_user, 'report_deleted', jsonb_build_object('report_id', p_report));
  return true;
end $$;

-- User closes their account (DELETE /me). Removes reports, trades, files and analyses,
-- anonymises the user row, and keeps payment rows (billing law) and consent history
-- (proof of consent) without IP or browser details. Idempotent.
create or replace function public.delete_account(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform 1 from users where id = p_user and status <> 'deleted' for update;
  if not found then return false; end if;

  for r in select id from reports where user_id = p_user loop
    perform wipe_report(r.id, '[deleted]', p_user);
  end loop;
  delete from analyses where user_id = p_user;                -- drafts and in-flight jobs
  perform shred_files(array(select id from statement_files where user_id = p_user), 'deleted', 'account_deleted', 'user', p_user);
  update statement_files set original_name = '[deleted]' where user_id = p_user;
  update file_access_log set ip = null where owner_user_id = p_user or actor_user_id = p_user;

  delete from otp_codes where user_id = p_user;
  delete from events where user_id = p_user;
  update error_events set user_id = null, context = null where user_id = p_user;
  update support_tickets set user_id = null, email = 'deleted+' || p_user || '@deleted.invalid', body = null, notes = null
   where user_id = p_user;
  update consents set ip_hash = null, user_agent = null where user_id = p_user;
  update subscriptions set ends_at = least(ends_at, now()) where user_id = p_user;
  update credits set balance = 0, updated_at = now() where user_id = p_user;

  update users
     set email = 'deleted+' || p_user || '@deleted.invalid', name = null, google_sub = null, country = null,
         email_verified_at = null, last_login_at = null, role = 'user', status = 'deleted'
   where id = p_user;

  insert into audit_log (user_id, action, meta) values (p_user, 'account_deleted', '{}'::jsonb);
  return true;
end $$;

-- ---- privileges ---------------------------------------------------------------
revoke all on function public.shred_files(uuid[], text, text, text, uuid) from public;
revoke all on function public.wipe_report(uuid, text, uuid) from public;
revoke all on function public.purge_raw_files(int) from public;
revoke all on function public.purge_drafts(int) from public;
revoke all on function public.purge_otp_codes() from public;
revoke all on function public.delete_report_v2(uuid, uuid) from public;
revoke all on function public.delete_account(uuid) from public;
-- scheduled jobs run in the worker
grant execute on function public.purge_raw_files(int), public.purge_drafts(int), public.purge_otp_codes() to lens_worker;
-- user actions come through the api; account deletion may also be run by the worker from data_requests
grant execute on function public.delete_report_v2(uuid, uuid), public.delete_account(uuid) to lens_app;
grant execute on function public.delete_account(uuid) to lens_worker;
