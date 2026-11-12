/**
 * @file  packages/shared/src/auth/request.ts
 * @area  Core
 * @what  Client IP and country for API routes.
 */
/** Request context helpers (client IP and country) for route handlers behind CloudFront / ALB.
 * Accepts a Fetch `Request` (apps/web) or anything with `headers.get()` (the Fastify adapter in apps/api). */
export interface HeaderSource { headers: { get(name: string): string | null | undefined } }
export function clientIp(req: HeaderSource): string | null {
  const xff = req.headers.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip');
  return ip && /^[0-9a-f:.]+$/i.test(ip) ? ip : null;
}

/**
 * Country for pricing (INR vs USD). Set by Cloudflare (`CF-IPCountry`) or CloudFront (`CloudFront-Viewer-Country`) when the
 * ALB sits behind CloudFront; X-Country is accepted for other proxies and tests.
 * Returns null when unknown — pricing then falls back to USD.
 */
export function clientCountry(req: HeaderSource): string | null {
  const c = req.headers.get('cf-ipcountry') || req.headers.get('cloudfront-viewer-country') || req.headers.get('x-country');
  return c && /^[A-Z]{2}$/.test(c.toUpperCase()) ? c.toUpperCase() : null;
}
