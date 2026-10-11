/**
 * @file  app/api/me/route.ts
 * @area  Auth
 * @what  GET /api/me — current user + credits; also records daily activity for DAU/MAU.
 */
import { track } from '@/lib/admin/telemetry';
import { getStore } from '@/lib/store';
import { json, requireUser, isResponse } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  await track(user.id, 'active');
  const credits = await getStore().getCredits(user.id);
  return json({ user, credits });
}
