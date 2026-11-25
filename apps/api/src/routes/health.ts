/**
 * @file  apps/api/src/routes/health.ts
 * @area  API
 * @what  GET /health (liveness) and GET /ready (Postgres as lens_app, Redis, storage).
 */
import { z } from 'zod';
import type { App, Deps } from '../app.js';

export async function healthRoutes(app: App, deps: Deps) {
  app.get('/health', { schema: { tags: ['ops'], summary: 'Liveness', response: { 200: z.object({ ok: z.literal(true) }) } } }, async () => ({ ok: true as const }));

  /** Readiness: every dependency reachable, and the DB session really is the least-privilege role. */
  app.get('/ready', { config: { rateLimit: false }, schema: { tags: ['ops'], summary: 'Readiness (DB role, Redis, storage)' } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      const { rows } = await deps.pool.query('select current_user as u');
      checks.db = rows[0].u === 'lens_app' ? 'ok' : `wrong_role:${rows[0].u}`;
    } catch { checks.db = 'down'; }
    if (deps.redis) {
      try {
        if (deps.redis.status === 'wait' || deps.redis.status === 'end') await deps.redis.connect();
        checks.redis = (await deps.redis.ping()) === 'PONG' ? 'ok' : 'bad_reply';
      } catch { checks.redis = 'down'; }
    } else checks.redis = 'not_configured';
    checks.storage = await deps.storage.check();
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
}
