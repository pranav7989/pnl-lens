/**
 * @file  app/api/auth/logout/route.ts
 * @area  Auth
 * @what  POST — clears the session cookie.
 */
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete({ name: SESSION_COOKIE, path: '/' });
  return res;
}
