/**
 * @file  lib/api/http.ts
 * @area  Core
 * @what  API helpers: json(), fail(), requireUser().
 */
import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from '@/lib/auth/session';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fail = (status: number, code: string, message?: string) => json({ error: code, message: message || code }, status);

export async function requireUser(): Promise<SessionUser | NextResponse> {
  const u = await getSessionUser();
  return u ?? fail(401, 'unauthenticated', 'Sign in to continue.');
}
export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
