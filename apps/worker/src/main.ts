/**
 * @file  apps/worker/src/main.ts
 * @area  Worker
 * @what  Worker skeleton (Phase 2): checks Postgres (as lens_worker), Redis and storage every 30 s; local health endpoint.
 */
/**
 * Phase 2 only proves the infrastructure: the worker lives on the internal network (no internet),
 * logs in as lens_worker, and reaches Redis and the S3 storage. BullMQ processing arrives in Phase 5.
 * Health is served on 127.0.0.1 inside the container only (used by the Docker healthcheck).
 */
import http from 'node:http';
import pg from 'pg';
import { Redis } from 'ioredis';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const EXPECTED_DB_ROLE = 'lens_worker';
const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 2 });
const redis = new Redis(env('REDIS_URL'), { maxRetriesPerRequest: 1 });
const S3_ENDPOINT = env('S3_ENDPOINT');

let last: { ok: boolean; checks: Record<string, string>; at: string } = { ok: false, checks: {}, at: '' };
const log = (event: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), service: 'worker', event, ...extra }));

async function check() {
  const checks: Record<string, string> = {};
  try {
    const { rows } = await pool.query('select current_user as u');
    checks.db = rows[0].u === EXPECTED_DB_ROLE ? 'ok' : `wrong_role:${rows[0].u}`;
  } catch { checks.db = 'down'; }
  try { checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'bad_reply'; } catch { checks.redis = 'down'; }
  try {
    const res = await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    checks.storage = res.status < 500 ? 'ok' : `status_${res.status}`;
  } catch { checks.storage = 'down'; }
  const ok = Object.values(checks).every((v) => v === 'ok');
  if (ok !== last.ok) log(ok ? 'ready' : 'not_ready', { checks });
  last = { ok, checks, at: new Date().toISOString() };
}

const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/health' && last.ok ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(last));
});
server.listen(4100, '127.0.0.1');

await check();
const timer = setInterval(() => { check().catch(() => {}); }, 30_000);
log('started');

const shutdown = async () => {
  clearInterval(timer);
  server.close();
  await pool.end().catch(() => {});
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
