/**
 * @file  apps/api/src/routes/auth.ts
 * @area  Auth
 * @what  Sign-in, ported 1:1 from apps/web/app/api/auth/*: email code request/verify, Google start/callback, logout.
 */
import { z } from 'zod';
import { PgAuthStore } from '@pnl-lens/shared/auth/pg-auth-store';
import { generateCode, hashCode, normaliseEmail, maskEmail, codesMatch, OTP_TTL_MINUTES, OTP_PER_EMAIL_PER_HOUR, OTP_PER_IP_PER_HOUR, OTP_MAX_ATTEMPTS } from '@pnl-lens/shared/auth/otp';
import { googleEnabled, startGoogle, finishGoogle, OAUTH_COOKIE } from '@pnl-lens/shared/auth/google';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@pnl-lens/shared/auth/session';
import { clientCountry } from '@pnl-lens/shared/auth/request';
import { publicOrigin } from '@pnl-lens/shared/auth/origin';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { otpEmail } from '@pnl-lens/shared/mail';
import type { App, Deps } from '../app.js';
import { fail, ok, asFetchLike, ipOf } from '../lib/http.js';

/** The OAuth cookie must reach both callbacks: /api/auth/google/callback (what Google redirects to) and /api/v1/…. */
const OAUTH_PATH = '/api';
const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

