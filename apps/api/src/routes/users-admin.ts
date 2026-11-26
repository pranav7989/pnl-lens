/**
 * @file  apps/api/src/routes/users-admin.ts
 * @area  Admin
 * @what  Admin user management: user list with research status, "Request reports" email (owner), restrict / unrestrict (owner, admin), delete (owner); the public one-click consent link.
 */
/**
 * Research status per user (same rule as the research views and datasets):
 *   included       latest research consent yes AND at least one live report
 *   opted_in       consent yes, no live reports yet
 *   declined       latest research consent no
 *   asked          an open invite (sent, not answered, not expired)
 *   not_asked      none of the above
 * Invites: one 32-byte random token per email; only its SHA-256 is stored. Answering appends a consents row with the
 * exact research wording's hash, the policy version and a hashed IP — the same proof as the upload checkbox.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Perm, type Role } from '@pnl-lens/shared/admin/rbac';
import { researchInviteEmail } from '@pnl-lens/shared/mail';
import { CONSENT_POLICY_VERSION, consentTextSha256 } from '@pnl-lens/shared/consent';
import { adminSetUserStatus, adminDeleteUser, recordConsent, isDbError } from '@pnl-lens/db';
import type { App, Deps } from '../app.js';
import { fail, ok, sessionUser, ipOf, ipHash, UUID } from '../lib/http.js';

const INVITE_GAP_DAYS = 90, DECLINE_GAP_DAYS = 180;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** One query for the list and for single-user checks; :where / :params are filled by the caller. */
const USER_ROWS = `
  with cur as (
    select distinct on (user_id) user_id, granted, created_at from public.consents where purpose = 'research'
     order by user_id, created_at desc, id desc),
  inv as (
    select distinct on (user_id) user_id, created_at, expires_at, answered_at, answer from public.research_invites
     order by user_id, created_at desc),
  base as (
    select u.id, u.email, u.role, u.status, u.country, u.created_at, u.last_login_at, u.restricted_reason, u.restricted_at,
           (u.password_hash is not null) as has_password, (u.google_sub is not null) as has_google,
           (select count(*)::int from public.reports r where r.user_id = u.id and r.purged_at is null) as reports,
           (select s.plan_id from public.subscriptions s where s.user_id = u.id and s.ends_at > now() order by s.ends_at desc limit 1) as plan,
           cur.granted as consent, cur.created_at as consent_at,
           inv.created_at as invited_at, inv.expires_at as invite_expires, inv.answered_at as invite_answered
      from public.users u left join cur on cur.user_id = u.id left join inv on inv.user_id = u.id
     where u.status <> 'deleted')
  select *, case
      when consent and reports > 0 then 'included'
      when consent then 'opted_in'
      when consent = false then 'declined'
      when invited_at is not null and invite_answered is null and invite_expires > now() then 'asked'
      else 'not_asked' end as research
    from base`;

/** Why "Request reports" is not allowed for this user, or null. */
function inviteBlock(u: any): string | null {
  if (u.status !== 'active') return 'The account is restricted.';
  if (u.consent) return 'Already opted in.';
  if (u.reports < 1) return 'No reports yet.';
  if (u.invited_at && !u.invite_answered && new Date(u.invite_expires) > new Date()) return 'Already asked; the link is still open.';
  if (u.invited_at && Date.now() - new Date(u.invited_at).getTime() < INVITE_GAP_DAYS * 86400e3) return `Asked less than ${INVITE_GAP_DAYS} days ago.`;
  if (u.consent === false && Date.now() - new Date(u.consent_at).getTime() < DECLINE_GAP_DAYS * 86400e3) return `Said no less than ${DECLINE_GAP_DAYS / 30} months ago.`;
  return null;
}

