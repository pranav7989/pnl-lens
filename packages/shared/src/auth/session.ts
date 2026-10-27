/**
 * @file  packages/shared/src/auth/session.ts
 * @area  Auth
 * @what  Session token (signed JWT in the lens_session cookie): create, verify, cookie options, dev bypass. Used by apps/web and apps/api.
 */
import { jwtVerify, SignJWT } from 'jose';

/**
 * Session contract used by every protected route (moved unchanged from apps/web/lib/auth/session.ts).
 *
 * AUTH_MODE=dev   → every request is the fixed DEV_USER_ID (local work before phase 3).
 * AUTH_MODE=jwt   → reads the `lens_session` httpOnly cookie, verifies HS256 with SESSION_SECRET.
 *
 * Sessions are issued by the OTP verify and Google callback routes. The web app and the API use the same
 * cookie, secret and claims, so a session works on both during the cutover.
 */
export const SESSION_COOKIE = 'lens_session';
export const DEV_USER = '00000000-0000-0000-0000-000000000001';

/** iat: when the token was issued (seconds); set when read from a cookie, used to end sessions older than a password change. */
export interface SessionUser { id: string; country: string | null; iat?: number }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars) when AUTH_MODE=jwt');
  return new TextEncoder().encode(s);
}

/** The session for a request, given the raw cookie value (or null). */
export async function sessionFromToken(token: string | null | undefined): Promise<SessionUser | null> {
  if ((process.env.AUTH_MODE || 'dev') === 'dev') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH_IN_PROD !== 'true') return null;
    return { id: process.env.DEV_USER_ID || DEV_USER, country: process.env.DEV_USER_COUNTRY || 'IN' };
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return { id: payload.sub, country: typeof payload.country === 'string' ? payload.country : null, iat: typeof payload.iat === 'number' ? payload.iat : 0 };
  } catch {
    return null;
  }
}

export const SESSION_DAYS = 30;
export const sessionCookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_DAYS * 86400 };

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ country: user.country })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}
