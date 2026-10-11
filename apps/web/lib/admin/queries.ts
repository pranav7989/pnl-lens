/**
 * @file  apps/web/lib/admin/queries.ts
 * @area  Admin
 * @what  SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product).
 */
/** Read-only metrics for the admin console. All money is in minor units; INR and USD are kept apart. */
import { pool } from '@/lib/db';

const q = async (sql: string, args: unknown[] = []) => (await pool().query(sql, args)).rows;
const one = async (sql: string, args: unknown[] = []) => (await q(sql, args))[0] || {};

export async function usersTab(pii: boolean) {
  const k = await one(`
    select
      (select count(distinct user_id) from events where name='active' and day = current_date)::int as dau,
      (select count(distinct user_id) from events where name='active' and day > current_date - 7)::int as wau,
      (select count(distinct user_id) from events where name='active' and day > current_date - 30)::int as mau,
      (select count(*) from users where created_at > now() - interval '1 day')::int as new_1d,
      (select count(*) from users where created_at > now() - interval '7 days')::int as new_7d,
      (select count(*) from users where created_at > now() - interval '30 days')::int as new_30d,
      (select count(*) from users)::int as total,
      (select count(*) from (select user_id from events where name='active' and day > current_date - 30 group by user_id having count(*) >= 2) r)::int as repeat_30d,
      (select count(*) from (select user_id from reports group by user_id having count(*) >= 2) r)::int as repeat_reporters`);
  const daily = await q(`
    with d as (select generate_series(current_date - 29, current_date, '1 day')::date as day)
    select to_char(d.day,'YYYY-MM-DD') as day,
      (select count(distinct user_id) from events e where e.name='active' and e.day = d.day)::int as active,
      (select count(*) from users u where u.created_at::date = d.day)::int as new
    from d order by d.day`);
  const retention = await one(`
    with c as (select id from users where created_at between now() - interval '60 days' and now() - interval '30 days')
    select (select count(*) from c)::int as cohort,
      (select count(distinct e.user_id) from events e join c on c.id = e.user_id where e.name='active' and e.day > current_date - 30)::int as retained`);
  const countries = await q(`select coalesce(country,'Unknown') as country, count(*)::int as n from users group by 1 order by 2 desc limit 8`);
  const recent = pii ? await q(`select email, coalesce(country,'—') as country, created_at, last_login_at from users order by created_at desc limit 10`) : [];
  return { k, daily, retention, countries, recent };
}

export async function financeTab() {
  const byMonth = await q(`
    select to_char(date_trunc('month', created_at),'YYYY-MM') as month, currency,
      sum(amount_minor) filter (where status='paid')::bigint as revenue,
      sum(amount_minor) filter (where status='refunded')::bigint as refunds,
      count(*) filter (where status='paid')::int as orders
    from payments where created_at > now() - interval '12 months' group by 1, 2 order by 1`);
  const k = await one(`
    select
      coalesce(sum(amount_minor) filter (where status='paid' and currency='INR' and created_at > now() - interval '30 days'),0)::bigint as inr_30d,
      coalesce(sum(amount_minor) filter (where status='paid' and currency='USD' and created_at > now() - interval '30 days'),0)::bigint as usd_30d,
      count(distinct user_id) filter (where status='paid' and created_at > now() - interval '30 days')::int as payers_30d,
      count(*) filter (where status='paid' and created_at > now() - interval '30 days')::int as orders_30d,
      count(*) filter (where status='failed' and created_at > now() - interval '30 days')::int as failed_30d,
      coalesce(sum(amount_minor) filter (where status='refunded' and created_at > now() - interval '30 days'),0)::bigint as refunds_30d
    from payments`);
  const plans = await q(`select coalesce(plan_id,'unknown') as plan, currency, count(*)::int as n, sum(amount_minor)::bigint as revenue from payments where status='paid' group by 1, 2 order by 4 desc`);
  const costs = await q(`select to_char(month,'YYYY-MM') as month, category, currency, sum(amount_minor)::bigint as amount from costs where month > now() - interval '12 months' group by 1, 2, 3 order by 1, 2`);
  // payment gateway fee estimate: 2% domestic (INR), 3% international (USD)
  const fees = await q(`select to_char(date_trunc('month', created_at),'YYYY-MM') as month, currency, round(sum(amount_minor) * case when currency='INR' then 0.02 else 0.03 end)::bigint as fees from payments where status='paid' and created_at > now() - interval '12 months' group by 1, 2 order by 1`);
  return { k, byMonth, plans, costs, fees };
}

export async function errorsTab() {
  const groups = await q(`
    select fingerprint, max(message) as message, max(route) as route, max(source) as source,
      count(*)::int as total, count(*) filter (where created_at > now() - interval '24 hours')::int as last_24h,
      count(distinct user_id)::int as users, max(created_at) as last_seen, min(created_at) as first_seen
    from error_events where created_at > now() - interval '14 days' group by fingerprint order by last_24h desc, total desc limit 50`);
  const k = await one(`select count(*) filter (where created_at > now() - interval '24 hours')::int as e24, count(*) filter (where created_at > now() - interval '7 days')::int as e7d, count(distinct fingerprint) filter (where created_at > now() - interval '24 hours')::int as kinds24, count(distinct user_id) filter (where created_at > now() - interval '24 hours')::int as users24 from error_events`);
  const hourly = await q(`with h as (select generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), '1 hour') as t) select to_char(h.t,'HH24') as hour, (select count(*) from error_events e where date_trunc('hour', e.created_at) = h.t)::int as n from h order by h.t`);
  return { k, groups, hourly };
}

