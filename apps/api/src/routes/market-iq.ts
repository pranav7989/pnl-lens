/**
 * @file  apps/api/src/routes/market-iq.ts
 * @area  API
 * @what  Market IQ live sheets: GET /market-iq/access (may this user see them?) and GET /market-iq/status (service status, for users with access); the private data service is called only from here.
 */
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
    try {
      return ok(reply, { fresh: true, ...(await marketIqGet<Record<string, unknown>>(cfg(), '/internal/status')) });
    } catch (e) {
      if (e instanceof MarketIqUnavailable) return fail(reply, 503, 'unavailable', 'The market data service is not answering right now.');
      throw e;
    }
  });
}
