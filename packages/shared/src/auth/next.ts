/**
 * @file  packages/shared/src/auth/next.ts
 * @area  Auth
 * @what  safeNext(): the only way a "next" URL after sign-in is accepted — a path on this site, never another host.
 */
const BASE = 'http://pnllens.invalid';

/**
 * Accepts only a same-site path. Refuses "//host", "/\host" (browsers treat "\" like "/") and anything that,
 * once parsed like a browser does (tabs and newlines removed), points to another origin. Returns the normalised
 * path, or the fallback.
 */
export function safeNext(next: unknown, fallback = '/dashboard'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  try {
    const u = new URL(next, BASE);
    return u.origin === BASE ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
