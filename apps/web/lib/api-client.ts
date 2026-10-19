/**
 * @file  apps/web/lib/api-client.ts
 * @area  Core
 * @what  How the website talks to the API: server components call it over the private network with the visitor's cookie; the browser calls /api/v1 on the same site.
 */
/**
 * Since the Phase 6 cutover the web app has no database access and no API routes of its own: every read and
 * write goes through apps/api. Server components use apiServer() (API_INTERNAL_URL, default http://api:4000,
 * forwarding the session cookie and the visitor-country headers). Client components use lib/api-browser.ts.
 */
import { cache } from 'react';
import { cookies, headers } from 'next/headers';

export interface ApiResult<T> { status: number; ok: boolean; data: T }

const FORWARD = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-country', 'x-forwarded-for', 'user-agent'];

/** Server components only. Never throws on HTTP errors: callers branch on status (401 → sign in, 404, 410…). */
export async function apiServer<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const base = (process.env.API_INTERNAL_URL || 'http://api:4000').replace(/\/$/, '');
  const h = await headers(), c = await cookies();
  const fwd: Record<string, string> = { accept: 'application/json' };
  for (const k of FORWARD) { const v = h.get(k); if (v) fwd[k] = v; }
  const cookie = c.toString(); if (cookie) fwd.cookie = cookie;
  if (init.body !== undefined) {
    fwd['content-type'] = 'application/json';
    fwd.origin = process.env.APP_URL || '';                     // passes the API's same-site check for server-side writes
  }
  const res = await fetch(`${base}/api/v1${path}`, { method: init.method || 'GET', headers: fwd, cache: 'no-store',
    body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = res.status === 204 ? (null as T) : await res.json().catch(() => null as T);
  return { status: res.status, ok: res.ok, data };
}

export interface Me { user: { id: string; country: string | null }; credits: number; role: string; hasPassword?: boolean; needsPassword?: boolean }

/** The signed-in user (with credits and role), or null when signed out. One API call per request (React cache). */
export const getMe = cache(async (): Promise<Me | null> => {
  const r = await apiServer<Me>('/me');
  return r.ok ? r.data : null;
});
