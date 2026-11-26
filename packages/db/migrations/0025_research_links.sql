-- @file  packages/db/migrations/0025_research_links.sql
-- @area  Database
-- @what  Research datasets stay pseudonymised for download, but PnL Lens keeps the link: research_export_reports (report pseudonym → report) and an owner-only, audited research_lookup().
--
-- Owner/tester request (26 Oct 2026): "it's fine that the download is anonymised, but in our system we need to keep
-- the mapping so that in future I can find which data belongs to which user."
--  · subject codes are already a stable HMAC of the user id (0014, research.pseudonym_key), so they can be
--    resolved by recomputing the HMAC inside the database;
--  · report codes use a fresh key per dataset that the worker discards (0021 build), so the worker now records each
--    (dataset, report code, report id) here. It can insert but never read these rows; the app cannot read them at all.
-- The only way to resolve a code is research_lookup(): an active owner, a reason, and an audit row for every lookup
-- (also when nothing is found). The links outlive the 90-day dataset file on purpose (consent withdrawals, data
-- requests); they go with the dataset record or the report.

create table if not exists public.research_export_reports (
  export_id uuid not null references public.research_exports(id) on delete cascade,
  report    text not null check (report ~ '^[0-9a-f]{24}$'),
  report_id uuid not null references public.reports(id) on delete cascade,
  primary key (export_id, report)
);
create index if not exists research_export_reports_report on public.research_export_reports (report_id);
revoke all on public.research_export_reports from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then
    grant insert on public.research_export_reports to lens_worker;
  end if;
end $$;

-- Resolves a subject code (64 hex, any dataset) or a report code (24 hex, needs the dataset) to the account.
create or replace function public.research_lookup(p_actor uuid, p_code text, p_export uuid, p_reason text)
returns table (kind text, user_id uuid, email text, user_status text, report_id uuid, report_name text, report_created_at timestamptz, report_deleted boolean)
language plpgsql security definer set search_path = public as $$
declare v_code text := lower(btrim(coalesce(p_code, ''))); v_user uuid; v_report uuid; v_kind text;
begin
  if not exists (select 1 from users where id = p_actor and role = 'owner' and status = 'active') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if v_code ~ '^[0-9a-f]{64}$' then
    v_kind := 'subject';
    select u.id into v_user from users u cross join research.pseudonym_key k
     where encode(hmac(convert_to(u.id::text, 'UTF8'), k.key, 'sha256'), 'hex') = v_code;
  elsif v_code ~ '^[0-9a-f]{24}$' then
    v_kind := 'report';
    if p_export is null then raise exception 'export_required' using errcode = 'P0001'; end if;
    select l.report_id, r.user_id into v_report, v_user
      from research_export_reports l join reports r on r.id = l.report_id
     where l.export_id = p_export and l.report = v_code;
  else
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  insert into audit_log (user_id, action, meta) values (p_actor, 'research_lookup',
    jsonb_build_object('code', v_code, 'kind', v_kind, 'export', p_export, 'reason', btrim(p_reason), 'found', v_user));
  if v_user is null then return; end if;
  return query
    select v_kind, u.id, u.email::text, u.status::text, r.id,
           coalesce(nullif(btrim(r.title), ''), r.month_label), r.created_at, r.purged_at is not null
      from users u left join reports r on r.id = v_report
     where u.id = v_user;
end $$;

revoke all on function public.research_lookup(uuid, text, uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant execute on function public.research_lookup(uuid, text, uuid, text) to lens_app;
  end if;
end $$;
