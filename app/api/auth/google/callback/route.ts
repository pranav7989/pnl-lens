/**
 * @file  app/api/auth/google/callback/route.ts
 * @area  Auth
 * @what  GET — finishes Google sign-in, verifies the ID token, links by verified email, sets the session.
 */
import { track } from '@/lib/admin/telemetry';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { finishGoogle, OAUTH_COOKIE } from '@/lib/auth/google';
import { getAuthStore } from '@/lib/auth/store';
import { clientCountry } from '@/lib/auth/request';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { publicOrigin } from '@/lib/auth/origin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const q = new URL(req.url).searchParams;
  const fail = (reason: string) => {
    console.error(JSON.stringify({ event: 'google_signin_failed', reason }));
    const r = NextResponse.redirect(new URL('/login?error=google', origin));
    r.cookies.delete({ name: OAUTH_COOKIE, path: '/api/auth/google' });
    return r;
  };
  if (q.get('error')) return fail(`provider_${q.get('error')}`);
  try {
    const { profile, next } = await finishGoogle({ origin, code: q.get('code') || '', state: q.get('state') || '', cookie: cookies().get(OAUTH_COOKIE)?.value });
    const store = getAuthStore();
    const user = await store.upsertUserByGoogle({ ...profile, country: clientCountry(req) });
    if (user.status === 'blocked') return fail('blocked');
    await store.markLogin(user.id, 'google');
    await track(user.id, 'login', { method: 'google' }); await track(user.id, 'active');
  await track(user.id, 'login', { method: 'google' }); await track(user.id, 'active');
    const res = NextResponse.redirect(new URL(next, origin));
    res.cookies.set(SESSION_COOKIE, await createSessionToken({ id: user.id, country: user.country }), sessionCookieOptions);
    res.cookies.delete({ name: OAUTH_COOKIE, path: '/api/auth/google' });
    return res;
  } catch (e) {
    return fail((e as Error).message);
  }
}
