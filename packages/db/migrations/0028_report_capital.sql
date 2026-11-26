-- @file  packages/db/migrations/0028_report_capital.sql
-- @area  Database
-- @what  Optional "capital used" per report (analysis roadmap B1): the user's own figure, in the report's currency, so results can be shown as % returns and % risk. Never required.

alter table public.reports add column if not exists capital numeric(16, 2) check (capital is null or (capital > 0 and capital <= 100000000000));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant update (capital) on public.reports to lens_app;
  end if;
end $$;

-- "Export my data" includes the capital figures (same wrapper as 0027, one more key)
create or replace function public.export_user_data(p_request uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from data_requests where id = p_request and kind = 'export' and status = 'processing';
  if not found then raise exception 'not_an_open_export' using errcode = 'P0001'; end if;
  return export_user_data_base(p_request) || jsonb_build_object(
    'journal', coalesce((select jsonb_agg(jsonb_build_object('trade', n.trade_key, 'setup', n.setup, 'tags', n.tags, 'emotion', n.emotion,
                  'note', n.note, 'created_at', n.created_at, 'updated_at', n.updated_at) order by n.created_at)
                from trade_notes n where n.user_id = v_user), '[]'),
    'thirty_day_plans', coalesce((select jsonb_agg(jsonb_build_object('report', p.report_id, 'generated_on', p.generated_on, 'checkup_on', p.checkup_on,
                  'plan', p.plan) order by p.generated_on)
                from plan_snapshots p where p.user_id = v_user), '[]'),
    'checkup_reminders', coalesce((select jsonb_agg(jsonb_build_object('remind_on', r.remind_on, 'created_at', r.created_at, 'sent_at', r.sent_at,
                  'cancelled_at', r.cancelled_at) order by r.created_at)
                from plan_reminders r where r.user_id = v_user), '[]'),
    'report_capital', coalesce((select jsonb_agg(jsonb_build_object('report', r.id, 'capital', r.capital) order by r.created_at)
                from reports r where r.user_id = v_user and r.purged_at is null and r.capital is not null), '[]')
  );
end $$;
revoke all on function public.export_user_data(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant execute on function public.export_user_data(uuid) to lens_worker; end if;
end $$;
