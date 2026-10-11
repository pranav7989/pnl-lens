/**
 * @file  lib/auth/session.ts
 * @area  Auth
 * @what  Session cookie (signed JWT) read/write; dev bypass for local development only.
 */
import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Session contract used by every protected route.
 *
 * AUTH_MODE=dev   → every request is the fixed DEV_USER_ID (local work before phase 3).
 * AUTH_MODE=jwt   → reads the `lens_session` httpOnly cookie, verifies HS256 with SESSION_SECRET.
 *
 * Sessions are issued by /api/auth/otp/verify and /api/auth/google/callback.
 */
export const SESSION_COOKIE = 'lens_session';
const DEV_USER = '00000000-0000-0000-0000-000000000001';

export interface SessionUser { id: string; country: string | null }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars) when AUTH_MODE=jwt');
  return new TextEncoder().encode(s);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if ((process.env.AUTH_MODE || 'dev') === 'dev') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH_IN_PROD !== 'true') return null;
    return { id: process.env.DEV_USER_ID || DEV_USER, country: process.env.DEV_USER_COUNTRY || 'IN' };
  }
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return { id: payload.sub, country: typeof payload.country === 'string' ? payload.country : null };
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

/** Sets the session cookie on the current response (route handlers / server actions). */
export async function issueSession(user: SessionUser) {
  cookies().set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
}

export function clearSession() {
  cookies().delete(SESSION_COOKIE);
}
