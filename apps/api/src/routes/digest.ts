/**
 * @file  apps/api/src/routes/digest.ts
 * @area  Reports
 * @what  Weekly summary email settings: read and switch my opt-in; stop it from the link in an email (no sign-in, HMAC token).
 */
import { z } from 'zod';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, UUID } from '../lib/http.js';
import { tokenOk } from '../lib/digest.js';

export async function digestRoutes(app: App, deps: Deps) {
  const s = { tags: ['me'], security: [{ session: [] }] };

  app.get('/me/prefs', { schema: { ...s, summary: 'My email preferences' } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const r = await deps.db.selectFrom('users').select('weekly_digest').where('id', '=', user.id).executeTakeFirst();
    return ok(reply, { weeklyDigest: !!r?.weekly_digest });
  });

  app.put('/me/prefs', { schema: { ...s, summary: 'Turn the weekly summary email on or off', body: z.object({ weeklyDigest: z.boolean() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    await deps.db.updateTable('users').set({ weekly_digest: req.body.weeklyDigest }).where('id', '=', user.id).execute();
    await trackWith(deps.pool, user.id, 'weekly_digest_set', { on: req.body.weeklyDigest });
    return ok(reply, { weeklyDigest: req.body.weeklyDigest });
  });

  // from the "Stop these emails" link: the token proves the email was ours; POST so link scanners cannot unsubscribe
  app.post('/digest/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['me'], summary: 'Stop the weekly summary (link in the email)', body: z.object({ u: z.string(), t: z.string().max(64) }) },
  }, async (req, reply) => {
    const { u, t } = req.body;
    if (!UUID.test(u) || !tokenOk(deps.config.ipHashSecret, u, t)) return fail(reply, 400, 'bad_link', 'This link is not valid. You can turn the summary off in Dashboard → Your data.');
    await deps.db.updateTable('users').set({ weekly_digest: false }).where('id', '=', u).execute();
    await trackWith(deps.pool, u, 'weekly_digest_set', { on: false, via: 'email' });
    return ok(reply, { weeklyDigest: false });
  });
}
