/**
 * @file  apps/api/src/routes/telemetry.ts
 * @area  Admin
 * @what  POST /events (allow-listed product events; two landing events also from visitors) and POST /errors (browser errors); always 204.
 */
import { z } from 'zod';
import { trackWith, captureErrorWith, CLIENT_EVENTS, ANON_EVENTS } from '@pnl-lens/shared/admin/telemetry';
import type { App, Deps } from '../app.js';
import { sessionUser } from '../lib/http.js';

export async function telemetryRoutes(app: App, deps: Deps) {
  const lenient = { attachValidation: true, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  /** POST { name, props } from the browser (allow-listed names only). */
  app.post('/events', { ...lenient, schema: { tags: ['telemetry'], summary: 'Product event', body: z.object({ name: z.string(), props: z.record(z.string(), z.unknown()).optional() }) } }, async (req, reply) => {
    const u = await sessionUser(req);
    const b = req.body as any;
    // signed-in: any allow-listed event; visitors (landing page): only the anonymous landing events, stored without a user
    if (typeof b?.name === 'string' && CLIENT_EVENTS.has(b.name) && (u || ANON_EVENTS.has(b.name))) {
      await trackWith(deps.pool, u?.id ?? null, b.name, b.props && typeof b.props === 'object' ? b.props : undefined);
    }
    return reply.code(204).send();
  });

  /** POST { message, stack, route } — browser errors for the error center. */
  app.post('/errors', { ...lenient, schema: { tags: ['telemetry'], summary: 'Browser error', body: z.object({ message: z.string(), stack: z.string().optional(), route: z.string().optional() }) } }, async (req, reply) => {
    const u = await sessionUser(req);
    const b = req.body as any;
    if (typeof b?.message === 'string' && b.message) {
      const e = new Error(b.message.slice(0, 500)); e.stack = typeof b.stack === 'string' ? b.stack.slice(0, 4000) : '';
      await captureErrorWith(deps.pool, e, { source: 'client', route: typeof b.route === 'string' ? b.route.slice(0, 200) : undefined, userId: u?.id, context: { ua: (req.headers['user-agent'] as string | undefined)?.slice(0, 200) } });
    }
    return reply.code(204).send();
  });
}
