/**
 * @file  apps/worker/src/export.ts
 * @area  Worker
 * @what  "Export my data": builds the user's archive (all data as JSON + original statements still stored), encrypts it, stores it for 7 days; expiry sweep.
 */
/**
 * The data comes from export_user_data() (0017), the only way the worker can read accounts, consents, reports and
 * payments, and only for an export request in progress. Original statements are included while they still exist
 * (30-day rule); each read and decrypt is logged. The archive is encrypted like statement files and kept 7 days.
 */
import crypto from 'node:crypto';
import { sql } from 'kysely';
import { decryptFile, encryptFile, type Kek } from '@pnl-lens/shared/file-crypto';
import { logFileAccess, type Db } from '@pnl-lens/db';
import type { WorkerStorage } from './storage.js';
import { buildZip } from './zip.js';

export const EXPORT_DAYS = 7;

export interface ExportDeps { db: Db; storage: WorkerStorage; keks: Map<string, Kek>; currentKek: Kek }

const README = `PnL Lens — your data export

pnl-lens-data.json   everything PnL Lens holds about you: account, plans, payments, consents,
                     reports (with every trade, metric and habit), the list of your statements,
                     who accessed your files and when, and your account activity.
statements/          the original files you uploaded that are still stored
                     (files are deleted automatically 30 days after upload).

Questions: support@pnllens.com
`;

// control characters are stripped on purpose (archive member names)
// eslint-disable-next-line no-control-regex
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'file';

export async function processExport(deps: ExportDeps, requestId: string, jobId?: string): Promise<'done' | 'skipped'> {
  const req = await deps.db.selectFrom('data_requests').select(['id', 'user_id', 'kind', 'status']).where('id', '=', requestId).executeTakeFirst();
  if (!req || req.kind !== 'export' || (req.status !== 'pending' && req.status !== 'processing')) return 'skipped';
  await deps.db.updateTable('data_requests').set({ status: 'processing', started_at: sql`coalesce(started_at, now())` as any }).where('id', '=', requestId).execute();

  const { rows } = await sql<{ data: unknown }>`select public.export_user_data(${requestId}::uuid) as data`.execute(deps.db);
  const entries: { name: string; data: Buffer }[] = [{ name: 'README.txt', data: Buffer.from(README) }, { name: 'pnl-lens-data.json', data: Buffer.from(JSON.stringify(rows[0].data, null, 2)) }];

  const files = await deps.db.selectFrom('statement_files').select(['id', 'original_name', 'storage_key', 'enc_key_id', 'wrapped_dek', 'iv', 'created_at'])
    .where('user_id', '=', req.user_id).where('status', '=', 'stored').orderBy('created_at').orderBy('original_name').execute();
  const used = new Set<string>();
  for (const f of files) {
    const kek = deps.keks.get(f.enc_key_id);
    if (!kek || !f.wrapped_dek || !f.iv) continue;
    const body = await deps.storage.get(f.storage_key);
    await logFileAccess(deps.db, [{ fileId: f.id, ownerUserId: req.user_id, actorKind: 'worker', action: 'read', reason: 'data_export', jobId: jobId ?? null }]);
    const plain = decryptFile(body, f.iv, f.wrapped_dek, kek);
    await logFileAccess(deps.db, [{ fileId: f.id, ownerUserId: req.user_id, actorKind: 'worker', action: 'decrypt', reason: 'data_export', jobId: jobId ?? null }]);
    let name = `statements/${safeName(f.original_name)}`;
    for (let i = 2; used.has(name); i++) name = `statements/${i}-${safeName(f.original_name)}`;
    used.add(name);
    entries.push({ name, data: plain });
  }

  const zip = buildZip(entries);
  const enc = encryptFile(zip, deps.currentKek);
  const key = `x/${crypto.randomUUID()}`;
  await deps.storage.putExport(key, enc.body);
  await deps.db.updateTable('data_requests').set({
    status: 'done', result_key: key, enc_key_id: enc.encKeyId, wrapped_dek: enc.wrappedDek, iv: enc.iv, size_bytes: zip.length,
    completed_at: sql`now()` as any, expires_at: sql`now() + make_interval(days => ${EXPORT_DAYS})` as any, error_code: null,
  }).where('id', '=', requestId).execute();
  return 'done';
}

export async function failExport(db: Db, requestId: string, code = 'internal_error') {
  await db.updateTable('data_requests').set({ status: 'failed', error_code: code, completed_at: sql`now()` as any })
    .where('id', '=', requestId).where('status', 'in', ['pending', 'processing']).execute();
}

/** Removes expired archives (object + key). The request row stays as a record. */
export async function sweepExports(db: Db, storage: WorkerStorage): Promise<number> {
  const due = await db.selectFrom('data_requests').select(['id', 'result_key'])
    .where('status', '=', 'done').where('result_key', 'is not', null).where('expires_at', '<', sql<Date>`now()`).limit(500).execute();
  for (const r of due) {
    await storage.deleteExport(r.result_key!).catch((e: any) => { if (e?.name !== 'NoSuchKey') throw e; });
    await db.updateTable('data_requests').set({ result_key: null, wrapped_dek: null, iv: null }).where('id', '=', r.id).execute();
  }
  return due.length;
}
