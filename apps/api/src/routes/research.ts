/**
 * @file  apps/api/src/routes/research.ts
 * @area  Admin
 * @what  Research datasets (owner only): list, "Build now", download (decrypted from the exports bucket, every download audited), and find who a subject or report code belongs to (reason required, audited).
 */
/**
 * GET  /admin/research/exports                 list (status, counts, size, expiry) + how many users opted in
 * POST /admin/research/exports                 "Build now" (one at a time; the worker builds it)
 * GET  /admin/research/exports/:id/download    the ZIP (no-store), written to audit_log
 * POST /admin/research/lookup                  subject or report code -> account (research_lookup, 0025; owner, reason, audited)
 * The datasets are built by apps/worker/src/research.ts from the pseudonymised research views (opted-in users only).
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Role } from '@pnl-lens/shared/admin/rbac';
import { decryptFile } from '@pnl-lens/shared/file-crypto';
import type { App, Deps } from '../app.js';
import { fail, ok, sessionUser, ipOf, UUID } from '../lib/http.js';

export async function researchRoutes(app: App, deps: Deps) {
  /** Owner only; the role is read from the database on every request. */
  async function owner(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const u = await sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    const { rows } = await deps.pool.query('select role from public.users where id = $1', [u.id]);
    if (!can((rows[0]?.role as Role) || 'user', 'research:export')) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return u.id;
  }
  const admin = { tags: ['admin'], security: [{ session: [] }] };

  app.get('/admin/research/exports', { schema: { ...admin, summary: 'Research datasets and the number of opted-in users' } }, async (req, reply) => {
    if (!(await owner(req, reply))) return;
    const { rows } = await deps.pool.query(`select id, status, subjects, reports, trades, size_bytes::bigint as size_bytes, error, created_at, completed_at, expires_at,
        deleted_at, requested_by is null as scheduled from public.research_exports order by created_at desc limit 50`);
    // opted-in users: latest research consent is yes and the account is active (same rule as the research views)
    const { rows: c } = await deps.pool.query(`select count(*)::int as n from (select distinct on (user_id) user_id, granted from public.consents
        where purpose = 'research' order by user_id, created_at desc, id desc) x join public.users u on u.id = x.user_id where x.granted and u.status = 'active'`);
    return ok(reply, { exports: rows.map((r) => ({ ...r, size_bytes: r.size_bytes === null ? null : Number(r.size_bytes), downloadable: r.status === 'ready' && !r.deleted_at })), optedIn: c[0].n });
  });

  app.post('/admin/research/exports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { ...admin, summary: 'Build a research dataset now' } }, async (req, reply) => {
    const who = await owner(req, reply); if (!who) return;
    try {
      const { rows } = await deps.pool.query('insert into public.research_exports (requested_by) values ($1) returning id', [who]);
      await deps.queue.enqueueResearch(rows[0].id);
      await deps.pool.query(`insert into public.audit_log (user_id, action, meta, ip) values ($1, 'research_export_requested', $2, $3::inet)`, [who, JSON.stringify({ export: rows[0].id }), ipOf(req)]);
      return ok(reply, { id: rows[0].id }, 202);
    } catch (e: any) {
      if (e?.code === '23505') return fail(reply, 409, 'already_building', 'A dataset is already being built. Refresh in a minute.');
      throw e;
    }
  });

  app.get('/admin/research/exports/:id/download', { schema: { ...admin, summary: 'Download a research dataset (ZIP)', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const who = await owner(req, reply); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    const { rows } = await deps.pool.query(`select status, storage_key, enc_key_id, wrapped_dek, iv, expires_at, deleted_at, created_at from public.research_exports where id = $1`, [id]);
    const r = rows[0];
    if (!r || r.status !== 'ready' || r.deleted_at || !r.storage_key || new Date(r.expires_at) <= new Date()) return fail(reply, 404, 'not_found', 'This dataset is not available.');
    const kek = deps.config.keks.all.get(r.enc_key_id || '');
    if (!kek) throw new Error(`research key ${r.enc_key_id} is not configured`);
    const zip = decryptFile(await deps.storage.getExport(r.storage_key), r.iv, r.wrapped_dek, kek);
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta, ip) values ($1, 'research_export_downloaded', $2, $3::inet)`, [who, JSON.stringify({ export: id, bytes: zip.length }), ipOf(req)]);
    return reply.header('Content-Type', 'application/zip').header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="pnl-lens-research-${new Date(r.created_at).toISOString().slice(0, 10)}.zip"`).send(zip);
  });

  const LOOKUP_ERRORS: Record<string, [number, string]> = {
    reason_required: [400, 'Give a reason for this lookup (3 characters or more).'],
    export_required: [400, 'A report code belongs to one dataset. Choose the dataset it came from.'],
    invalid_code: [400, 'Paste a subject code (64 characters) or a report code (24 characters) from the dataset.'],
  };
  app.post('/admin/research/lookup', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { ...admin, summary: 'Find the account behind a subject or report code (owner only, audited)',
      body: z.object({ code: z.string().max(80), exportId: z.string().nullable().optional(), reason: z.string().max(500) }) },
  }, async (req, reply) => {
    const who = await owner(req, reply); if (!who) return;
    const { code, reason } = req.body;
    const exportId = req.body.exportId || null;
    if (exportId && !UUID.test(exportId)) return fail(reply, 404, 'not_found');
    try {
      const { rows } = await deps.pool.query('select * from public.research_lookup($1, $2, $3, $4)', [who, code, exportId, reason]);
      const r = rows[0];
      if (!r) return fail(reply, 404, 'not_found', 'No account matches this code.');
      return ok(reply, {
        kind: r.kind,
        user: { id: r.user_id, email: r.email, status: r.user_status },
        report: r.report_id ? { id: r.report_id, name: r.report_name, createdAt: new Date(r.report_created_at).toISOString(), deleted: r.report_deleted } : null,
      });
    } catch (e: any) {
      const known = e?.code === 'P0001' && LOOKUP_ERRORS[e.message];
      if (known) return fail(reply, known[0], e.message, known[1]);
      if (e?.code === '42501') return fail(reply, 403, 'forbidden');
      throw e;
    }
  });
}
