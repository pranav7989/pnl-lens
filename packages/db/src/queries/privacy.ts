/**
 * @file  packages/db/src/queries/privacy.ts
 * @area  Database
 * @what  Consent history, data export/delete requests, account deletion, and the scheduled purge/sweep jobs (worker).
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import type { ConsentPurpose, DataRequestKind } from '../types.js';

export interface ConsentInput {
  userId: string; purpose: ConsentPurpose; granted: boolean; policyVersion: string; textSha256: string;
  ipHash?: string | null; userAgent?: string | null;
}

/** Append-only: a change of mind is a new row. */
export async function recordConsent(db: Db, c: ConsentInput) {
  await db.insertInto('consents').values({
    user_id: c.userId, purpose: c.purpose, granted: c.granted, policy_version: c.policyVersion, text_sha256: c.textSha256,
    ip_hash: c.ipHash ?? null, user_agent: c.userAgent?.slice(0, 400) ?? null,
  }).execute();
}

/** Current state per purpose. Research is off unless a granted row exists (rule 7). */
export async function currentConsents(db: Db, userId: string): Promise<Record<ConsentPurpose, boolean>> {
  const rows = await db.selectFrom('user_consent_current').select(['purpose', 'granted']).where('user_id', '=', userId).execute();
  const out: Record<ConsentPurpose, boolean> = { processing: false, research: false };
  for (const r of rows) out[r.purpose] = r.granted;
  return out;
}

/** One open request per kind per user; a second call returns the open one. */
export async function requestData(db: Db, userId: string, kind: DataRequestKind) {
  const open = await db.selectFrom('data_requests').selectAll()
    .where('user_id', '=', userId).where('kind', '=', kind).where('status', 'in', ['pending', 'processing'])
    .executeTakeFirst();
  if (open) return open;
  return db.insertInto('data_requests').values({ user_id: userId, kind }).returningAll().executeTakeFirstOrThrow();
}

/** Removes reports, trades and files; anonymises the user; keeps payments and consent proof. False if already deleted. */
export async function deleteAccount(db: Db, userId: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select public.delete_account(${userId}::uuid) as ok`.execute(db);
  return rows[0].ok;
}

// ---- worker: scheduled jobs (02:00 IST) --------------------------------------------

/** D3: shreds raw files older than 30 days. Returns how many. */
export async function purgeRawFiles(db: Db, limit = 1000): Promise<number> {
  const { rows } = await sql<{ n: number }>`select public.purge_raw_files(${limit}::int) as n`.execute(db);
  return rows[0].n;
}

/** D3: removes unsaved analyses older than 24 h. Returns how many. */
export async function purgeDrafts(db: Db, limit = 1000): Promise<number> {
  const { rows } = await sql<{ n: number }>`select public.purge_drafts(${limit}::int) as n`.execute(db);
  return rows[0].n;
}

export async function purgeOtpCodes(db: Db): Promise<number> {
  const { rows } = await sql<{ n: number }>`select public.purge_otp_codes() as n`.execute(db);
  return rows[0].n;
}

/** Shredded files whose storage object the worker still has to delete. */
export async function filesToSweep(db: Db, limit = 500) {
  return db.selectFrom('statement_files').select(['id', 'user_id', 'storage_key'])
    .where('purged_at', 'is not', null).where('object_deleted_at', 'is', null)
    .orderBy('purged_at').limit(limit).execute();
}

export async function markObjectDeleted(db: Db, fileId: string) {
  await db.updateTable('statement_files').set({ object_deleted_at: sql`now()` as any })
    .where('id', '=', fileId).where('object_deleted_at', 'is', null).execute();
}
