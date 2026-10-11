/**
 * @file  apps/web/app/api/auth/google/start/route.ts
 * @area  Auth
 * @what  GET — starts Google sign-in (OIDC + PKCE + state + nonce).
 */
import { NextResponse } from 'next/server';
import { googleEnabled, startGoogle, OAUTH_COOKIE } from '@/lib/auth/google';
import { publicOrigin } from '@/lib/auth/origin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = publicOrigin(req);
  if (!googleEnabled()) return NextResponse.redirect(new URL('/login?error=google_disabled', origin));
  const next = new URL(req.url).searchParams.get('next') || '/dashboard';
  const { url, cookie } = await startGoogle(origin, next);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
  return res;
}