export async function supportTab() {
  const tickets = await q(`select t.id, t.email, t.subject, t.status, t.priority, t.created_at, t.updated_at,
      (select count(*) from error_events e where e.user_id = t.user_id and e.created_at > t.created_at - interval '2 days')::int as related_errors
    from support_tickets t order by case t.status when 'open' then 0 when 'in_progress' then 1 else 2 end, case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at desc limit 50`);
  const k = await one(`select count(*) filter (where status='open')::int as open, count(*) filter (where status='in_progress')::int as in_progress, count(*) filter (where status='resolved' and updated_at > now() - interval '7 days')::int as resolved_7d,
      coalesce(round(extract(epoch from avg(updated_at - created_at) filter (where status='resolved' and updated_at > now() - interval '30 days')) / 3600, 1), 0) as avg_hours from support_tickets`);
  // users who hit problems recently: failed uploads or errors, most affected first
  const struggling = await q(`
    select u.email, count(*) filter (where x.kind='error')::int as errors, count(*) filter (where x.kind='upload_failed')::int as failed_uploads, max(x.at) as last_at
    from (select user_id, 'error' as kind, created_at as at from error_events where created_at > now() - interval '7 days'
          union all select user_id, name, created_at from events where name in ('upload_failed','no_trades') and created_at > now() - interval '7 days') x
    join users u on u.id = x.user_id group by u.email order by (count(*)) desc limit 10`);
  return { k, tickets, struggling };
}

/** Pinpoint a single user's issue: profile, plan usage and a merged timeline of events, errors and payments. */
export async function userLookup(email: string) {
  const u = await one(`select id, email, role, country, created_at, last_login_at, status, (select balance from credits where user_id = users.id) as credits from users where email = $1`, [email]);
  if (!u.id) return null;
  const timeline = await q(`
    select * from (
      select created_at as at, 'event' as kind, name as title, props::text as detail from events where user_id = $1
      union all select created_at, 'error', message, coalesce(route,'') || ' ' || coalesce(context::text,'') from error_events where user_id = $1
      union all select created_at, 'payment', status || ' ' || currency || ' ' || (amount_minor / 100.0)::text, coalesce(plan_id,'') from payments where user_id = $1
      union all select created_at, 'report', 'report created', array_to_string(file_names, ', ') from reports where user_id = $1
      union all select created_at, 'audit', action, meta::text from audit_log where user_id = $1
    ) t order by at desc limit 80`, [u.id]);
  const lastError = timeline.find((t: any) => t.kind === 'error') || null;
  const failed = timeline.filter((t: any) => t.title === 'upload_failed' || t.title === 'no_trades').length;
  const diagnosis = lastError ? `Most recent error: “${lastError.title}”${lastError.detail ? ` (${String(lastError.detail).trim().slice(0, 120)})` : ''}.`
    : failed ? `${failed} upload${failed === 1 ? '' : 's'} could not be read. Ask for the broker name and file type.`
    : (u.credits ?? 0) <= 0 ? 'No report credits left; the user may be unable to create a report.' : 'No errors recorded for this user.';
  return { user: u, timeline, diagnosis };
}

export async function productTab() {
  const k = await one(`select
      (select count(*) from reports where created_at > now() - interval '30 days')::int as reports_30d,
      (select count(*) from reports where created_at > now() - interval '1 day')::int as reports_1d,
      (select round(avg(coalesce(array_length(file_names,1),0)),2) from reports where created_at > now() - interval '30 days') as files_per_report,
      (select count(*) from events where name='upload_failed' and created_at > now() - interval '30 days')::int as failed_30d,
      (select count(*) from events where name='upload_started' and created_at > now() - interval '30 days')::int as started_30d`);
  const daily = await q(`with d as (select generate_series(current_date - 29, current_date, '1 day')::date as day) select to_char(d.day,'YYYY-MM-DD') as day, (select count(*) from reports r where r.created_at::date = d.day)::int as reports from d order by d.day`);
  const failures = await q(`select coalesce(props->>'reason','unknown') as reason, coalesce(props->>'ext','?') as ext, count(*)::int as n from events where name in ('upload_failed','no_trades') and created_at > now() - interval '30 days' group by 1, 2 order by 3 desc limit 12`);
  const tabs = await q(`select coalesce(props->>'tab','?') as tab, count(*)::int as n from events where name='tab_viewed' and created_at > now() - interval '30 days' group by 1 order by 2 desc`);
  const brokers = await q(`select coalesce(props->>'broker','unknown') as broker, count(*)::int as n from events where name='report_viewed' and created_at > now() - interval '30 days' group by 1 order by 2 desc limit 10`);
  return { k, daily, failures, tabs, brokers };
}
