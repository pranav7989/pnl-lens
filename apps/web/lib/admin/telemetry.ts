/**
 * @file  apps/web/lib/admin/telemetry.ts
 * @area  Admin
 * @what  Product events and error capture (best-effort; never breaks a request).
 */
/** Product events and error capture. Best-effort: telemetry never breaks a user request. */
import crypto from 'node:crypto';
import { pool } from '@/lib/db';

const on = () => process.env.STORE_DRIVER === 'pg';
export const CLIENT_EVENTS = new Set(['upload_started', 'upload_failed', 'no_trades', 'report_viewed', 'tab_viewed', 'pdf_exported', 'csv_exported', 'pricing_viewed']);

export async function track(userId: string | null, name: string, props?: Record<string, unknown>) {
  if (!on()) return;
  try {
    if (name === 'active') {
      await pool().query(`insert into public.events (user_id, name) values ($1, 'active') on conflict do nothing`, [userId]);
    } else {
      await pool().query(`insert into public.events (user_id, name, props) values ($1, $2, $3)`, [userId, name, props ? JSON.stringify(props).slice(0, 4000) : null]);
    }
  } catch { /* ignore */ }
}

export function fingerprintOf(message: string, stack?: string | null) {
  const frame = (stack || '').split('\n').find((l) => /at |@/.test(l)) || '';
  const norm = message.replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, 'N').slice(0, 200);
  return crypto.createHash('sha1').update(norm + '|' + frame.trim().replace(/:\d+:\d+/g, '')).digest('hex').slice(0, 16);
}

export async function captureError(e: unknown, ctx: { source: 'server' | 'client'; route?: string; userId?: string | null; context?: Record<string, unknown> }) {
  if (!on()) return;
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    await pool().query(
      `insert into public.error_events (fingerprint, message, stack, source, route, user_id, context) values ($1, $2, $3, $4, $5, $6, $7)`,
      [fingerprintOf(err.message, err.stack), err.message.slice(0, 500), (err.stack || '').slice(0, 4000), ctx.source, ctx.route || null, ctx.userId || null, ctx.context ? JSON.stringify(ctx.context).slice(0, 4000) : null]);
  } catch { /* ignore */ }
}
