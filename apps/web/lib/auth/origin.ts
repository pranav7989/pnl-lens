/**
 * @file  apps/web/lib/auth/origin.ts
 * @area  Auth
 * @what  Public origin for redirects behind the load balancer (APP_URL).
 */
/** Public origin for redirects. Behind the ALB, req.url is the internal address, so prefer APP_URL. */
export function publicOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = req.headers, proto = h.get('x-forwarded-proto') || 'http', host = h.get('x-forwarded-host') || h.get('host');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
