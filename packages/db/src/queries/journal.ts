/**
 * @file  packages/db/src/queries/journal.ts
 * @area  Reports
 * @what  Trade journal (0027): read the user's notes, save one (an empty note is deleted), delete one.
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';

export const EMOTIONS = ['calm', 'confident', 'fomo', 'fear', 'revenge', 'bored', 'tired', 'greedy'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export interface TradeNote { tradeKey: string; setup: string | null; tags: string[]; emotion: Emotion | null; note: string | null; updatedAt: string }

const shape = (r: any): TradeNote => ({ tradeKey: r.trade_key, setup: r.setup, tags: r.tags || [], emotion: r.emotion, note: r.note, updatedAt: new Date(r.updated_at).toISOString() });

export async function listNotes(db: Db, userId: string): Promise<TradeNote[]> {
  const rows = await db.selectFrom('trade_notes').select(['trade_key', 'setup', 'tags', 'emotion', 'note', 'updated_at'])
    .where('user_id', '=', userId).orderBy('updated_at', 'desc').execute();
  return rows.map(shape);
}

/** upsert; a note with nothing in it is removed (returns null) */
export async function saveNote(db: Db, userId: string, n: { tradeKey: string; setup?: string | null; tags?: string[]; emotion?: Emotion | null; note?: string | null }): Promise<TradeNote | null> {
  const setup = n.setup?.trim() || null, note = n.note?.trim() || null, emotion = n.emotion || null;
  const tags = [...new Set((n.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
  if (!setup && !note && !emotion && !tags.length) { await deleteNote(db, userId, n.tradeKey); return null; }
  const r = await db.insertInto('trade_notes').values({ user_id: userId, trade_key: n.tradeKey, setup, tags, emotion, note })
    .onConflict((oc) => oc.columns(['user_id', 'trade_key']).doUpdateSet({ setup, tags, emotion, note, updated_at: sql`now()` as any }))
    .returning(['trade_key', 'setup', 'tags', 'emotion', 'note', 'updated_at']).executeTakeFirstOrThrow();
  return shape(r);
}

export async function deleteNote(db: Db, userId: string, tradeKey: string): Promise<boolean> {
  const r = await db.deleteFrom('trade_notes').where('user_id', '=', userId).where('trade_key', '=', tradeKey).executeTakeFirst();
  return Number(r.numDeletedRows) > 0;
}
