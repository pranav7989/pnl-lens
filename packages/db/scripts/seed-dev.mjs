#!/usr/bin/env node
/**
 * @file  packages/db/scripts/seed-dev.mjs
 * @area  Database
 * @what  Applies seed.sql (dev user with credits) — only when SEED_DEV_DATA=true (set by infra/compose.dev.yml only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (process.env.SEED_DEV_DATA !== 'true') { console.log('seed: skipped (SEED_DEV_DATA is not true)'); process.exit(0); }
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('MIGRATE_DATABASE_URL is required'); process.exit(1); }
const sql = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed.sql'), 'utf8');
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(sql);
await c.end();
console.log('seed: dev data applied');
