/**
 * @file  packages/db/src/queries/users-admin.ts
 * @area  Database
 * @what  Admin user management: restrict / unrestrict and delete through the role-checked database functions (0022).
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import { rethrow } from '../errors.js';

/** Owner or admin; never yourself or an owner (admins: not another admin). A reason is required to restrict. */
export async function adminSetUserStatus(db: Db, actorId: string, userId: string, status: 'blocked' | 'active', reason: string | null): Promise<void> {
  try { await sql`select public.admin_set_user_status(${actorId}::uuid, ${userId}::uuid, ${status}, ${reason})`.execute(db); } catch (e) { rethrow(e); }
}

/** Owner only; never yourself or another owner; a reason is required. Uses delete_account() (0013). */
export async function adminDeleteUser(db: Db, actorId: string, userId: string, reason: string): Promise<void> {
  try { await sql`select public.admin_delete_user(${actorId}::uuid, ${userId}::uuid, ${reason})`.execute(db); } catch (e) { rethrow(e); }
}
