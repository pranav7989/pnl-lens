/**
 * @file  apps/web/lib/auth/country.ts
 * @area  Core
 * @what  Visitor country for server components (Cloudflare CF-IPCountry / CloudFront / X-Country).
 */
import { headers } from 'next/headers';

/** Visitor country for server components (same headers as lib/auth/request.ts, for route handlers). */
export function requestCountry(): string | null {
  const h = headers();
  const c = h.get('cf-ipcountry') || h.get('cloudfront-viewer-country') || h.get('x-country');
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}
