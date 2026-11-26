/**
 * @file  packages/shared/src/auth/password.ts
 * @area  Auth
 * @what  Password hashing (scrypt, Node built-in), checking in constant time, and the "is this password acceptable" rule.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
/** N=2^15, r=8, p=1: about 50 ms and 32 MB per check — slow for guessing, fine for a sign-in. */
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const opts = (n: number, r: number, p: number) => ({ N: n, r, p, maxmem: 128 * n * r * 2 });

export const PASSWORD_MIN = 8, PASSWORD_MAX = 128;
export const PASSWORD_MAX_FAILED = 10, PASSWORD_LOCK_MINUTES = 15;

/** "scrypt$N$r$p$<salt b64>$<key b64>" */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, opts(N, R, P));
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number), salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  if (![n, r, p].every(Number.isInteger) || n > 1 << 20 || !want.length) return false;
  const got = await scrypt(pw.normalize('NFKC'), salt, want.length, opts(n, r, p));
  return crypto.timingSafeEqual(got, want) && !!stored;
}

/**
 * Checked when there is no password (unknown email, or an account without one), so the time taken does not tell
 * which accounts exist. Its key is random, so nothing ever matches it (verifyPassword also requires a real stored hash).
 */
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${crypto.randomBytes(KEYLEN).toString('base64')}`;

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', '11111111',
  '00000000', 'iloveyou', 'abcd1234', 'abc12345', 'admin123', 'welcome1', 'letmein1', 'pnllens1', 'pnllens123', 'trading1', 'sensex123', 'nifty123']);

/** A plain sentence when the password can't be used, or null. */
export function passwordProblem(pw: string, email?: string): string | null {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!pw.trim()) return 'The password can’t be only spaces.';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || (email && (low === email.toLowerCase() || low === email.toLowerCase().split('@')[0]))) return 'That password is too easy to guess. Choose another one.';
  return null;
}
