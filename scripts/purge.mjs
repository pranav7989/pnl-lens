#!/usr/bin/env node
/**
 * @file  scripts/purge.mjs
 * @area  Ops
 * @what  Nightly purge of expired reports (DigitalOcean scheduled job).
 */
/**
 * Nightly purge of expired report payloads. On AWS: EventBridge Scheduler → ECS RunTask with
 * command ["node","scripts/purge.mjs"] using the same image and the lens_app DATABASE_URL.
 */
import fs from 'node:fs';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
const ssl = process.env.DATABASE_SSL === 'require'
  ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : process.env.DATABASE_CA_PATH ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') } : {}) }
  : undefined;
const c = new pg.Client({ connectionString: url, ssl });
await c.connect();
const { rows } = await c.query('select public.purge_expired_reports() as n');
console.log(JSON.stringify({ event: 'purge_expired_reports', purged: Number(rows[0].n), at: new Date().toISOString() }));
await c.end();
