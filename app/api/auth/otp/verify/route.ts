/**
 * @file  app/api/auth/otp/verify/route.ts
 * @area  Auth
 * @what  POST — checks the code (5 attempts, single use), creates/loads the user, sets the session cookie.
 */
import { track } from '@/lib/admin/telemetry';
import { NextResponse } from 'next/server';
import { fail } from '@/lib/api/http';
import { getAuthStore } from '@/lib/auth/store';
import { codesMatch, normaliseEmail, OTP_MAX_ATTEMPTS } from '@/lib/auth/otp';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { clientCountry } from '@/lib/auth/request';

export const dynamic = 'force-dynamic';

/** POST { email, code } → sets the session cookie. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return fail(400, 'invalid_input', 'Enter the 6-digit code from the email.');

  const store = getAuthStore();
  const otp = await store.latestOtp(email);
  const bad = (msg = 'That code is wrong or has expired.') => fail(401, 'invalid_code', msg);
  if (!otp || otp.consumedAt || new Date(otp.expiresAt) < new Date()) return bad();
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return bad('Too many wrong attempts. Request a new code.');
  if (!codesMatch(code, email, otp.codeHash)) {
    const n = await store.bumpOtpAttempts(otp.id);
    return bad(n >= OTP_MAX_ATTEMPTS ? 'Too many wrong attempts. Request a new code.' : 'That code is wrong or has expired.');
  }
  if (!(await store.consumeOtp(otp.id))) return bad();

  const user = await store.upsertUserByEmail(email, clientCountry(req));
  if (user.status === 'blocked') return fail(403, 'blocked', 'This account is disabled.');
  await store.markLogin(user.id, 'email');
  await track(user.id, 'login', { method: 'email' }); await track(user.id, 'active');
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ id: user.id, country: user.country }), sessionCookieOptions);
  return res;
}