export async function authRoutes(app: App, deps: Deps, opts: { googleCallbackOnly?: boolean } = {}) {
  const store = new PgAuthStore(deps.pool);
  const track = (u: string | null, name: string, props?: Record<string, unknown>) => trackWith(deps.pool, u, name, props);
  /** REQ-7: a first sign-in (no earlier login) that started from a blog article. Call before markLogin. */
  const trackBlogSignup = async (userId: string, fromBlog: boolean, method: 'email' | 'google') => {
    if (!fromBlog) return;
    const { rows } = await deps.pool.query('select last_login_at is null as first from public.users where id = $1', [userId]);
    if (rows[0]?.first) await track(userId, 'signup_from_blog', { method });
  };

  /** GET — finishes Google sign-in, verifies the ID token, links by verified email, sets the session. */
  app.get('/auth/google/callback', { schema: { tags: ['auth'], summary: 'Google sign-in callback', hide: !!opts.googleCallbackOnly } }, async (req, reply) => {
    const r = asFetchLike(req);
    const origin = publicOrigin(r);
    const q = req.query as Record<string, string | undefined>;
    const failed = (reason: string) => {
      req.log.warn({ event: 'google_signin_failed', reason });
      return reply.clearCookie(OAUTH_COOKIE, { path: OAUTH_PATH }).redirect(new URL('/login?error=google', origin).toString());
    };
    if (q.error) return failed(`provider_${q.error}`);
    try {
      const { profile, next } = await finishGoogle({ origin, code: q.code || '', state: q.state || '', cookie: req.cookies[OAUTH_COOKIE] });
      const user = await store.upsertUserByGoogle({ ...profile, country: clientCountry(r) });
      if (user.status !== 'active') return failed('blocked');
      await trackBlogSignup(user.id, /[?&]from=blog(&|$)/.test(next), 'google');
      await store.markLogin(user.id, 'google');
      await track(user.id, 'login', { method: 'google' }); await track(user.id, 'active');
      return reply
        .setCookie(SESSION_COOKIE, await createSessionToken({ id: user.id, country: user.country }), sessionCookieOptions)
        .clearCookie(OAUTH_COOKIE, { path: OAUTH_PATH })
        .redirect(new URL(next, origin).toString());
    } catch (e) {
      return failed((e as Error).message);
    }
  });
  if (opts.googleCallbackOnly) return;

  /** POST { email } → emails a 6-digit code. Same response whether or not the account exists. */
  app.post('/auth/otp/request', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Email a sign-in code', body: z.object({ email: z.string() }) },
  }, async (req, reply) => {
    const email = normaliseEmail((req.body as any)?.email);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email address.');
    const r = asFetchLike(req), ip = ipOf(req);
    const [byEmail, byIp] = await Promise.all([
      store.countRecentOtps({ email, sinceMinutes: 60 }),
      ip ? store.countRecentOtps({ ip, sinceMinutes: 60 }) : Promise.resolve(0),
    ]);
    if (byEmail >= OTP_PER_EMAIL_PER_HOUR || byIp >= OTP_PER_IP_PER_HOUR) return fail(reply, 429, 'rate_limited', 'Too many codes requested. Try again in an hour.');
    const user = await store.upsertUserByEmail(email, clientCountry(r));
    if (user.status !== 'active') return ok(reply, { sent: true, masked: maskEmail(email) }); // don't reveal
    const code = generateCode();
    await store.createOtp({ userId: user.id, email, codeHash: hashCode(code, email), purpose: 'login', ttlMinutes: OTP_TTL_MINUTES, ip });
    try {
      await app.deps.mail({ to: email, ...otpEmail(code) });
    } catch (e) {
      req.log.error({ event: 'otp_mail_failed', error: (e as Error).message });
      return fail(reply, 502, 'mail_failed', "We couldn't send the email. Try again in a minute.");
    }
    await store.audit(user.id, 'otp_requested', undefined, ip);
    return ok(reply, { sent: true, masked: maskEmail(email) });
  });

  /** POST { email, code } → sets the session cookie. */
  app.post('/auth/otp/verify', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Check the code and start a session', body: z.object({ email: z.string(), code: z.string(), source: z.string().max(20).optional() }) },
  }, async (req, reply) => {
    const body = req.body as any;
    const email = normaliseEmail(body?.email);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!email || !/^\d{6}$/.test(code)) return fail(reply, 400, 'invalid_input', 'Enter the 6-digit code from the email.');
    const otp = await store.latestOtp(email);
    const bad = (msg = 'That code is wrong or has expired.') => fail(reply, 401, 'invalid_code', msg);
    if (!otp || otp.consumedAt || new Date(otp.expiresAt) < new Date()) return bad();
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return bad('Too many wrong attempts. Request a new code.');
    if (!codesMatch(code, email, otp.codeHash)) {
      const n = await store.bumpOtpAttempts(otp.id);
      return bad(n >= OTP_MAX_ATTEMPTS ? 'Too many wrong attempts. Request a new code.' : 'That code is wrong or has expired.');
    }
    if (!(await store.consumeOtp(otp.id))) return bad();
    const user = await store.upsertUserByEmail(email, clientCountry(asFetchLike(req)));
    if (user.status !== 'active') return fail(reply, 403, 'blocked', 'This account is disabled.');
    await trackBlogSignup(user.id, body?.source === 'blog', 'email');
    await store.markLogin(user.id, 'email');
    await track(user.id, 'login', { method: 'email' }); await track(user.id, 'active');
    return reply.setCookie(SESSION_COOKIE, await createSessionToken({ id: user.id, country: user.country }), sessionCookieOptions)
      .header('Cache-Control', 'no-store').send({ ok: true });
  });

  /** GET — starts Google sign-in (OIDC + PKCE + state + nonce). */
  app.get('/auth/google/start', { schema: { tags: ['auth'], summary: 'Start Google sign-in', querystring: z.object({ next: z.string().optional() }) } }, async (req, reply) => {
    const origin = publicOrigin(asFetchLike(req));
    if (!googleEnabled()) return reply.redirect(new URL('/login?error=google_disabled', origin).toString());
    const next = (req.query as any).next || '/dashboard';
    const { url, cookie } = await startGoogle(origin, next);
    return reply.setCookie(OAUTH_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: OAUTH_PATH, maxAge: 600 }).redirect(url);
  });

  /** Which sign-in methods are configured (the login page shows the Google button only when it works). */
  app.get('/auth/providers', { schema: { tags: ['auth'], summary: 'Configured sign-in methods' } }, async (_req, reply) =>
    ok(reply, { google: googleEnabled(), email: true }));

  /** POST — clears the session cookie. */
  app.post('/auth/logout', { schema: { tags: ['auth'], summary: 'Sign out' } }, async (_req, reply) =>
    reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true }));
}
