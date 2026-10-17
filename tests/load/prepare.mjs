#!/usr/bin/env node
/**
 * @file  tests/load/prepare.mjs
 * @area  Tests
 * @what  Load test setup: creates N test accounts (load-NN@load.invalid) in the running dev stack and writes a session token for each to .load/tokens.json.
 */
/**
 * Usage (repo root, stack started with infra/compose.load.yml):  node tests/load/prepare.mjs [count=50]
 * Tokens are signed with SESSION_SECRET from .env exactly like a real sign-in (shared/auth/session.ts). Re-running
 * reuses the accounts and clears their earlier analyses so the per-user daily limit (20) never interferes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')
  .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const count = Number(process.argv[2] || 50);

const sql = `with u as (
  insert into users (email, country, email_verified_at)
  select format('load-%s@load.invalid', lpad(g::text, 2, '0')), 'IN', now() from generate_series(1, ${count}) g
  on conflict (email) do update set status = 'active' returning id)
select string_agg(id::text, ',') from u;`;
const psql = (q) => spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose.dev.yml', 'exec', '-T', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, 'postgres',
  'psql', '-U', env.POSTGRES_USER || 'lens_admin', '-d', 'lens', '-v', 'ON_ERROR_STOP=1', '-tAc', q], { cwd: root, encoding: 'utf8' });
const r = psql(sql);
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const ids = r.stdout.trim().split(',');
const clear = psql(`delete from analyses where user_id in (select id from users where email like '%@load.invalid') and report_id is null`);
if (clear.status !== 0) console.warn('could not clear earlier analyses:', clear.stderr.trim());

const key = new TextEncoder().encode(env.SESSION_SECRET);
const tokens = await Promise.all(ids.map((id) => new SignJWT({ country: 'IN' }).setProtectedHeader({ alg: 'HS256' })
  .setSubject(id).setIssuedAt().setExpirationTime('1d').sign(key)));
fs.mkdirSync(path.join(root, '.load'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(root, '.load/tokens.json'), JSON.stringify(tokens), { mode: 0o600 });
console.log(`${tokens.length} load-test accounts ready → .load/tokens.json`);
