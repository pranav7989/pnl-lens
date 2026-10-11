/**
 * @file  apps/web/app/api/auth/otp/request/route.ts
 * @area  Auth
 * @what  POST — emails a 6-digit sign-in code (rate-limited per email and per IP).
 */
import { json, fail } from '@/lib/api/http';
import { getAuthStore } from '@/lib/auth/store';
import { clientIp, clientCountry } from '@/lib/auth/request';
import { generateCode, hashCode, normaliseEmail, maskEmail, OTP_TTL_MINUTES, OTP_PER_EMAIL_PER_HOUR, OTP_PER_IP_PER_HOUR } from '@/lib/auth/otp';
import { sendMail, otpEmail } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/** POST { email } → emails a 6-digit code. Same response whether or not the account exists. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(body?.email);
  if (!email) return fail(400, 'invalid_email', 'Enter a valid email address.');
  const ip = clientIp(req);
  const store = getAuthStore();

  const [byEmail, byIp] = await Promise.all([
    store.countRecentOtps({ email, sinceMinutes: 60 }),
    ip ? store.countRecentOtps({ ip, sinceMinutes: 60 }) : Promise.resolve(0),
  ]);
  if (byEmail >= OTP_PER_EMAIL_PER_HOUR || byIp >= OTP_PER_IP_PER_HOUR) {
    return fail(429, 'rate_limited', 'Too many codes requested. Try again in an hour.');
  }

  const user = await store.upsertUserByEmail(email, clientCountry(req));
  if (user.status === 'blocked') return json({ sent: true, masked: maskEmail(email) }); // don't reveal
  const code = generateCode();
  await store.createOtp({ userId: user.id, email, codeHash: hashCode(code, email), purpose: 'login', ttlMinutes: OTP_TTL_MINUTES, ip });
  try {
    await sendMail({ to: email, ...otpEmail(code) });
  } catch (e) {
    console.error(JSON.stringify({ event: 'otp_mail_failed', error: (e as Error).message }));
    return fail(502, 'mail_failed', "We couldn't send the email. Try again in a minute.");
  }
  await store.audit(user.id, 'otp_requested', undefined, ip);
  return json({ sent: true, masked: maskEmail(email) });
}
