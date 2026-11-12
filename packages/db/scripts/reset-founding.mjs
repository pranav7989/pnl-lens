#!/usr/bin/env node
/**
 * @file  packages/db/scripts/reset-founding.mjs
 * @area  Ops
 * @what  Before launch only: clears all founding trader numbers and restarts the counter at 1 (testers got numbers during testing). Refused once any order is paid.
 */
/**
 * Run with the database owner's URL (the app roles cannot call it):
 *   MIGRATE_DATABASE_URL=... node packages/db/scripts/reset-founding.mjs --yes
 * Without --yes it only shows how many numbers are given. The database refuses (paid_orders_exist) once a payment
 * is paid, so a paying trader's number is never taken back. Recorded in audit_log.
 */
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('MIGRATE_DATABASE_URL is required'); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query('select count(*)::int as n, (select last from founding_counter) as last from users where founding_no is not null');
  console.log(`founding numbers given: ${rows[0].n} (counter at ${rows[0].last})`);
  if (!process.argv.includes('--yes')) { console.log('dry run: add --yes to clear them and restart at 1'); process.exit(0); }
  const r = await client.query('select public.reset_founding_numbers() as n');
  console.log(`cleared ${r.rows[0].n}; the next founding trader gets #0001`);
} catch (e) {
  console.error(/paid_orders_exist/.test(String(e?.message)) ? 'refused: an order is already paid, numbers can no longer be reset' : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
