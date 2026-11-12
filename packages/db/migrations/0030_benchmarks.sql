-- @file  packages/db/migrations/0030_benchmarks.sql
-- @area  Database
-- @what  Peer benchmarks (Release C): per segment ("India · Index options", "All traders") and metric, the number of traders and the quantiles (p5…p95) of consenting traders' values; built nightly by the worker from the research views.
--
-- Only aggregates are stored: no subject, report or user ids. Quantiles are kept only when a group has at least
-- 50 traders (packages/shared/src/insights/benchmarks.ts MIN_TRADERS); smaller groups keep just their count, so the
-- app can say how close a comparison is. Each trader counts once per segment (their latest report there).

create table if not exists public.benchmarks (
  segment     text not null,
  metric      text not null,
  traders     int  not null check (traders >= 0),
  quantiles   numeric[] check (quantiles is null or cardinality(quantiles) = 19),
  computed_at timestamptz not null default now(),
  primary key (segment, metric)
);
revoke all on public.benchmarks from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then grant select on public.benchmarks to lens_app; end if;
  if exists (select 1 from pg_roles where rolname = 'lens_worker') then grant select, insert, update, delete on public.benchmarks to lens_worker; end if;
end $$;