export async function usersAdminRoutes(app: App, deps: Deps) {
  async function requirePerm(req: FastifyRequest, reply: FastifyReply, perm: Perm): Promise<{ id: string; role: Role } | null> {
    const u = await sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    const { rows } = await deps.pool.query('select role from public.users where id = $1', [u.id]);
    const role = (rows[0]?.role as Role) || 'user';
    if (!can(role, perm)) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { id: u.id, role };
  }
  const dbFail = (reply: FastifyReply, e: unknown) => {
    if (isDbError(e, 'forbidden')) return fail(reply, 403, 'forbidden', 'You can’t do this for that account.');
    if (isDbError(e, 'not_found')) return fail(reply, 404, 'not_found');
    if (isDbError(e, 'reason_required')) return fail(reply, 400, 'reason_required', 'Write a short reason.');
    throw e;
  };
  const one = async (id: string) => (await deps.pool.query(`${USER_ROWS} where id = $1`, [id])).rows[0];
  const admin = { tags: ['admin'], security: [{ session: [] }] };
  const writeLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/admin/users', { schema: { ...admin, summary: 'Users with research status (50 per page)',
    querystring: z.object({ q: z.string().max(120).optional(), filter: z.enum(['all', 'included', 'not_included', 'restricted']).default('all'), page: z.coerce.number().int().min(1).max(10000).default(1) }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'tab:usermgmt'); if (!who) return;
    const { q, filter, page } = req.query as { q?: string; filter: string; page: number };
    const where: string[] = [], params: unknown[] = [];
    if (q?.trim()) { params.push(`%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`); where.push(`lower(email) like $${params.length}`); }
    if (filter === 'included') where.push(`research = 'included'`);
    if (filter === 'not_included') where.push(`research <> 'included'`);
    if (filter === 'restricted') where.push(`status = 'blocked'`);
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const sqlText = `select * from (${USER_ROWS}) x ${w}`;
    const [{ rows }, { rows: totals }] = await Promise.all([
      deps.pool.query(`${sqlText} order by created_at desc limit 50 offset ${(page - 1) * 50}`, params),
      deps.pool.query(`select count(*)::int as n, count(*) filter (where research = 'included')::int as included,
          count(*) filter (where status = 'blocked')::int as restricted from (${USER_ROWS}) x ${w}`, params),
    ]);
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, 'users_listed', $2)`, [who.id, JSON.stringify({ q: q || null, filter, page })]);
    const canInvite = can(who.role, 'research:invite');
    return ok(reply, {
      users: rows.map((u) => {
        const block = inviteBlock(u);
        return {
          id: u.id, email: u.email, role: u.role, status: u.status, country: u.country, created_at: u.created_at, last_login_at: u.last_login_at,
          restricted_reason: u.restricted_reason, signIn: u.has_google ? (u.has_password ? 'google+password' : 'google') : u.has_password ? 'password' : 'code',
          plan: u.plan, reports: u.reports, research: u.research, invited_at: u.invited_at, canRequest: canInvite && !block, requestBlocked: block,
        };
      }),
      total: totals[0].n, included: totals[0].included, restricted: totals[0].restricted, page, pages: Math.max(1, Math.ceil(totals[0].n / 50)),
      can: { restrict: can(who.role, 'users:restrict'), delete: can(who.role, 'users:delete'), invite: canInvite },
    });
  });

  app.post('/admin/users/:id/research-invite', { config: writeLimit, schema: { ...admin, summary: 'Email the user a request to include their reports in research', params: z.object({ id: z.string() }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'research:invite'); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    const u = await one(id);
    if (!u) return fail(reply, 404, 'not_found');
    const block = inviteBlock(u);
    if (block) return fail(reply, 409, 'not_allowed', block);
    const token = crypto.randomBytes(32).toString('base64url');
    const { rows } = await deps.pool.query(`insert into public.research_invites (user_id, sent_by, token_sha256) values ($1, $2, $3) returning id`, [id, who.id, sha(token)]);
    const base = (process.env.APP_URL || `${req.protocol}://${req.host}`).replace(/\/$/, '');
    try {
      await app.deps.mail({ to: u.email, ...researchInviteEmail(`${base}/research/consent?t=${token}`) });
    } catch (e) {
      req.log.error({ event: 'research_invite_mail_failed', error: (e as Error).message });
      await deps.pool.query(`update public.research_invites set answered_at = now(), answer = null where id = $1`, [rows[0].id]);   // void it
      return fail(reply, 502, 'mail_failed', "We couldn't send the email. Try again in a minute.");
    }
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, 'research_invite_sent', $2)`, [id, JSON.stringify({ by: who.id, invite: rows[0].id })]);
    return ok(reply, { sent: true });
  });

  app.post('/admin/users/:id/restrict', { attachValidation: true, config: writeLimit, schema: { ...admin, summary: 'Restrict a user (sign-in blocked, sessions end)', params: z.object({ id: z.string() }), body: z.object({ reason: z.string().max(500) }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'users:restrict'); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    try { await adminSetUserStatus(deps.db, who.id, id, 'blocked', (req.body as any)?.reason ?? ''); return ok(reply, { ok: true }); } catch (e) { return dbFail(reply, e); }
  });

  app.post('/admin/users/:id/unrestrict', { config: writeLimit, schema: { ...admin, summary: 'Lift a restriction', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'users:restrict'); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    try { await adminSetUserStatus(deps.db, who.id, id, 'active', null); return ok(reply, { ok: true }); } catch (e) { return dbFail(reply, e); }
  });

  app.post('/admin/users/:id/delete', { attachValidation: true, config: writeLimit, schema: { ...admin, summary: 'Delete a user (owner): reports, trades and files removed, account anonymised',
    params: z.object({ id: z.string() }), body: z.object({ reason: z.string().max(500), confirmEmail: z.string().max(254) }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'users:delete'); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    const b = req.body as { reason?: string; confirmEmail?: string } | undefined;
    const { rows } = await deps.pool.query(`select email from public.users where id = $1 and status <> 'deleted'`, [id]);
    if (!rows[0]) return fail(reply, 404, 'not_found');
    if ((b?.confirmEmail || '').trim().toLowerCase() !== String(rows[0].email).toLowerCase()) return fail(reply, 400, 'confirm_mismatch', 'Type the user’s email exactly to confirm.');
    try { await adminDeleteUser(deps.db, who.id, id, b?.reason ?? ''); return ok(reply, { deleted: true }); } catch (e) { return dbFail(reply, e); }
  });

  /* ------------------------------------------------ public: the link in the email (no sign-in) */
  const inviteBy = async (token: string) => {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const { rows } = await deps.pool.query(`select i.id, i.user_id, i.expires_at, i.answered_at, i.answer, u.status from public.research_invites i
        join public.users u on u.id = i.user_id where i.token_sha256 = $1`, [sha(token)]);
    return rows[0] ?? null;
  };
  const state = (i: any) => (!i || i.status !== 'active' ? 'invalid' : i.answered_at ? 'answered' : new Date(i.expires_at) <= new Date() ? 'expired' : 'open');
  const publicLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/research/invite/:token', { config: publicLimit, schema: { tags: ['privacy'], summary: 'State of a research consent link', params: z.object({ token: z.string() }) } }, async (req, reply) => {
    const i = await inviteBy((req.params as { token: string }).token);
    const s = state(i);
    return reply.header('Cache-Control', 'no-store').send({ state: s, ...(s === 'answered' && i.answer !== null ? { answer: i.answer ? 'yes' : 'no' } : {}) });
  });

  app.post('/research/invite/:token', { attachValidation: true, config: publicLimit, schema: { tags: ['privacy'], summary: 'Answer a research consent link (yes / no)',
    params: z.object({ token: z.string() }), body: z.object({ answer: z.enum(['yes', 'no']) }) } },
  async (req, reply) => {
    if ((req as any).validationError) return fail(reply, 400, 'invalid');
    const i = await inviteBy((req.params as { token: string }).token);
    const s = state(i);
    if (s !== 'open') return fail(reply, s === 'expired' ? 410 : s === 'answered' ? 409 : 404, s, s === 'expired' ? 'This link has expired.' : s === 'answered' ? 'You already answered. Thank you.' : 'This link is not valid.');
    const yes = (req.body as { answer: 'yes' | 'no' }).answer === 'yes';
    // single use: only the first answer wins
    const { rowCount } = await deps.pool.query(`update public.research_invites set answered_at = now(), answer = $2, ip_hash = $3 where id = $1 and answered_at is null`,
      [i.id, yes, ipHash(deps.config.ipHashSecret, ipOf(req))]);
    if (!rowCount) return fail(reply, 409, 'answered', 'You already answered. Thank you.');
    await recordConsent(deps.db, { userId: i.user_id, purpose: 'research', granted: yes, policyVersion: CONSENT_POLICY_VERSION, textSha256: consentTextSha256('research'),
      ipHash: ipHash(deps.config.ipHashSecret, ipOf(req)), userAgent: (req.headers['user-agent'] as string | undefined) ?? null });
    await deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, 'research_consent_via_email', $2)`, [i.user_id, JSON.stringify({ invite: i.id, granted: yes })]);
    return reply.header('Cache-Control', 'no-store').send({ ok: true, answer: yes ? 'yes' : 'no' });
  });
}
