/**
 * @file  apps/web/lib/auth/session.ts
 * @area  Auth
 * @what  Session cookie (signed JWT) read/write for Next route handlers; token logic lives in packages/shared/src/auth/session.ts.
 */
import { cookies } from 'next/headers';
import { sessionFromToken, createSessionToken, SESSION_COOKIE, sessionCookieOptions, type SessionUser } from '@pnl-lens/shared/auth/session';

export { SESSION_COOKIE, SESSION_DAYS, sessionCookieOptions, createSessionToken, type SessionUser } from '@pnl-lens/shared/auth/session';

export async function getSessionUser(): Promise<SessionUser | null> {
  return sessionFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Sets the session cookie on the current response (route handlers / server actions). */
export async function issueSession(user: SessionUser) {
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
