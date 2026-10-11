/**
 * @file  apps/api/src/main.ts
 * @area  API
 * @what  Fastify API skeleton (Phase 2): /api/v1/health and /api/v1/ready (checks Postgres as lens_app, Redis, storage).
 */
/**
 * Phase 2 only proves the infrastructure: the API runs behind Caddy, connects to Postgres as the
 * least-privilege role, to Redis with a password, and can reach the S3 storage on the private network.
 * Real routes (auth, uploads, reports, payments, admin) arrive in Phase 4.
 */
import Fastify from 'fastify';
import pg from 'pg';
import { Redis } from 'ioredis';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === '') throw new Error(`${k} is not set`);
  return v;
};

const EXPECTED_DB_ROLE = 'lens_app';
const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 5, idleTimeoutMillis: 30_000 });
const redis = new Redis(env('REDIS_URL'), { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
const S3_ENDPOINT = env('S3_ENDPOINT');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
  trustProxy: true,
});

app.get('/api/v1/health', async () => ({ ok: true }));

/** Readiness: every dependency reachable, and the DB session really is the least-privilege role. */
app.get('/api/v1/ready', async (_req, reply) => {
  const checks: Record<string, string> = {};
  try {
    const { rows } = await pool.query('select current_user as u');
    checks.db = rows[0].u === EXPECTED_DB_ROLE ? 'ok' : `wrong_role:${rows[0].u}`;
  } catch { checks.db = 'down'; }
  try {
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
    checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'bad_reply';
  } catch { checks.redis = 'down'; }
  try {
    // Any HTTP answer (an unauthenticated request gets 403) means the S3 endpoint is up.
    const res = await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    checks.storage = res.status < 500 ? 'ok' : `status_${res.status}`;
  } catch { checks.storage = 'down'; }
  const ok = Object.values(checks).every((v) => v === 'ok');
  return reply.code(ok ? 200 : 503).send({ ok, checks });
});

const shutdown = async () => {
  await app.close().catch(() => {});
  await pool.end().catch(() => {});
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 4000) });
