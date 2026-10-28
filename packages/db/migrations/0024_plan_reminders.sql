-- @file  packages/db/migrations/0024_plan_reminders.sql
-- @area  Database
-- @what  30-day plan check-up reminders: one active reminder per user (a date), sent once from 09:00 IST by the api (the only service with mail egress).
--
-- The user turns a reminder on from the "Remind me on <date>" link in their 30-day plan PDF. Only a date and the
-- report it came from are stored. due_plan_reminders() lists due reminders of active accounts; the api claims each
-- one with mark_plan_reminder_sent() BEFORE sending, so two api processes can never send the same reminder twice.
-- The worker has no mail egress (internal network only), so it gets no grant here.

create table if not exists public.plan_reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  report_id    uuid references public.reports(id) on delete set null,
  remind_on    date not null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  cancelled_at timestamptz
);
-- one active (not sent, not cancelled) reminder per user
create unique index if not exists plan_reminders_one_active on public.plan_reminders (user_id) where sent_at is null and cancelled_at is null;
create index if not exists plan_reminders_due on public.plan_reminders (remind_on) where sent_at is null and cancelled_at is null;

revoke all on public.plan_reminders from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert on public.plan_reminders to lens_app;
    grant update (cancelled_at) on public.plan_reminders to lens_app;
  end if;
end $$;

-- due today or earlier (IST), not sent, not cancelled, account active
create or replace function public.due_plan_reminders(p_limit int default 200)
returns table (id uuid, email text, remind_on date)
language sql security definer set search_path = public stable as $$
  select r.id, u.email::text, r.remind_on
    from plan_reminders r join users u on u.id = r.user_id
   where r.sent_at is null and r.cancelled_at is null and u.status = 'active'
     and r.remind_on <= (now() at time zone 'Asia/Kolkata')::date
   order by r.remind_on, r.created_at
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- claims one reminder for sending; false if it was already claimed or cancelled (never sent twice)
create or replace function public.mark_plan_reminder_sent(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update plan_reminders set sent_at = now() where id = p_id and sent_at is null and cancelled_at is null;
  return found;
end $$;

revoke all on function public.due_plan_reminders(int) from public;
revoke all on function public.mark_plan_reminder_sent(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant execute on function public.due_plan_reminders(int) to lens_app;
    grant execute on function public.mark_plan_reminder_sent(uuid) to lens_app;
  end if;
end $$;
