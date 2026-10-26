/**
 * @file  apps/api/src/routes/admin.ts
 * @area  Admin
 * @what  Admin console API ported from apps/web/app/api/admin/* (role read from the DB each request, every read audited) plus the owner-only manual plan grant (D5).
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, assignable, type Perm, type Role } from '@pnl-lens/shared/admin/rbac';
import { adminQueries } from '@pnl-lens/shared/admin/queries';
import { normaliseEmail } from '@pnl-lens/shared/auth/otp';
import { PLANS, planDays } from '@pnl-lens/shared/pricing';
import { adminGrantPlan, isDbError } from '@pnl-lens/db';
import type { App, Deps } from '../app.js';
import { fail, ok, sessionUser } from '../lib/http.js';

const TABS: Record<string, Perm> = { users: 'tab:users', finance: 'tab:finance', errors: 'tab:errors', support: 'tab:support', product: 'tab:product' };

export async function adminRoutes(app: App, deps: Deps) {
  const aq = adminQueries(deps.pool);
  const audit = (userId: string, action: string, meta: unknown) =>
    deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, $2, $3)`, [userId, action, JSON.stringify(meta)]).catch(() => {});

  /** Same as apps/web requirePerm(): 401 { error: 'unauthorized' } / 403 { error: 'forbidden' }. */
  async function requirePerm(req: FastifyRequest, reply: FastifyReply, perm: Perm): Promise<{ id: string; role: Role } | null> {
    const u = await sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    const { rows } = await deps.pool.query('select role from public.users where id = $1', [u.id]);
    const role = (rows[0]?.role as Role) || 'user';
    if (!can(role, perm)) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { id: u.id, role };
  }
  const s = { tags: ['admin'], security: [{ session: [] }] };

  /** GET ?tab=users|finance|errors|support|product — metrics for one admin tab (permission checked per tab). */
  app.get('/admin/metrics', { schema: { ...s, summary: 'Metrics for one admin tab', querystring: z.object({ tab: z.string().optional() }) } }, async (req, reply) => {
    const tab = (req.query as any).tab || '';
    if (!TABS[tab]) return fail(reply, 400, 'bad_tab', 'Unknown tab');
    const who = await requirePerm(req, reply, TABS[tab]); if (!who) return;
    const data = tab === 'users' ? await aq.usersTab(can(who.role, 'user:pii')) : tab === 'finance' ? await aq.financeTab() : tab === 'errors' ? await aq.errorsTab() : tab === 'support' ? await aq.supportTab() : await aq.productTab();
    await audit(who.id, 'admin_view', { tab });
    return ok(reply, data);
  });

  /** POST { email, role } — owners assign any role; admins anything except owner. Nobody can change their own role. */
  app.post('/admin/roles', { attachValidation: true, schema: { ...s, summary: 'Assign a role', body: z.object({ email: z.string(), role: z.string() }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'roles:manage'); if (!who) return;
    const b = req.body as any;
    const email = normaliseEmail(b?.email), role = b?.role as Role;
    if (!email || !assignable(who.role).includes(role)) return fail(reply, 403, 'forbidden', 'You can’t assign that role.');
    const { rows } = await deps.pool.query(`select id, role from public.users where email = $1`, [email]);
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No user with that email.');
    if (rows[0].id === who.id) return fail(reply, 403, 'forbidden', 'You can’t change your own role.');
    if (rows[0].role === 'owner' && who.role !== 'owner') return fail(reply, 403, 'forbidden', 'Only an owner can change an owner.');
    await deps.pool.query(`update public.users set role = $2 where id = $1`, [rows[0].id, role]);
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, 'role_change', $2)`, [who.id, JSON.stringify({ email, from: rows[0].role, to: role })]);
    return ok(reply, { ok: true });
  });

  /** PATCH { id, status?, notes? } — update a support ticket. */
  app.patch('/admin/tickets', {
    attachValidation: true,
    schema: { ...s, summary: 'Update a support ticket', body: z.object({ id: z.number().int(), status: z.enum(['open', 'in_progress', 'resolved']).optional(), notes: z.string().optional() }) },
  }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'tab:support'); if (!who) return;
    const b = req.body as any;
    if (!Number.isInteger(b?.id) || (b.status && !['open', 'in_progress', 'resolved'].includes(b.status))) return fail(reply, 400, 'invalid', 'Bad request');
    const { rowCount } = await deps.pool.query(`update public.support_tickets set status = coalesce($2, status), notes = coalesce($3, notes), assigned_to = coalesce(assigned_to, $4), updated_at = now() where id = $1`, [b.id, b.status || null, typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null, who.id]);
    await audit(who.id, 'ticket_update', b);
    return rowCount ? ok(reply, { ok: true }) : fail(reply, 404, 'not_found', 'Ticket not found');
  });

  /** GET ?email= — support lookup: profile, likely cause and full timeline for one user. */
  app.get('/admin/user', { schema: { ...s, summary: 'Support lookup for one user', querystring: z.object({ email: z.string().optional() }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'user:lookup'); if (!who) return;
    const email = normaliseEmail((req.query as any).email);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email.');
    const data = await aq.userLookup(email);
    await audit(who.id, 'admin_user_lookup', { email });
    return data ? ok(reply, data) : fail(reply, 404, 'not_found', 'No user with that email.');
  });

  /**
   * POST { email, planId, reason } — owner-only manual plan grant (approved exception to rule 6, plan D5). Plan values
   * come from PLANS; the DB re-checks the owner role, requires the reason and writes audit_log.
   */
  app.post('/admin/grants', {
    attachValidation: true,
    schema: { ...s, summary: 'Owner only: grant a plan by hand (reason required, audited)', body: z.object({ email: z.string(), planId: z.enum(['single', 'snapshot', 'progress', 'discipline']), reason: z.string().max(500) }) },
  }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'plans:grant'); if (!who) return;
    const b = req.body as any;
    const email = normaliseEmail(b?.email), plan = PLANS.find((p) => p.id === b?.planId);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email.');
    if (!plan) return fail(reply, 400, 'bad_plan', 'Unknown plan');
    if (typeof b?.reason !== 'string' || b.reason.trim().length < 3) return fail(reply, 400, 'reason_required', 'Write the reason for this grant.');
    const { rows } = await deps.pool.query('select id from public.users where email = $1', [email]);
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No user with that email.');
    try {
      const id = await adminGrantPlan(deps.db, { actorId: who.id, userId: rows[0].id, plan: plan.id, reports: plan.reports, filesPerReport: plan.filesPerReport, days: planDays(plan), reason: b.reason });
      return ok(reply, { ok: true, subscriptionId: id }, 201);
    } catch (e) {
      if (isDbError(e, 'forbidden')) return reply.code(403).send({ error: 'forbidden' });
      if (isDbError(e, 'reason_required')) return fail(reply, 400, 'reason_required', 'Write the reason for this grant.');
      throw e;
    }
  });
}
