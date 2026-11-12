/**
 * @file  apps/web/app/healthz/route.ts
 * @area  Ops
 * @what  Liveness of the web container (Docker healthcheck). The web app has no database; readiness of the system is GET /api/v1/ready.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
