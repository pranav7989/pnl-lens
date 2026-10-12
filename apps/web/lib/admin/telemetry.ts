/**
 * @file  apps/web/lib/admin/telemetry.ts
 * @area  Admin
 * @what  Product events and error capture (best-effort; never breaks a request), bound to the web app's pool.
 */
/** Product events and error capture. Best-effort: telemetry never breaks a user request. SQL in packages/shared. */
import { pool } from '@/lib/db';
import { trackWith, captureErrorWith, type ErrorContext } from '@pnl-lens/shared/admin/telemetry';

export { CLIENT_EVENTS, fingerprintOf } from '@pnl-lens/shared/admin/telemetry';

const on = () => process.env.STORE_DRIVER === 'pg';
const db = { query: (text: string, params?: unknown[]) => pool().query(text, params) };

export async function track(userId: string | null, name: string, props?: Record<string, unknown>) {
  if (on()) await trackWith(db, userId, name, props);
}

export async function captureError(e: unknown, ctx: ErrorContext) {
  if (on()) await captureErrorWith(db, e, ctx);
}
