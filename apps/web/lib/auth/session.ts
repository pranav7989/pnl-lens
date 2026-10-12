/**
 * @file  apps/web/lib/auth/session.ts
 * @area  Auth
 * @what  The signed-in user for server components, asked from the API (GET /api/v1/me with the visitor's cookie).
 */
/**
 * Since the Phase 6 cutover the API owns sessions (sign-in, the lens_session cookie, verification). The web app only
 * asks who is signed in; it holds no session secret and no database access.
 */
import { getMe } from '@/lib/api-client';

export interface SessionUser { id: string; country: string | null }

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getMe())?.user ?? null;
}
