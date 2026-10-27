#!/usr/bin/env node
/**
 * @file  packages/db/scripts/setup-roles.mjs
 * @area  Database
 * @what  Creates/updates the login roles lens_app and lens_worker with passwords from env (runs after migrations, as superuser).
 */
/**
 * Passwords never live in SQL files or git: they come from LENS_APP_PASSWORD / LENS_WORKER_PASSWORD
 * (.env locally, server env in production) and are re-applied on every run, so rotating a password
 * is: change .env, re-run the migrate job. Grants stay in the numbered migrations.
 *   lens_app    — the API / web app (grants in 0002, 0005–0007)
 *   lens_worker — the worker (role created in 0008; table grants in 0008–0013)
 *   lens_research is deliberately NOT here: it stays NOLOGIN (0008) until a separately approved phase.
 * Also locks the database down: PUBLIC loses CONNECT, only these roles (and the superuser) can connect.
 */
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('MIGRATE_DATABASE_URL is required'); process.exit(1); }
const ssl = process.env.DATABASE_SSL === 'require'
  ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : process.env.DATABASE_CA_PATH ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') } : {}) }
  : undefined;

const ROLES = [
  ['lens_app', process.env.LENS_APP_PASSWORD],
  ['lens_worker', process.env.LENS_WORKER_PASSWORD],
];
for (const [role, pw] of ROLES) {
  if (!pw || pw.length < 24) { console.error(`${role}: password env var missing or shorter than 24 chars`); process.exit(1); }
}

const c = new pg.Client({ connectionString: url, ssl });
await c.connect();
const db = (await c.query('select current_database() as d')).rows[0].d;
for (const [role, pw] of ROLES) {
  const exists = (await c.query('select 1 from pg_roles where rolname = $1', [role])).rowCount;
  if (!exists) await c.query(`create role ${c.escapeIdentifier(role)}`);
  await c.query(`alter role ${c.escapeIdentifier(role)} with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${c.escapeLiteral(pw)}`);
  await c.query(`grant connect on database ${c.escapeIdentifier(db)} to ${c.escapeIdentifier(role)}`);
  console.log(`role ${role}: ${exists ? 'updated' : 'created'}`);
}
await c.query(`revoke connect on database ${c.escapeIdentifier(db)} from public`);
await c.end();
