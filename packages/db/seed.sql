-- @file  packages/db/seed.sql
-- @area  Database
-- @what  Local development seed (dev user with credits). Never run in production.
-- Local development seed: one test user with 5 credits.
insert into public.users (id, email, country, email_verified_at)
values ('00000000-0000-0000-0000-000000000001', 'dev@pnl-lens.local', 'IN', now())
on conflict do nothing;
insert into public.credits (user_id, balance)
values ('00000000-0000-0000-0000-000000000001', 5)
on conflict (user_id) do update set balance = 5;
