/**
 * @file  apps/web/app/api/health/route.ts
 * @area  Ops
 * @what  GET /api/health — liveness check used by DigitalOcean App Platform.
 */
import { json } from '@/lib/api/http';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Load balancer / ECS health check. Checks the DB only when STORE_DRIVER=pg. */
export async function GET() {
  if (process.env.STORE_DRIVER === 'pg') {
    try { await pool().query('select 1'); } catch { return json({ ok: false, db: 'down' }, 503); }
  }
  return json({ ok: true });
}
