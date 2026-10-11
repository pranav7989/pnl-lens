/**
 * @file  app/api/cron/purge/route.ts
 * @area  Ops
 * @what  POST /api/cron/purge — optional HTTP trigger for the nightly purge (needs CRON_SECRET). The scheduled job uses scripts/purge.mjs.
 */
import { getStore } from '@/lib/store';
import { json, fail } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/**
 * Nightly purge trigger. Amazon EventBridge Scheduler calls this through an API destination
 * with header `Authorization: Bearer $CRON_SECRET` (see docs/DEPLOYMENT_AWS_ALTERNATIVE.md).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return fail(401, 'unauthorized');
  return json({ purged: await getStore().purgeExpired() });
}
