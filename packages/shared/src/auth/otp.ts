/**
 * @file  packages/shared/src/auth/otp.ts
 * @area  Auth
 * @what  Email one-time codes: generation, hashing (HMAC), checks, email normalisation.
 */
import crypto from 'node:crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_PER_EMAIL_PER_HOUR = 5;
export const OTP_PER_IP_PER_HOUR = 20;

function pepper() {
  const p = process.env.OTP_PEPPER;
  if (!p || p.length < 16) {
    if (process.env.NODE_ENV === 'production' && process.env.AUTH_MODE === 'jwt') throw new Error('OTP_PEPPER must be set (16+ chars)');
    return 'dev-only-pepper-change-me';
  }
  return p;
}

/** Uniform 6-digit code from a CSPRNG (no modulo bias). */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code: string, email: string): string {
  return crypto.createHmac('sha256', pepper()).update(`${email.toLowerCase()}:${code}`).digest('hex');
}

export function codesMatch(code: string, email: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(code, email), 'hex'), b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return EMAIL.test(e) && e.length <= 254 ? e : null;
}

export function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(u.length - 1, 5)))}@${d}`;
}
