-- @file  packages/db/seed.sql
-- @area  Database
-- @what  Local development seed (dev user with a Snapshot plan and matching credits). Never run in production.
-- Local development seed: one test user with a real plan (D6: balance-only credits no longer
-- create reports) and 5 credits that mirror the plan allowance. Safe to re-run.
insert into public.users (id, email, country, email_verified_at)
values ('00000000-0000-0000-0000-000000000001', 'dev@pnl-lens.local', 'IN', now())
on conflict do nothing;
insert into public.subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason)
select '00000000-0000-0000-0000-000000000001', 'snapshot', 5, 3, now() + interval '183 days', 'dev seed'
 where not exists (select 1 from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000001');
insert into public.credits (user_id, balance)
values ('00000000-0000-0000-0000-000000000001', 5)
on conflict (user_id) do update set balance = 5;
