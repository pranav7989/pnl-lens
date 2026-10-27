/**
 * @file  apps/api/src/routes/me.ts
 * @area  Auth
 * @what  GET /me (ported), GET /plans, consents (GET/POST /me/consents), POST /me/export, POST /me/delete and DELETE /me.
 */
import { z } from 'zod';
import { plansFor } from '@pnl-lens/shared/pricing';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { clientCountry } from '@pnl-lens/shared/auth/request';
import { SESSION_COOKIE } from '@pnl-lens/shared/auth/session';
import { CONSENT_POLICY_VERSION, consentTextSha256 } from '@pnl-lens/shared/consent';
import { userPlans, currentConsents, recordConsent, requestData, deleteAccount } from '@pnl-lens/db';
import { decryptFile } from '@pnl-lens/shared/file-crypto';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, sessionUser, asFetchLike, ipHash, ipOf, UUID } from '../lib/http.js';

export async function meRoutes(app: App, deps: Deps) {
  /** Current user + credits; also records daily activity for DAU/MAU (same as GET /api/me). */
  app.get('/me', { schema: { tags: ['me'], summary: 'Current user and credits', security: [{ session: [] }] } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    await trackWith(deps.pool, user.id, 'active');
    const r = await deps.db.selectFrom('credits').select('balance').where('user_id', '=', user.id).executeTakeFirst();
    // role: read from the DB on every request (never from the token), so the web can show or hide the admin console
    const u = await deps.db.selectFrom('users').select(['role', 'password_hash', 'google_sub']).where('id', '=', user.id).executeTakeFirst();
    // hasPassword / needsPassword: email accounts must set a password after the first code (never the hash itself)
    const hasPassword = !!u?.password_hash, dev = (process.env.AUTH_MODE || 'dev') === 'dev';
    // reportsLeft: usable reports of plans whose window is open (customer screens); credits: internal mirror (admin only)
    const { rows: left } = await deps.pool.query('select public.user_reports_left($1) as n', [user.id]);
    return ok(reply, { user: { id: user.id, country: user.country }, credits: r?.balance ?? 0, reportsLeft: left[0]?.n ?? 0, role: u?.role ?? 'user',
      hasPassword, needsPassword: !hasPassword && !u?.google_sub && !dev });
  });

  /** Plans and prices for the visitor's country (server-side, never from the browser); plus the user's own plans when signed in. */
  app.get('/plans', { schema: { tags: ['plans'], summary: 'Plans, prices and (signed in) my plans' } }, async (req, reply) => {
    const user = await sessionUser(req);
    const country = clientCountry(asFetchLike(req)) || user?.country || null;
    const mine = user ? (await userPlans(deps.db, user.id)).map((p) => ({
      id: p.id, planId: p.plan_id, reportsTotal: p.reports_total, reportsUsed: p.reports_used, filesPerReport: p.files_per_report,
      startsAt: p.starts_at, endsAt: p.ends_at, active: p.active,
    })) : null;
    return ok(reply, { plans: plansFor(country), mine });
  });

  app.get('/me/consents', { schema: { tags: ['privacy'], summary: 'My current consents', security: [{ session: [] }] } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    return ok(reply, { ...(await currentConsents(deps.db, user.id)), policyVersion: CONSENT_POLICY_VERSION });
  });

  /** Research use is a separate opt-in, off by default, and can be withdrawn at any time (rule 7). */
  app.post('/me/consents', {
    schema: { tags: ['privacy'], summary: 'Change the optional research consent', security: [{ session: [] }],
      body: z.object({ purpose: z.literal('research'), granted: z.boolean() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    await recordConsent(deps.db, {
      userId: user.id, purpose: 'research', granted: req.body.granted, policyVersion: CONSENT_POLICY_VERSION,
      textSha256: consentTextSha256('research'), ipHash: ipHash(deps.config.ipHashSecret, ipOf(req)),
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    return ok(reply, await currentConsents(deps.db, user.id));
  });

  /** Asks for an export of all my data. The worker builds the archive (Phase 6); one open request at a time. */
  app.post('/me/export', { schema: { tags: ['privacy'], summary: 'Request an export of my data', security: [{ session: [] }] } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const r = await requestData(deps.db, user.id, 'export');
    await deps.queue.enqueueExport(r.id);
    return ok(reply, { request: { id: r.id, status: r.status, requestedAt: r.requested_at } }, 202);
  });

  /** My export requests, newest first, with whether the archive can still be downloaded (7 days). */
  app.get('/me/exports', { schema: { tags: ['privacy'], summary: 'My data-export requests', security: [{ session: [] }] } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const rows = await deps.db.selectFrom('data_requests').select(['id', 'status', 'requested_at', 'completed_at', 'expires_at', 'size_bytes', 'result_key'])
      .where('user_id', '=', user.id).where('kind', '=', 'export').orderBy('requested_at', 'desc').limit(10).execute();
    return ok(reply, { exports: rows.map((r) => ({
      id: r.id, status: r.status, requestedAt: r.requested_at, completedAt: r.completed_at, expiresAt: r.expires_at,
      sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
      downloadable: r.status === 'done' && !!r.result_key && !!r.expires_at && new Date(r.expires_at) > new Date(),
    })) });
  });

  /** Download my export archive (owner only; decrypted on the fly; recorded in the audit log). */
  app.get('/me/export/:id', { schema: { tags: ['privacy'], summary: 'Download my data export (ZIP)', security: [{ session: [] }], params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const r = await deps.db.selectFrom('data_requests').select(['id', 'status', 'result_key', 'enc_key_id', 'wrapped_dek', 'iv', 'expires_at'])
      .where('id', '=', req.params.id).where('user_id', '=', user.id).where('kind', '=', 'export').executeTakeFirst();
    if (!r) return fail(reply, 404, 'not_found');
    if (r.status !== 'done') return fail(reply, 409, 'not_ready', 'Your export is still being prepared. Try again in a minute.');
    if (!r.result_key || !r.wrapped_dek || !r.iv || !r.expires_at || new Date(r.expires_at) <= new Date()) return fail(reply, 410, 'expired', 'This export has expired. Request a new one.');
    const kek = deps.config.keks.all.get(r.enc_key_id || '');
    if (!kek) throw new Error(`export key ${r.enc_key_id} is not configured`);
    const zip = decryptFile(await deps.storage.getExport(r.result_key), r.iv, r.wrapped_dek, kek);
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta, ip) values ($1, 'data_export_downloaded', $2, $3::inet)`, [user.id, JSON.stringify({ request: r.id }), ipOf(req)]);
    return reply.header('Content-Type', 'application/zip').header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="pnl-lens-export-${new Date().toISOString().slice(0, 10)}.zip"`).send(zip);
  });

  /** Closes the account now: reports, trades and files go; payments and consent proof stay (billing law). */
  const remove = async (req: any, reply: any) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (req.body?.confirm !== true) return fail(reply, 400, 'confirm_required', 'Confirm that you want to delete your account.');
    await deleteAccount(deps.db, user.id);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).header('Cache-Control', 'no-store').send({ deleted: true });
  };
  const delSchema = { tags: ['privacy'], summary: 'Delete my account and data', security: [{ session: [] }], body: z.object({ confirm: z.literal(true) }) };
  app.post('/me/delete', { attachValidation: true, schema: delSchema }, remove);
  app.delete('/me', { attachValidation: true, schema: delSchema }, remove);
}
