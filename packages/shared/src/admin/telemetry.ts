/**
 * @file  packages/shared/src/admin/telemetry.ts
 * @area  Admin
 * @what  Product events and error capture over an injected connection (best-effort; never breaks a request).
 */
/** Moved from apps/web/lib/admin/telemetry.ts; same SQL. Callers decide whether telemetry is on. */
import crypto from 'node:crypto';
import type { Queryable } from '../db';

export const CLIENT_EVENTS = new Set(['upload_started', 'upload_failed', 'no_trades', 'report_viewed', 'tab_viewed', 'pdf_exported', 'csv_exported', 'pricing_viewed',
  'landing_scroll_depth', 'journey_bar_view', 'journey_step_click', 'journey_next_action_click', 'social_click',
  'ig_section_view', 'ig_card_play', 'ig_card_click', 'ig_follow_click', 'blog_view', 'blog_cta_click', 'blog_preview_click', 'rewind_used', 'share_card_used', 'landing_visit']);
/** Events the public landing page may send without a session (stored with user_id null). REQ-4. */
export const ANON_EVENTS = new Set(['pricing_viewed', 'landing_scroll_depth', 'social_click', 'ig_section_view', 'ig_card_play', 'ig_card_click', 'ig_follow_click',
  'blog_view', 'blog_cta_click', 'blog_preview_click', 'landing_visit']);

export async function trackWith(db: Queryable, userId: string | null, name: string, props?: Record<string, unknown>) {
  try {
    if (name === 'active') {
      await db.query(`insert into public.events (user_id, name) values ($1, 'active') on conflict do nothing`, [userId]);
    } else {
      await db.query(`insert into public.events (user_id, name, props) values ($1, $2, $3)`, [userId, name, props ? JSON.stringify(props).slice(0, 4000) : null]);
    }
  } catch { /* ignore */ }
}

export function fingerprintOf(message: string, stack?: string | null) {
  const frame = (stack || '').split('\n').find((l) => /at |@/.test(l)) || '';
  const norm = message.replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, 'N').slice(0, 200);
  return crypto.createHash('sha1').update(norm + '|' + frame.trim().replace(/:\d+:\d+/g, '')).digest('hex').slice(0, 16);
}

export interface ErrorContext { source: 'server' | 'client'; route?: string; userId?: string | null; context?: Record<string, unknown> }

export async function captureErrorWith(db: Queryable, e: unknown, ctx: ErrorContext) {
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    await db.query(
      `insert into public.error_events (fingerprint, message, stack, source, route, user_id, context) values ($1, $2, $3, $4, $5, $6, $7)`,
      [fingerprintOf(err.message, err.stack), err.message.slice(0, 500), (err.stack || '').slice(0, 4000), ctx.source, ctx.route || null, ctx.userId || null, ctx.context ? JSON.stringify(ctx.context).slice(0, 4000) : null]);
  } catch { /* ignore */ }
}
