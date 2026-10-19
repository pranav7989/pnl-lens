/**
 * @file  apps/api/src/routes/auth.ts
 * @area  Auth
 * @what  Sign-in: email + password (a one-time code proves the email first and resets a forgotten password), email code request/verify, Google start/callback, logout.
 */
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PgAuthStore } from '@pnl-lens/shared/auth/pg-auth-store';
import { generateCode, hashCode, normaliseEmail, maskEmail, codesMatch, OTP_TTL_MINUTES, OTP_PER_EMAIL_PER_HOUR, OTP_PER_IP_PER_HOUR, OTP_MAX_ATTEMPTS } from '@pnl-lens/shared/auth/otp';
import { googleEnabled, startGoogle, finishGoogle, OAUTH_COOKIE } from '@pnl-lens/shared/auth/google';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@pnl-lens/shared/auth/session';
import { hashPassword, verifyPassword, passwordProblem, PASSWORD_MAX_FAILED, PASSWORD_LOCK_MINUTES } from '@pnl-lens/shared/auth/password';
import { clientCountry } from '@pnl-lens/shared/auth/request';
import { publicOrigin } from '@pnl-lens/shared/auth/origin';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { otpEmail } from '@pnl-lens/shared/mail';
import type { App, Deps } from '../app.js';
import { fail, ok, asFetchLike, ipOf, requireUser } from '../lib/http.js';

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

  /**
   * Emails a 6-digit code (rate limits per email and per IP). create=false: only for an existing account ("Forgot
   * password" never creates one). Callers answer the same way whether or not the account exists.
   */
  type Sent = { ok: true; masked: string } | { ok: false; status: number; error: string; message: string };
  const sendCode = async (req: FastifyRequest, email: string, create = true): Promise<Sent> => {
    const r = asFetchLike(req), ip = ipOf(req), masked = maskEmail(email);
    const [byEmail, byIp] = await Promise.all([
      store.countRecentOtps({ email, sinceMinutes: 60 }),
      ip ? store.countRecentOtps({ ip, sinceMinutes: 60 }) : Promise.resolve(0),
    ]);
    if (byEmail >= OTP_PER_EMAIL_PER_HOUR || byIp >= OTP_PER_IP_PER_HOUR) return { ok: false, status: 429, error: 'rate_limited', message: 'Too many codes requested. Try again in an hour.' };
    if (!create) {
      const { rows } = await deps.pool.query('select 1 from public.users where email = $1 and status = $2', [email, 'active']);
      if (!rows.length) return { ok: true, masked };                   // don't reveal
    }
    const user = await store.upsertUserByEmail(email, clientCountry(r));
    if (user.status !== 'active') return { ok: true, masked };         // don't reveal
    const code = generateCode();
    await store.createOtp({ userId: user.id, email, codeHash: hashCode(code, email), purpose: 'login', ttlMinutes: OTP_TTL_MINUTES, ip });
    try {
      await app.deps.mail({ to: email, ...otpEmail(code) });
    } catch (e) {
      req.log.error({ event: 'otp_mail_failed', error: (e as Error).message });
      return { ok: false, status: 502, error: 'mail_failed', message: "We couldn't send the email. Try again in a minute." };
    }
    await store.audit(user.id, 'otp_requested', undefined, ip);
    return { ok: true, masked };
  };
  const sent = (reply: FastifyReply, r: Sent, extra: object = {}) => (r.ok ? ok(reply, { sent: true, masked: r.masked, ...extra }) : fail(reply, r.status, r.error, r.message));
  const startSession = async (reply: FastifyReply, user: { id: string; country: string | null }): Promise<void> => {
    reply.setCookie(SESSION_COOKIE, await createSessionToken({ id: user.id, country: user.country }), sessionCookieOptions).header('Cache-Control', 'no-store');
  };

  /** POST { email } → emails a 6-digit code. Same response whether or not the account exists. */
  app.post('/auth/otp/request', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Email a sign-in code', body: z.object({ email: z.string() }) },
  }, async (req, reply) => {
    const email = normaliseEmail((req.body as any)?.email);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email address.');
    return sent(reply, await sendCode(req, email));
  });

  /**
   * POST { email } → { method: "password" } when the account has a password (the page asks for it), otherwise a code is
   * emailed now and { method: "code", sent, masked } (a new email, or an account that has no password yet).
   * This tells whether an email has a password — needed for the flow; the per-IP rate limits slow down probing.
   */
  app.post('/auth/start', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'First step: password or email code', body: z.object({ email: z.string() }) },
  }, async (req, reply) => {
    const email = normaliseEmail((req.body as any)?.email);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email address.');
    const { rows } = await deps.pool.query('select password_hash is not null as has from public.users where email = $1 and status = $2', [email, 'active']);
    if (rows[0]?.has) return ok(reply, { method: 'password' });
    return sent(reply, await sendCode(req, email), { method: 'code' });
  });

  /** POST { email, password } → session. 10 wrong passwords lock password sign-in for 15 minutes (codes still work). */
  app.post('/auth/password/login', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Sign in with email and password', body: z.object({ email: z.string(), password: z.string().max(200), source: z.string().max(20).optional() }) },
  }, async (req, reply) => {
    const body = req.body as any, ip = ipOf(req);
    const email = normaliseEmail(body?.email), password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) return fail(reply, 400, 'invalid_input', 'Enter your email and password.');
    const { rows } = await deps.pool.query(
      `select id, country, status, password_hash, password_locked_until > now() as locked from public.users where email = $1`, [email]);
    const u = rows[0];
    if (u?.locked) return fail(reply, 429, 'locked', `Too many attempts. Use “Forgot password?” or try again in ${PASSWORD_LOCK_MINUTES} minutes.`);
    const good = await verifyPassword(password, u?.status === 'active' ? u.password_hash : null);   // dummy check when there is no password
    if (!good) {
      if (u) {
        await deps.pool.query(`update public.users set password_failed = password_failed + 1,
            password_locked_until = case when password_failed + 1 >= $2 then now() + make_interval(mins => $3) else password_locked_until end
          where id = $1`, [u.id, PASSWORD_MAX_FAILED, PASSWORD_LOCK_MINUTES]);
        await store.audit(u.id, 'password_failed', undefined, ip);
      }
      return fail(reply, 401, 'invalid_password', 'That email and password don’t match.');
    }
    await deps.pool.query('update public.users set password_failed = 0, password_locked_until = null where id = $1', [u.id]);
    await trackBlogSignup(u.id, body?.source === 'blog', 'email');
    await store.markLogin(u.id, 'password');
    await track(u.id, 'login', { method: 'password' }); await track(u.id, 'active');
    await startSession(reply, u);
    return reply.send({ ok: true });
  });

  /**
   * POST { password } (signed in) → sets the password. A first password needs only the session (straight after the code
   * or Google). Changing an existing one needs a sign-in in the last 10 minutes (the "Forgot password?" code).
   * Other devices are signed out; this one gets a fresh session.
   */
  app.post('/auth/password/set', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Set or change the password', security: [{ session: [] }], body: z.object({ password: z.string().max(200) }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    const password = typeof (req.body as any)?.password === 'string' ? (req.body as any).password : '';
    const { rows } = await deps.pool.query('select email, password_hash is not null as has from public.users where id = $1', [user.id]);
    const problem = passwordProblem(password, rows[0]?.email);
    if (problem) return fail(reply, 400, 'weak_password', problem);
    if (rows[0]?.has && (user.iat ?? 0) * 1000 < Date.now() - 10 * 60_000) {
      return fail(reply, 403, 'reauth_required', 'For your security, sign in with an emailed code to change your password.');
    }
    // sessions_valid_after uses the API's clock, the same clock that stamps session tokens (iat): the database clock can
    // differ by seconds (seen in Docker), which would end the fresh session issued just below
    await deps.pool.query(`update public.users set password_hash = $2, password_set_at = now(), password_failed = 0, password_locked_until = null,
        sessions_valid_after = $3 where id = $1`, [user.id, await hashPassword(password), new Date()]);
    await store.audit(user.id, rows[0]?.has ? 'password_changed' : 'password_set', undefined, ipOf(req));
    await startSession(reply, user);
    return reply.send({ ok: true });
  });

  /** POST { email } → emails a code to an existing account. Same answer for unknown emails. */
  app.post('/auth/password/forgot', {
    ...strict, attachValidation: true,
    schema: { tags: ['auth'], summary: 'Forgot password: email a sign-in code', body: z.object({ email: z.string() }) },
  }, async (req, reply) => {
    const email = normaliseEmail((req.body as any)?.email);
    if (!email) return fail(reply, 400, 'invalid_email', 'Enter a valid email address.');
    return sent(reply, await sendCode(req, email, false));
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
    // the code proved the email; a user without a password (and without Google) is asked to set one now
    const { rows } = await deps.pool.query('select password_hash is null and google_sub is null as needs from public.users where id = $1', [user.id]);
    await startSession(reply, user);
    return reply.send({ ok: true, needsPassword: !!rows[0]?.needs });
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
