-- @file  packages/db/migrations/0007_payments_plans.sql
-- @area  Database
-- @what  subscriptions table and grant_plan() used by the Razorpay webhook.
-- ============================================================================
-- 0007 · Plans purchased through payments
--   subscriptions : one row per purchased plan (reports allowance + validity)
--   grant_plan()  : called ONLY by the verified Razorpay webhook. Marks the
--                   payment paid and creates the plan in one transaction.
--                   Idempotent: a replayed webhook changes nothing.
-- ============================================================================
create table if not exists public.subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id),
  plan_id          text not null check (plan_id in ('single', 'snapshot', 'progress', 'discipline')),
  reports_total    int not null check (reports_total > 0),
  reports_used     int not null default 0 check (reports_used >= 0),
  files_per_report int not null check (files_per_report between 1 and 3),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,
  payment_id       uuid unique references public.payments(id),
  created_at       timestamptz not null default now()
);
create index if not exists subscriptions_user on public.subscriptions (user_id, ends_at desc);

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('created', 'authorized', 'paid', 'failed', 'refunded'));

create or replace function public.grant_plan(p_order_id text, p_payment_id text, p_payload jsonb,
                                             p_reports int, p_files int, p_days int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pay payments%rowtype;
begin
  select * into v_pay from payments where gateway_order_id = p_order_id for update;
  if not found then raise exception 'unknown_order' using errcode = 'P0002'; end if;
  if v_pay.status = 'paid' then return false; end if;                 -- replayed webhook: nothing to do
  update payments set status = 'paid', gateway_payment_id = coalesce(p_payment_id, gateway_payment_id),
         raw_payload = p_payload, paid_at = now(), credits_granted = p_reports where id = v_pay.id;
  insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, payment_id)
  values (v_pay.user_id, v_pay.plan_id, p_reports, p_files, now() + make_interval(days => p_days), v_pay.id);
  insert into credits (user_id, balance) values (v_pay.user_id, p_reports)
    on conflict (user_id) do update set balance = credits.balance + p_reports;
  insert into audit_log (user_id, action, meta) values (v_pay.user_id, 'plan_granted', jsonb_build_object('order', p_order_id, 'plan', v_pay.plan_id));
  return true;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select on public.subscriptions to lens_app;
    grant select, insert, update (status, gateway_payment_id, raw_payload) on public.payments to lens_app;
    grant execute on function public.grant_plan(text, text, jsonb, int, int, int) to lens_app;
  end if;
end $$;
