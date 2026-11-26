/**
 * @file  apps/api/src/routes/market-iq.ts
 * @area  API
 * @what  Market IQ live sheets: GET /market-iq/access (may this user see them?), and for users with access /market-iq/status, /sheet/:underlying, /decoder/:underlying and /market, all proxied to the private data service (the only caller).
 */
import { z } from 'zod';
import { sql } from 'kysely';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser } from '../lib/http.js';
import { marketIqAccess, marketIqConfig, marketIqGet, MarketIqUnavailable, type AccessReason } from '../lib/market-iq.js';

/** The access decision for a signed-in user, read fresh from the DB (role, country, plan window). Also used by GET /me. */
export async function marketIqAccessFor(deps: Deps, userId: string): Promise<AccessReason> {
  const u = await deps.db.selectFrom('users').select(['role', 'country']).where('id', '=', userId).executeTakeFirst();
  const plan = await deps.db.selectFrom('subscriptions').select('id').where('user_id', '=', userId)
    .where(sql<boolean>`starts_at <= now() and ends_at > now()`).limit(1).executeTakeFirst();
  return marketIqAccess({ flag: (deps.config.marketIq ?? marketIqConfig()).access, role: u?.role, country: u?.country, hasActivePlan: !!plan });
}

export async function marketIqRoutes(app: App, deps: Deps) {
  const cfg = () => deps.config.marketIq ?? marketIqConfig();
  const decide = (userId: string) => marketIqAccessFor(deps, userId);

  app.get('/market-iq/access', { schema: { tags: ['market-iq'], security: [{ session: [] }], summary: 'May the signed-in user see the live Market sheets?' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    reply.header('Cache-Control', 'no-store');
    const reason = await decide(user.id);
    return ok(reply, { access: reason === 'ok', reason });
  });

  app.get('/market-iq/status', { schema: { tags: ['market-iq'], security: [{ session: [] }], summary: 'Market IQ data service status (users with access only)' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    reply.header('Cache-Control', 'no-store');
    const reason = await decide(user.id);
    if (reason === 'hidden') return fail(reply, 404, 'not_found');
    if (reason === 'no_plan') return fail(reply, 403, 'plan_required', 'The live Market sheets come with an active plan.');
    return proxy(reply, '/internal/status');
  });

  /** Fetch one data-service path for a user who already passed the access check. */
  async function proxy(reply: Parameters<typeof ok>[0], path: string) {
    try {
      return ok(reply, await marketIqGet<Record<string, unknown>>(cfg(), path, 8000));
    } catch (e) {
      if (e instanceof MarketIqUnavailable) return fail(reply, 503, 'unavailable', 'The market data service is not answering right now.');
      throw e;
    }
  }
  const guard = async (req: Parameters<typeof requireUser>[0], reply: Parameters<typeof ok>[0]) => {
    const user = await requireUser(req, reply); if (!user) return null;
    reply.header('Cache-Control', 'no-store');
    const reason = await decide(user.id);
    if (reason === 'hidden') { fail(reply, 404, 'not_found'); return null; }
    if (reason === 'no_plan') { fail(reply, 403, 'plan_required', 'The live Market sheets come with an active plan.'); return null; }
    return user;
  };
  const UNDERLYING = z.enum(['NIFTY', 'BANKNIFTY']);
  const AT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional();
  const EXPIRY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
    const t = p.toString();
    return t ? `?${t}` : '';
  };

  app.get('/market-iq/sheet/:underlying', { schema: { tags: ['market-iq'], security: [{ session: [] }], summary: 'Nifty or Bank Nifty sheet (live, or at a minute of today)',
    params: z.object({ underlying: UNDERLYING }), querystring: z.object({ expiry: EXPIRY, at: AT }) } }, async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return proxy(reply, `/internal/sheet/${req.params.underlying}${qs(req.query)}`);
  });

  app.get('/market-iq/decoder/:underlying', { schema: { tags: ['market-iq'], security: [{ session: [] }], summary: 'Strike decoder for one option',
    params: z.object({ underlying: UNDERLYING }), querystring: z.object({ strike: z.coerce.number().positive(), side: z.enum(['ce', 'pe']), expiry: EXPIRY, at: AT }) } }, async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return proxy(reply, `/internal/decoder/${req.params.underlying}${qs(req.query)}`);
  });

  app.get('/market-iq/market', { schema: { tags: ['market-iq'], security: [{ session: [] }], summary: 'Market sheet: breadth, flows, scanners, movers' } }, async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return proxy(reply, '/internal/market');
  });
}
