/**
 * @file  app/api/errors/route.ts
 * @area  Admin
 * @what  POST — browser errors for the admin error center.
 */
import { getSessionUser } from '@/lib/auth/session';
import { captureError } from '@/lib/admin/telemetry';

export const dynamic = 'force-dynamic';
/** POST { message, stack, route } — browser errors for the error center. */
export async function POST(req: Request) {
  const u = await getSessionUser();
  const b = await req.json().catch(() => ({}));
  if (typeof b?.message === 'string' && b.message) {
    const e = new Error(b.message.slice(0, 500)); e.stack = typeof b.stack === 'string' ? b.stack.slice(0, 4000) : '';
    await captureError(e, { source: 'client', route: typeof b.route === 'string' ? b.route.slice(0, 200) : undefined, userId: u?.id, context: { ua: req.headers.get('user-agent')?.slice(0, 200) } });
  }
  return new Response(null, { status: 204 });
}
