/**
 * @file  apps/worker/src/maintenance.ts
 * @area  Worker
 * @what  Scheduled jobs: nightly purge (raw files after 30 days, unsaved drafts after 24 h, old sign-in codes) and the storage sweep that deletes shredded objects.
 */
/**
 * The SQL functions shred files at once (the wrapped key is deleted, so the object is unreadable everywhere). This
 * module then deletes the objects themselves: the api's storage key is write-only, so only the worker can.
 * Reports and trades are never purged by time (D4).
 */
import { purgeRawFiles, purgeDrafts, purgeOtpCodes, filesToSweep, markObjectDeleted, type Db } from '@pnl-lens/db';
import type { WorkerStorage } from './storage.js';
import { sweepExports } from './export.js';

export interface SweepResult { deleted: number; failed: number }

/** Deletes storage objects of shredded files and marks them. A missing object counts as deleted. */
export async function sweepStorage(db: Db, storage: WorkerStorage, batch = 500): Promise<SweepResult> {
  let deleted = 0, failed = 0;
  for (;;) {
    const rows = await filesToSweep(db, batch);
    if (!rows.length) break;
    let progress = 0;
    for (const f of rows) {
      try { await storage.delete(f.storage_key); await markObjectDeleted(db, f.id); deleted++; progress++; }
      catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) { await markObjectDeleted(db, f.id); deleted++; progress++; }
        else failed++;
      }
    }
    if (!progress || rows.length < batch) break;                        // storage down: try again next run
  }
  return { deleted, failed };
}

export interface NightlyResult { rawFiles: number; drafts: number; otpCodes: number; exports: number; sweep: SweepResult }

export async function nightly(db: Db, storage: WorkerStorage): Promise<NightlyResult> {
  const rawFiles = await purgeRawFiles(db);
  const drafts = await purgeDrafts(db);
  const otpCodes = await purgeOtpCodes(db);
  const exports = await sweepExports(db, storage);
  return { rawFiles, drafts, otpCodes, exports, sweep: await sweepStorage(db, storage) };
}
