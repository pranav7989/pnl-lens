/**
 * @file  packages/shared/src/admin/queries.ts
 * @area  Admin
 * @what  SQL behind each admin tab (DAU/MAU, revenue, errors, tickets, product).
 */
/** Read-only metrics for the admin console. All money is in minor units; INR and USD are kept apart. */
import type { Queryable } from '../db';

/** The queries below are unchanged from apps/web/lib/admin/queries.ts; only the connection is now passed in. */
export function adminQueries(db: Queryable) {
const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as any[];
const one = async (sql: string, args: unknown[] = []): Promise<any> => (await q(sql, args))[0] || {};

async function usersTab(pii: boolean) {
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

async function financeTab() {
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

async function errorsTab() {
  const groups = await q(`
    select fingerprint, max(message) as message, max(route) as route, max(source) as source,
      count(*)::int as total, count(*) filter (where created_at > now() - interval '24 hours')::int as last_24h,
      count(distinct user_id)::int as users, max(created_at) as last_seen, min(created_at) as first_seen
    from error_events where created_at > now() - interval '14 days' group by fingerprint order by last_24h desc, total desc limit 50`);
  const k = await one(`select count(*) filter (where created_at > now() - interval '24 hours')::int as e24, count(*) filter (where created_at > now() - interval '7 days')::int as e7d, count(distinct fingerprint) filter (where created_at > now() - interval '24 hours')::int as kinds24, count(distinct user_id) filter (where created_at > now() - interval '24 hours')::int as users24 from error_events`);
  const hourly = await q(`with h as (select generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), '1 hour') as t) select to_char(h.t,'HH24') as hour, (select count(*) from error_events e where date_trunc('hour', e.created_at) = h.t)::int as n from h order by h.t`);
  return { k, groups, hourly };
}

async function supportTab() {
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
async function userLookup(email: string) {
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

async function productTab() {
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
  // REQ-4: landing page (visitors included) — pricing views and how far people scroll
  const landing = await one(`select
      (select count(*) from events where name='pricing_viewed' and created_at > now() - interval '30 days')::int as pricing_views,
      (select count(*) from events where name='landing_scroll_depth' and props->>'depth'='25' and created_at > now() - interval '30 days')::int as d25,
      (select count(*) from events where name='landing_scroll_depth' and props->>'depth'='50' and created_at > now() - interval '30 days')::int as d50,
      (select count(*) from events where name='landing_scroll_depth' and props->>'depth'='75' and created_at > now() - interval '30 days')::int as d75,
      (select count(*) from events where name='landing_scroll_depth' and props->>'depth'='100' and created_at > now() - interval '30 days')::int as d100,
      (select count(*) from events where name='landing_visit' and props->>'source'='share_card' and created_at > now() - interval '30 days')::int as from_share,
      (select count(*) from events where name='share_card_used' and created_at > now() - interval '30 days')::int as shares`);
  // REQ-2: journey bar — events, Single → higher plan, and users who came back within 45 days
  const journey = await one(`select
      (select count(*) from events where name='journey_bar_view' and created_at > now() - interval '30 days')::int as views,
      (select count(*) from events where name='journey_step_click' and created_at > now() - interval '30 days')::int as step_clicks,
      (select count(*) from events where name='journey_next_action_click' and created_at > now() - interval '30 days')::int as action_clicks,
      (select count(*) from events where name='upgrade_from_journey' and created_at > now() - interval '30 days')::int as upgrades,
      (select count(*) from (select distinct on (user_id) user_id, plan_id from subscriptions order by user_id, created_at) f where f.plan_id = 'single')::int as single_first,
      (select count(*) from (select distinct on (user_id) user_id, plan_id, created_at from subscriptions order by user_id, created_at) f
         where f.plan_id = 'single' and exists (select 1 from subscriptions s where s.user_id = f.user_id and s.plan_id <> 'single' and s.created_at > f.created_at))::int as single_upgraded,
      (select count(*) from (select user_id, min(created_at) as first from reports group by user_id) f)::int as with_report,
      (select count(*) from (select user_id, min(created_at) as first from reports group by user_id) f
         where exists (select 1 from reports r where r.user_id = f.user_id and r.created_at > f.first + interval '1 day' and r.created_at <= f.first + interval '45 days'))::int as returned_45d`);
  // REQ-5/6: social icons and the Instagram section (visitors included)
  const instagram = await one(`select
      (select count(*) from events where name='ig_section_view' and created_at > now() - interval '30 days')::int as views,
      (select count(*) from events where name='ig_card_play' and created_at > now() - interval '30 days')::int as plays,
      (select count(*) from events where name='ig_card_click' and created_at > now() - interval '30 days')::int as card_clicks,
      (select count(*) from events where name='ig_follow_click' and created_at > now() - interval '30 days')::int as follows`);
  const social = await q(`select coalesce(props->>'network','?') as network, coalesce(props->>'placement','?') as placement, count(*)::int as n
      from events where name='social_click' and created_at > now() - interval '30 days' group by 1, 2 order by 3 desc`);
  // REQ-7: blog views and CTA clicks per article, and uploads/sign-ups that came from the blog
  const blogPosts = await q(`select props->>'slug' as slug, count(*) filter (where name='blog_view')::int as views,
      count(*) filter (where name='blog_cta_click')::int as cta, count(*) filter (where name='blog_preview_click')::int as preview
      from events where name in ('blog_view','blog_cta_click','blog_preview_click') and created_at > now() - interval '30 days' and props ? 'slug'
      group by 1 order by 2 desc limit 20`);
  const blogFunnel = await one(`select
      count(*) filter (where name='upload_started' and props->>'source'='blog')::int as uploads,
      count(*) filter (where name='signup_from_blog')::int as signups
      from events where name in ('upload_started','signup_from_blog') and created_at > now() - interval '30 days'`);
  const blog = { posts: blogPosts, ...blogFunnel };
  return { k, daily, failures, tabs, brokers, landing, journey, instagram, social, blog };
}

return { usersTab, financeTab, errorsTab, supportTab, userLookup, productTab };
}
