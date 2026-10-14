-- @file  packages/db/migrations/0017_data_export.sql
-- @area  Database
-- @what  "Export my data": export_user_data(request) for the worker (only for a real export request in progress) and the archive's key columns.
-- ============================================================================
-- 0017 · Data export (Phase 7, rule 7)
-- The worker has no access to accounts, consents, reports or payments (0008–0013).
-- export_user_data() is the one narrow exception: SECURITY DEFINER, it returns
-- the data of the user behind an export request that is 'processing', and nothing
-- else. Secrets are left out (no OTP hashes, no file keys, no raw payment payloads).
-- The archive is encrypted like statement files; its wrapped key lives on the
-- request row and is removed when the archive expires (7 days).
-- ============================================================================
alter table public.data_requests add column if not exists enc_key_id  text;
alter table public.data_requests add column if not exists wrapped_dek bytea;
alter table public.data_requests add column if not exists iv          bytea;
alter table public.data_requests add column if not exists size_bytes  bigint;
grant update (enc_key_id, wrapped_dek, iv, size_bytes) on public.data_requests to lens_worker;
-- workers mark a pending request 'processing' (status is already updatable since 0011)

create or replace function public.export_user_data(p_request uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from data_requests where id = p_request and kind = 'export' and status = 'processing';
  if not found then raise exception 'not_an_open_export' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'format', 'pnl-lens-export/1',
    'generated_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'name', u.name, 'country', u.country, 'role', u.role, 'status', u.status,
                  'created_at', u.created_at, 'last_login_at', u.last_login_at, 'email_verified_at', u.email_verified_at,
                  'google_sign_in', u.google_sub is not null)
                from users u where u.id = v_user),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan', s.plan_id, 'reports_total', s.reports_total, 'reports_used', s.reports_used,
                  'files_per_report', s.files_per_report, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'source', case when s.payment_id is not null then 'payment' else 'granted by PnL Lens' end) order by s.created_at)
                from subscriptions s where s.user_id = v_user), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('plan', p.plan_id, 'amount_minor', p.amount_minor, 'currency', p.currency,
                  'status', p.status, 'created_at', p.created_at, 'paid_at', p.paid_at, 'order', p.gateway_order_id) order by p.created_at)
                from payments p where p.user_id = v_user), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', c.purpose, 'granted', c.granted, 'policy_version', c.policy_version,
                  'created_at', c.created_at) order by c.id)
                from consents c where c.user_id = v_user), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'month', r.month_label, 'created_at', r.created_at,
                  'statements', r.file_names, 'market', r.market, 'currency', r.currency, 'positions', r.trade_count,
                  'report', r.report,
                  'metrics', (select to_jsonb(m) - 'analysis_id' - 'user_id' from report_metrics m where m.analysis_id = r.analysis_id),
                  'traits', coalesce((select jsonb_agg(to_jsonb(x) - 'analysis_id' - 'user_id' order by x.trait_id) from report_traits x where x.analysis_id = r.analysis_id), '[]'),
                  'trades', coalesce((select jsonb_agg(to_jsonb(t) - 'id' - 'analysis_id' - 'user_id' - 'source_file_id' order by t.seq) from trades t where t.analysis_id = r.analysis_id), '[]'))
                  order by r.created_at)
                from reports r where r.user_id = v_user and r.purged_at is null), '[]'),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('name', f.original_name, 'size_bytes', f.size_bytes, 'sha256', f.sha256,
                  'uploaded_at', f.created_at, 'status', f.status, 'delete_after', f.delete_after, 'deleted_at', f.purged_at) order by f.created_at)
                from statement_files f where f.user_id = v_user), '[]'),
    'file_access', coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'by', a.actor_kind, 'reason', a.reason) order by a.id)
                from file_access_log a where a.owner_user_id = v_user), '[]'),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.action) order by l.id)
                from audit_log l where l.user_id = v_user), '[]')
  );
end $$;

revoke all on function public.export_user_data(uuid) from public;
grant execute on function public.export_user_data(uuid) to lens_worker;
