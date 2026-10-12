#!/usr/bin/env node
/**
 * @file  infra/scripts/storage-init.mjs
 * @area  Ops
 * @what  One-off, idempotent Garage setup via its admin API: node layout, private bucket, and least-privilege S3 keys.
 */
/**
 * Garage (S3-compatible storage, replaces MinIO — plan decision D14) ships as a shell-less image,
 * so setup runs here against the admin API v2 (https://garagehq.deuxfleurs.fr/api/garage-admin-v2.json).
 *   1. single-node layout (zone dc1, capacity STORAGE_CAPACITY_BYTES), applied once
 *   2. bucket S3_BUCKET (private: no website access, no anonymous access)
 *   3. keys imported from env (never generated here, so they live only in .env / server env):
 *        api    → write only  (puts encrypted uploads; cannot read files back)
 *        worker → read + write (reads files to parse; write is what S3 needs for delete/purge)
 * Safe to run on every `up`: each step checks current state first.
 */
const env = (k, d) => {
  const v = process.env[k] ?? d;
  if (!v) { console.error(`${k} is not set`); process.exit(1); }
  return v;
};
const ADMIN = env('GARAGE_ADMIN_URL', 'http://garage:3903');
const TOKEN = env('GARAGE_ADMIN_TOKEN');
const BUCKET = env('S3_BUCKET', 'statements');
const EXPORT_BUCKET = env('S3_EXPORT_BUCKET', 'exports');
const CAPACITY = Number(env('STORAGE_CAPACITY_BYTES', String(10_000_000_000)));
const KEYS = [
  { name: 'pnl-lens-api', id: env('S3_API_ACCESS_KEY_ID'), secret: env('S3_API_SECRET_ACCESS_KEY') },
  { name: 'pnl-lens-worker', id: env('S3_WORKER_ACCESS_KEY_ID'), secret: env('S3_WORKER_SECRET_ACCESS_KEY') },
];
// Least privilege per bucket. statements: the api can only upload; the worker reads and deletes (purge).
// exports (Phase 7, "export my data"): the worker writes and deletes expired archives; the api can only read them.
const GRANTS = {
  [BUCKET]: { 'pnl-lens-api': { allow: { write: true }, deny: { read: true, owner: true } }, 'pnl-lens-worker': { allow: { read: true, write: true }, deny: { owner: true } } },
  [EXPORT_BUCKET]: { 'pnl-lens-api': { allow: { read: true }, deny: { write: true, owner: true } }, 'pnl-lens-worker': { allow: { write: true }, deny: { read: true, owner: true } } },
};

async function call(method, op, { query, body } = {}) {
  const url = `${ADMIN}/v2/${op}${query ? '?' + new URLSearchParams(query) : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  return { status: res.status, data };
}
const must = async (...a) => {
  const r = await call(...a);
  if (r.status !== 200) throw new Error(`${a[1]} → HTTP ${r.status}: ${typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}`);
  return r.data;
};
const log = (m) => console.log(`storage-init: ${m}`);

// 0. wait for the admin API
for (let i = 0; ; i++) {
  try { const r = await call('GET', 'GetClusterStatus'); if (r.status === 200) break; } catch { /* not up yet */ }
  if (i > 30) throw new Error('Garage admin API did not come up');
  await new Promise((r) => setTimeout(r, 1000));
}

// 1. layout
const status = await must('GET', 'GetClusterStatus');
const node = status.nodes[0];
if (!node.role) {
  const layout = await must('GET', 'GetClusterLayout');
  await must('POST', 'UpdateClusterLayout', { body: { roles: [{ id: node.id, zone: 'dc1', capacity: CAPACITY, tags: ['single'] }] } });
  await must('POST', 'ApplyClusterLayout', { body: { version: layout.version + 1 } });
  log(`layout applied (node ${node.id.slice(0, 16)}…, ${CAPACITY} bytes)`);
} else log('layout already set');

// 2. buckets (private)
const buckets = {};
for (const name of Object.keys(GRANTS)) {
  let b = await call('GET', 'GetBucketInfo', { query: { globalAlias: name } });
  if (b.status === 200) { b = b.data; log(`bucket ${name} exists`); }
  else { b = await must('POST', 'CreateBucket', { body: { globalAlias: name } }); log(`bucket ${name} created`); }
  if (b.websiteAccess) throw new Error(`bucket ${name} has website (public) access enabled — refusing`);
  buckets[name] = b;
}

// 3. keys + permissions
for (const k of KEYS) {
  if (!/^GK[0-9a-f]{24}$/.test(k.id) || !/^[0-9a-f]{64}$/.test(k.secret)) throw new Error(`${k.name}: key id must be GK+24 hex, secret 64 hex (run: npm run stack:env)`);
  const info = await call('GET', 'GetKeyInfo', { query: { id: k.id, showSecretKey: 'true' } });
  if (info.status === 200) {
    if (info.data.secretAccessKey !== k.secret) throw new Error(`${k.name}: key ${k.id} exists with a different secret. Remove the garage volumes or restore the old secret in .env.`);
    log(`key ${k.name} exists`);
  } else {
    await must('POST', 'ImportKey', { body: { accessKeyId: k.id, secretAccessKey: k.secret, name: k.name } });
    log(`key ${k.name} imported`);
  }
  for (const [name, perKey] of Object.entries(GRANTS)) {
    const g = perKey[k.name];
    await must('POST', 'DenyBucketKey', { body: { bucketId: buckets[name].id, accessKeyId: k.id, permissions: g.deny } });
    await must('POST', 'AllowBucketKey', { body: { bucketId: buckets[name].id, accessKeyId: k.id, permissions: g.allow } });
    log(`key ${k.name}: ${Object.keys(g.allow).join('+')} on ${name}`);
  }
}
log('done');
