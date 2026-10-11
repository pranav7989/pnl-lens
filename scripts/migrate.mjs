#!/usr/bin/env node
/**
 * @file  scripts/migrate.mjs
 * @area  Ops
 * @what  Applies db/migrations in order (runs as the pre-deploy job).
 */
/**
 * Applies db/migrations/*.sql in filename order, once each, inside a transaction per file.
 * Tracks applied files in public.schema_migrations. Run with admin (RDS master) credentials:
 *   DATABASE_URL=postgres://master:***@host:5432/lens npm run db:migrate
 * On AWS this runs as a one-off ECS task before each deploy (see infra/AWS.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL (or MIGRATE_DATABASE_URL) is required'); process.exit(1); }
const dir = path.resolve(process.cwd(), 'db/migrations');
const ssl = process.env.DATABASE_SSL === 'require'
  ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : process.env.DATABASE_CA_PATH ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') } : {}) }
  : undefined;

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  process.stdout.write(`applying ${f} ... `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations(name) values ($1)', [f]);
    await client.query('commit');
    console.log('ok'); applied++;
  } catch (e) {
    await client.query('rollback');
    console.log('FAILED'); console.error(e.message); await client.end(); process.exit(1);
  }
}
console.log(applied ? `${applied} migration(s) applied` : 'database is up to date');
await client.end();
