/**
 * @file  apps/web/app/api/events/route.ts
 * @area  Admin
 * @what  POST — allow-listed product events from the browser (upload failures, tab views…).
 */
import { getSessionUser } from '@/lib/auth/session';
import { track, CLIENT_EVENTS } from '@/lib/admin/telemetry';

export const dynamic = 'force-dynamic';
/** POST { name, props } from the browser (allow-listed names only). */
export async function POST(req: Request) {
  const u = await getSessionUser();
  const b = await req.json().catch(() => ({}));
  if (u && typeof b?.name === 'string' && CLIENT_EVENTS.has(b.name)) await track(u.id, b.name, b.props && typeof b.props === 'object' ? b.props : undefined);
  return new Response(null, { status: 204 });
}
