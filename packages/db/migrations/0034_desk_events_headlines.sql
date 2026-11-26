-- @file  packages/db/migrations/0034_desk_events_headlines.sql
-- @area  Database
-- @what  Desk (spec v1.0, PR 2): scheduled events (provider, generated and manual, with a change history), overnight headlines (title, source, time, link and category only, never a body) and the status of each feed.
--
-- Public facts only, no user data. The api fills these on timers (the worker has no internet): headlines every 5
-- minutes, events every 30 minutes, generated market-open/holiday/expiry rows from market_calendar and
-- expiry_calendar. A provider never overwrites a manual row (manual = true); owner/admin edits go through the API
-- (desk:admin, audit_log) and every change of an event is kept in desk_event_history.

create table if not exists public.desk_events (
  id          bigserial primary key,
  day         date not null,
  at          time,                                     -- IST; null = all day
  title       text not null check (length(title) between 1 and 200),
  impact      text not null check (impact in ('high', 'medium', 'low', 'expiry', 'info')),
  category    text not null default 'other' check (category in ('macro', 'policy', 'results', 'market', 'expiry', 'holiday', 'global', 'other')),
  country     text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  source      text not null check (length(source) between 1 and 40),     -- provider name, 'generated' or 'manual'
  source_id   text not null check (length(source_id) between 1 and 200),
  manual      boolean not null default false,           -- added or edited by staff: providers never overwrite it
  hidden      boolean not null default false,
  updated_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists desk_events_day on public.desk_events (day, at);

create table if not exists public.desk_event_history (
  id         bigserial primary key,
  event_id   bigint not null references public.desk_events(id) on delete cascade,
  changed_at timestamptz not null default now(),
  actor      uuid references public.users(id) on delete set null,   -- null = a provider or the generator
  change     text not null check (change in ('created', 'updated', 'hidden', 'shown')),
  before     jsonb,
  after      jsonb
);
create index if not exists desk_event_history_event on public.desk_event_history (event_id, changed_at);

-- headlines: news only, never a body or a view (spec R2); dedupe by link, and by the same title within 6 hours (in code)
create table if not exists public.desk_headlines (
  id           bigserial primary key,
  provider     text not null check (length(provider) between 1 and 40),
  title        text not null check (length(title) between 1 and 300),
  title_key    text not null,                            -- normalised title, for the 6-hour dedupe
  source       text not null check (length(source) between 1 and 80),
  url          text not null check (url ~ '^https?://' and length(url) <= 1000),
  category     text check (category is null or length(category) <= 40),
  published_at timestamptz not null,
  fetched_at   timestamptz not null default now(),
  unique (provider, url)
);
create index if not exists desk_headlines_published on public.desk_headlines (published_at desc);
create index if not exists desk_headlines_title on public.desk_headlines (title_key, published_at);

create table if not exists public.desk_feed_status (
  feed            text primary key check (feed in ('headlines', 'events', 'generated', 'expiries', 'calendar_check')),
  provider        text,
  last_attempt_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_count      int
);

-- ---------------------------------------------------------------- privileges
revoke all on public.desk_events, public.desk_event_history, public.desk_headlines, public.desk_feed_status from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert, update on public.desk_events to lens_app;                 -- never deleted: staff hide rows
    grant select, insert on public.desk_event_history to lens_app;                  -- history is append-only
    grant select, insert, update, delete on public.desk_headlines to lens_app;      -- 7-day retention
    grant select, insert, update on public.desk_feed_status to lens_app;
    grant usage on sequence public.desk_events_id_seq, public.desk_event_history_id_seq, public.desk_headlines_id_seq to lens_app;
  end if;
end $$;
