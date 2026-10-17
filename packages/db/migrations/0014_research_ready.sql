-- @file  packages/db/migrations/0014_research_ready.sql
-- @area  Database
-- @what  research schema: pseudonymised views over trades, metrics and traits, for users with research consent only. No ML.
-- ============================================================================
-- 0014 · Ready for research / AI (plan §7 "Ready for AI means only this", rule 7)
-- Only users whose CURRENT research consent is granted (latest consents row) and
-- whose account is active appear. user_id is replaced with an HMAC pseudonym.
-- No email, name, file names, file ids, source rows or broker client ids.
-- The HMAC key is generated inside the database here (never in git or env) and no
-- role is granted access to it; the views read it as their owner.
-- lens_research is NOLOGIN (0008): nothing can query these views until a future,
-- separately approved phase gives it a login.
-- ============================================================================

create schema if not exists research;
revoke all on schema research from public;

create table if not exists research.pseudonym_key (
  id  boolean primary key default true check (id),
  key bytea not null default gen_random_bytes(32)
);
insert into research.pseudonym_key default values on conflict do nothing;
revoke all on research.pseudonym_key from public;

-- Views check table rights as their owner, but functions and security_invoker views inside them
-- run with the caller's rights. So the pseudonym is computed inline (the key table is read as the
-- owner) and the views read base tables, not public.current_trades / user_consent_current.
create or replace view research.consenting_users as
  select u.id as user_id,
         encode(public.hmac(convert_to(u.id::text, 'UTF8'), k.key, 'sha256'), 'hex') as subject,
         u.country, date_trunc('month', u.created_at)::date as joined_month
    from public.users u
    cross join research.pseudonym_key k
    join (select distinct on (user_id) user_id, granted
            from public.consents where purpose = 'research'
           order by user_id, created_at desc, id desc) c on c.user_id = u.id and c.granted
   where u.status = 'active';

create or replace view research.subjects as
  select subject, country, joined_month from research.consenting_users;

create or replace view research.trades as
  select cu.subject, r.id as report_id, t.seq, t.symbol, t.underlying, t.market, t.kind, t.option_type, t.grp, t.family,
         t.direction, t.entry_date, t.exit_date, t.entry_hour, t.hold_days, t.sell_days, t.expiry, t.expiry_type,
         t.weekday, t.strike, t.qty, t.open_qty, t.avg_buy, t.buy, t.sell, t.pnl, t.net_est, t.pct, t.style,
         t.n_legs, t.mult, t.is_opt, t.currency, t.broker, t.engine_version
    from public.trades t
    join public.reports r on r.analysis_id = t.analysis_id and r.purged_at is null
    join research.consenting_users cu on cu.user_id = t.user_id;

create or replace view research.report_metrics as
  select cu.subject, r.id as report_id, m.n, m.wins, m.losses, m.win_rate, m.payoff, m.profit_factor, m.realized,
         m.charges, m.other, m.net, m.from_date, m.to_date, m.source, m.market, m.currency, m.progress_score,
         m.extra - 'clientId' as extra, m.engine_version
    from public.report_metrics m
    join public.reports r on r.analysis_id = m.analysis_id and r.purged_at is null
    join research.consenting_users cu on cu.user_id = m.user_id;

create or replace view research.report_traits as
  select cu.subject, r.id as report_id, x.trait_id, x.area, x.name, x.score, x.level, x.is_primary, x.engine_version
    from public.report_traits x
    join public.reports r on r.analysis_id = x.analysis_id and r.purged_at is null
    join research.consenting_users cu on cu.user_id = x.user_id;

-- consenting_users holds the real user_id: internal only.
revoke all on research.consenting_users from public;
grant usage on schema research to lens_research;
grant select on research.subjects, research.trades, research.report_metrics, research.report_traits to lens_research;
