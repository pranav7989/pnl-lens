/**
 * @file  packages/db/scripts/seed-admin-demo.mjs
 * @area  Ops
 * @what  Fills a local database with demo admin data (refuses production).
 */
// Local demo data for the admin console (never run in production).
// Usage: DATABASE_URL=postgres://lens_admin:...@localhost/lens node packages/db/scripts/seed-admin-demo.mjs
import pg from 'pg';
if (process.env.NODE_ENV === 'production') { console.error('refusing to seed demo data in production'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const r = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
await c.query(`update users set role='owner' where email='dev@pnl-lens.local'`);
const countries = ['IN', 'IN', 'IN', 'IN', 'US', 'GB', 'DE', 'SG', 'AE'];
const ids = [];
for (let i = 0; i < 160; i++) {
  const { rows } = await c.query(`insert into users (email, country, created_at, last_login_at, email_verified_at) values ($1, $2, now() - ($3 || ' days')::interval, now() - ($4 || ' hours')::interval, now()) on conflict (email) do update set country = excluded.country returning id`,
    [`demo${i}@example.com`, countries[i % countries.length], r(0, 75), r(1, 400)]);
  ids.push(rows[0].id);
}
for (const id of ids) {
  const days = r(1, 18);
  for (let k = 0; k < days; k++) await c.query(`insert into events (user_id, name, day, created_at) values ($1, 'active', current_date - $2::int, now() - ($2 || ' days')::interval) on conflict do nothing`, [id, r(0, 34)]);
  for (let k = 0; k < r(0, 4); k++) await c.query(`insert into events (user_id, name, props, created_at) values ($1, 'tab_viewed', $2, now() - ($3 || ' days')::interval)`, [id, JSON.stringify({ tab: ['overview', 'progress', 'insights', 'clusters', 'positions'][r(0, 4)] }), r(0, 29)]);
  for (let k = 0; k < r(1, 3); k++) await c.query(`insert into events (user_id, name, props, created_at) values ($1, 'upload_started', '{}', now() - ($2 || ' days')::interval)`, [id, r(0, 29)]);
  if (Math.random() < 0.12) await c.query(`insert into events (user_id, name, props, created_at) values ($1, 'upload_failed', $2, now() - ($3 || ' days')::interval)`, [id, JSON.stringify({ reason: ['scanned PDF', 'no closed trades', 'password-protected file'][r(0, 2)], ext: ['pdf', 'xlsx', 'csv'][r(0, 2)] }), r(0, 6)]);
  if (Math.random() < 0.35) {
    const plan = ['single', 'snapshot', 'snapshot', 'progress', 'progress', 'discipline'][r(0, 5)], inr = { single: 9900, snapshot: 49900, progress: 149900, discipline: 399900 }[plan];
    const intl = Math.random() < 0.2;
    await c.query(`insert into payments (user_id, gateway_order_id, gateway_payment_id, amount_minor, currency, status, plan_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, now() - ($8 || ' days')::interval)`,
      [id, 'order_' + Math.random().toString(36).slice(2), 'pay_' + Math.random().toString(36).slice(2), intl ? { single: 900, snapshot: 1900, progress: 4900, discipline: 12900 }[plan] : inr, intl ? 'USD' : 'INR', Math.random() < 0.06 ? 'failed' : 'paid', plan, r(0, 160)]);
  }
}
const errs = [['Cannot read properties of undefined (reading \'symbol\')', 'client', '/upload'], ['PDF has no readable text', 'server', 'POST /api/reports'], ['ECONNRESET talking to Resend', 'server', 'POST /api/auth/otp/request'], ['Worker terminated: out of memory', 'client', '/upload']];
for (let i = 0; i < 70; i++) { const e = errs[r(0, errs.length - 1)]; await c.query(`insert into error_events (fingerprint, message, source, route, user_id, created_at) values (md5($1), $1, $2, $3, $4, now() - ($5 || ' hours')::interval)`, [e[0], e[1], e[2], ids[r(0, ids.length - 1)], r(0, 200)]); }
const subjects = ['Zerodha PDF not reading', 'Paid but no credits', 'How do I compare months?', 'Dashboard shows wrong currency', 'Refund request', 'Upload stuck on analysing'];
for (let i = 0; i < 12; i++) await c.query(`insert into support_tickets (user_id, email, subject, status, priority, created_at, updated_at) values ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval, now() - ($7 || ' hours')::interval)`,
  [ids[i], `demo${i}@example.com`, subjects[i % subjects.length], ['open', 'open', 'in_progress', 'resolved'][i % 4], ['normal', 'high', 'urgent', 'low'][i % 4], r(5, 300), r(0, 4)]);
for (let m = 0; m < 6; m++) for (const [cat, amt] of [['hosting', 240000], ['database', 120000], ['email', 18000], ['marketing', 900000], ['tools', 60000]])
  await c.query(`insert into costs (month, category, amount_minor, currency) values (date_trunc('month', now()) - ($1 || ' months')::interval, $2, $3, 'INR')`, [m, cat, amt + r(-20000, 20000)]);
console.log('demo admin data seeded for', ids.length, 'users'); await c.end();
