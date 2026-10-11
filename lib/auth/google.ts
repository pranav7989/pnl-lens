/**
 * @file  lib/auth/google.ts
 * @area  Auth
 * @what  Google OpenID Connect flow (PKCE, state, nonce, ID-token verification).
 */
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

/**
 * "Sign in with Google" — OpenID Connect authorization-code flow with PKCE, state and nonce.
 * Endpoints are overridable (GOOGLE_*_URL) only so tests can point at a mock provider.
 */
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const JWKS_URL = () => process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = () => (process.env.GOOGLE_ISSUER ? [process.env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com']);
export const OAUTH_COOKIE = 'lens_oauth';

export function googleEnabled() { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
const b64u = (b: Buffer) => b.toString('base64url');
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-only-session-secret-change-me-0000');
export function redirectUri(origin: string) { return process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`; }

/** Builds the Google URL and a short-lived signed cookie holding state, nonce and the PKCE verifier. */
export async function startGoogle(origin: string, next: string) {
  const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const url = new URL(AUTH_URL());
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(origin), response_type: 'code',
    scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  const cookie = await new SignJWT({ state, nonce, verifier, next }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secret());
  return { url: url.toString(), cookie };
}

export interface GoogleProfile { sub: string; email: string; name: string | null }

/** Validates state, exchanges the code, verifies the ID token (signature, iss, aud, exp, nonce, email_verified). */
export async function finishGoogle(p: { origin: string; code: string; state: string; cookie: string | undefined }): Promise<{ profile: GoogleProfile; next: string }> {
  if (!p.cookie) throw new Error('missing_oauth_cookie');
  const { payload: c } = await jwtVerify(p.cookie, secret(), { algorithms: ['HS256'] });
  if (!p.state || p.state !== c.state) throw new Error('state_mismatch');

  const res = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: p.code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(p.origin), grant_type: 'authorization_code', code_verifier: String(c.verifier),
    }),
  });
  if (!res.ok) throw new Error(`token_exchange_${res.status}`);
  const tok = await res.json();
  if (!tok.id_token) throw new Error('no_id_token');

  const { payload } = await jwtVerify(tok.id_token, createRemoteJWKSet(new URL(JWKS_URL())), { issuer: ISSUERS(), audience: process.env.GOOGLE_CLIENT_ID! });
  if (payload.nonce !== c.nonce) throw new Error('nonce_mismatch');
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw new Error('email_not_verified');
  return {
    profile: { sub: String(payload.sub), email: payload.email.toLowerCase(), name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null },
    next: typeof c.next === 'string' && c.next.startsWith('/') && !c.next.startsWith('//') ? c.next : '/dashboard',
  };
}
