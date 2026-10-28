#!/usr/bin/env node
/**
 * @file  packages/db/scripts/rewrap-keys.mjs
 * @area  Ops
 * @what  Key rotation: re-wraps every file and export key from older FILE_KEK_<ID>s to the current FILE_KEK_ID. Objects in storage are not touched.
 */
/**
 * Rotation (docs/RUNBOOK.md): add FILE_KEK_K2 to .env, set FILE_KEK_ID=k2, restart api + worker (new uploads use k2),
 * then run this with the database owner's URL:
 *   MIGRATE_DATABASE_URL=... FILE_KEK_ID=k2 FILE_KEK_K1=... FILE_KEK_K2=... node packages/db/scripts/rewrap-keys.mjs [--dry-run]
 * When it reports 0 remaining, FILE_KEK_K1 can be removed from .env. Each row is re-wrapped in its own small
 * transaction; the script can be stopped and run again at any time. Format must match packages/shared/src/file-crypto.ts:
 * wrapped = iv(12) || AES-256-GCM(DEK, 32) || tag(16), AAD "kek:<id>".
 */
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('MIGRATE_DATABASE_URL is required'); process.exit(1); }
const dry = process.argv.includes('--dry-run');
const keks = new Map();
for (const [k, v] of Object.entries(process.env)) {
  const m = k.match(/^FILE_KEK_([A-Z0-9]{1,16})$/);
  if (!m || m[1] === 'ID' || !v) continue;
  if (!/^[0-9a-f]{64}$/i.test(v)) { console.error(`${k} must be 64 hex characters`); process.exit(1); }
  keks.set(m[1].toLowerCase(), Buffer.from(v, 'hex'));
}
const current = (process.env.FILE_KEK_ID || '').toLowerCase();
if (!keks.has(current)) { console.error(`FILE_KEK_ID=${current} has no FILE_KEK_${current.toUpperCase()}`); process.exit(1); }

const unwrap = (wrapped, id) => {
  const d = crypto.createDecipheriv('aes-256-gcm', keks.get(id), wrapped.subarray(0, 12));
  d.setAAD(Buffer.from(`kek:${id}`)); d.setAuthTag(wrapped.subarray(wrapped.length - 16));
  return Buffer.concat([d.update(wrapped.subarray(12, wrapped.length - 16)), d.final()]);
};
const wrap = (dek, id) => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keks.get(id), iv);
  c.setAAD(Buffer.from(`kek:${id}`));
  return Buffer.concat([iv, c.update(dek), c.final(), c.getAuthTag()]);
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const result = {};
for (const table of ['statement_files', 'data_requests']) {
  let done = 0, missing = 0;
  const { rows } = await client.query(`select id, enc_key_id, wrapped_dek from public.${table} where wrapped_dek is not null and enc_key_id is distinct from $1`, [current]);
  for (const r of rows) {
    if (!keks.has(r.enc_key_id)) { missing++; continue; }                  // old key not provided: left for a later run
    const dek = unwrap(r.wrapped_dek, r.enc_key_id);
    const next = wrap(dek, current); dek.fill(0);
    if (!dry) {
      await client.query(`update public.${table} set wrapped_dek = $2, enc_key_id = $3 where id = $1 and enc_key_id = $4`, [r.id, next, current, r.enc_key_id]);
      await client.query(`insert into public.audit_log (action, meta) values ('kek_rewrap', $1)`, [JSON.stringify({ table, id: r.id, from: r.enc_key_id, to: current })]);
    }
    done++;
  }
  const { rows: left } = await client.query(`select count(*)::int as n from public.${table} where wrapped_dek is not null and enc_key_id is distinct from $1`, [current]);
  result[table] = { rewrapped: done, missingKey: missing, remaining: left[0].n };
}
await client.end();
console.log(JSON.stringify({ event: 'rewrap_keys', current, dryRun: dry, result }));
