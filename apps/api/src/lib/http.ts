/**
 * @file  apps/api/src/lib/http.ts
 * @area  API
 * @what  Response helpers with the same JSON shapes as the old Next routes ({ error, message }), session lookup, request adapters.
 */
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionFromToken, SESSION_COOKIE, type SessionUser } from '@pnl-lens/shared/auth/session';

/** Same as apps/web/lib/api/http.ts: { error: code, message } with Cache-Control: no-store. */
export function fail(reply: FastifyReply, status: number, code: string, message?: string) {
  return reply.code(status).header('Cache-Control', 'no-store').send({ error: code, message: message || code });
}
export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.code(status).header('Cache-Control', 'no-store').send(data);
}

/** The shared helpers (clientIp, clientCountry, publicOrigin) take a Fetch-style request; this adapts Fastify's. */
export function asFetchLike(req: FastifyRequest) {
  return {
    url: `${req.protocol}://${req.host}${req.url}`,
    headers: {
      get: (name: string) => {
        const v = req.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : v ?? null;
      },
    },
  };
}

/** Client IP: Fastify resolves X-Forwarded-For (trustProxy). Validated like the old clientIp(). */
export const ipOf = (req: FastifyRequest) => (req.ip && /^[0-9a-f:.]+$/i.test(req.ip) ? req.ip : null);

/**
 * The signed-in user, or null. A valid token is not enough: the account must still be active, so blocking or
 * deleting an account ends its sessions at once (the token itself lives 30 days).
 */
export async function sessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const u = await sessionFromToken(req.cookies?.[SESSION_COOKIE]);
  if (!u) return null;
  const db = (req.server as any).deps.db as import('@pnl-lens/db').Db;     // fail closed: no DB, no session
  const row = await db.selectFrom('users').select(['status', 'sessions_valid_after']).where('id', '=', u.id).executeTakeFirst();
  if (row?.status !== 'active') return null;
  // a password change or reset ends the sessions issued before it (other devices); dev-mode sessions have no iat
  if (row.sessions_valid_after && u.iat !== undefined && u.iat * 1000 < new Date(row.sessions_valid_after).getTime() - 1000) return null;
  return u;
}

/** For handlers: the signed-in user, or sends the old 401 and returns null. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const u = await sessionUser(req);
  if (!u) { fail(reply, 401, 'unauthenticated', 'Sign in to continue.'); return null; }
  return u;
}

/** HMAC of the client IP for consent rows (never the raw IP, plan §10). */
export const ipHash = (secret: string, ip: string | null) => (ip ? crypto.createHmac('sha256', secret).update(ip).digest('hex') : null);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
