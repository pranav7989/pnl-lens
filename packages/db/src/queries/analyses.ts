/**
 * @file  packages/db/src/queries/analyses.ts
 * @area  Database
 * @what  Uploads and analysis jobs: create an upload (api, lens_app), D11 counters, job status and the idempotent store step (worker, lens_worker).
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import type { AccessAction, AccessActor, AnalysisStatus, DetectedKind, NewFill, NewParseRun } from '../types.js';
import type { ReportV1 } from '@pnl-lens/engine/types';
import { normaliseReport } from '../normalise.js';

export interface NewUploadFile {
  originalName: string;
  ext: string;
  detectedKind: DetectedKind;
  mime?: string | null;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  encKeyId: string;
  wrappedDek: Buffer;
  iv: Buffer;
}

export interface CreateUploadInput {
  userId: string;
  files: NewUploadFile[];
  /** the "+" flow: files already in this report are analysed again together with the new ones */
  targetReportId?: string | null;
  existingFileIds?: string[];
  currencyOverride?: string | null;
  ip?: string | null;
}

/** api: one transaction — analysis + file rows + links + access log (write). The bytes are already in storage. */
export async function createUpload(db: Db, input: CreateUploadInput): Promise<{ analysisId: string; fileIds: string[] }> {
  const existing = input.existingFileIds ?? [];
  return db.transaction().execute(async (tx) => {
    const a = await tx.insertInto('analyses').values({
      user_id: input.userId,
      target_report_id: input.targetReportId ?? null,
      currency_override: input.currencyOverride ?? null,
      file_count: existing.length + input.files.length,
    }).returning('id').executeTakeFirstOrThrow();

    const fileIds: string[] = [];
    for (const f of input.files) {
      const row = await tx.insertInto('statement_files').values({
        user_id: input.userId, original_name: f.originalName, ext: f.ext, detected_kind: f.detectedKind, mime: f.mime ?? null,
        size_bytes: f.sizeBytes, sha256: f.sha256, storage_key: f.storageKey, enc_key_id: f.encKeyId,
        wrapped_dek: f.wrappedDek, iv: f.iv,
      }).returning('id').executeTakeFirstOrThrow();
      fileIds.push(row.id);
    }
    const all = [...existing, ...fileIds];
    await tx.insertInto('analysis_files')
      .values(all.map((file_id, position) => ({ analysis_id: a.id, file_id, user_id: input.userId, position })))
      .execute();
    if (fileIds.length) {
      await tx.insertInto('file_access_log').values(fileIds.map((file_id) => ({
        file_id, owner_user_id: input.userId, actor_kind: 'user' as const, actor_user_id: input.userId, action: 'write' as const,
        reason: 'upload', ip: input.ip ?? null,
      }))).execute();
    }
    return { analysisId: a.id, fileIds };
  });
}

/** D11 limits: analyses started in the last 24 h, and unfinished ones. */
export async function analysisCounts(db: Db, userId: string): Promise<{ today: number; running: number }> {
  const r = await db.selectFrom('analyses')
    .select([
      sql<number>`count(*) filter (where created_at > now() - interval '24 hours')::int`.as('today'),
      sql<number>`count(*) filter (where status in ('queued', 'parsing', 'analysing', 'storing'))::int`.as('running'),
    ])
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  return { today: r.today, running: r.running };
}

/** api: status for GET /analyses/:id. Scoped by user. */
export async function getAnalysis(db: Db, userId: string, id: string) {
  return db.selectFrom('analyses')
    .select(['id', 'status', 'error_code', 'file_count', 'target_report_id', 'report_id', 'created_at', 'finished_at', 'expires_at', 'payload'])
    .where('id', '=', id).where('user_id', '=', userId)
    .executeTakeFirst();
}

/** worker: the job and its files (with the wrapped keys needed to decrypt), in upload order. */
export async function loadJob(db: Db, analysisId: string) {
  const analysis = await db.selectFrom('analyses').selectAll().where('id', '=', analysisId).executeTakeFirst();
  if (!analysis) return null;
  const files = await db.selectFrom('analysis_files as af')
    .innerJoin('statement_files as f', 'f.id', 'af.file_id')
    .select(['f.id', 'f.original_name', 'f.ext', 'f.detected_kind', 'f.storage_key', 'f.enc_alg', 'f.enc_key_id',
      'f.wrapped_dek', 'f.iv', 'f.status', 'f.sha256', 'af.position'])
    .where('af.analysis_id', '=', analysisId)
    .orderBy('af.position')
    .execute();
  return { analysis, files };
}

/** worker: move a job forward. Never moves a finished job back (a late retry cannot undo `ready`). */
export async function setAnalysisStatus(db: Db, analysisId: string, status: Exclude<AnalysisStatus, 'ready'>, errorCode?: string) {
  await db.updateTable('analyses')
    .set({
      status,
      error_code: status === 'failed' ? errorCode ?? 'unknown' : null,
      ...(status === 'parsing' ? { started_at: sql`coalesce(started_at, now())`, attempts: sql`attempts + 1` } : {}),
      ...(status === 'failed' ? { finished_at: sql`now()` } : {}),
    } as any)
    .where('id', '=', analysisId)
    .where('status', 'not in', ['ready'])
    .execute();
}

export interface FileAccess {
  fileId: string; ownerUserId: string | null; actorKind: AccessActor; actorUserId?: string | null;
  action: AccessAction; reason?: string | null; jobId?: string | null; ip?: string | null;
}
export async function logFileAccess(db: Db, entries: FileAccess[]) {
  if (!entries.length) return;
  await db.insertInto('file_access_log').values(entries.map((e) => ({
    file_id: e.fileId, owner_user_id: e.ownerUserId, actor_kind: e.actorKind, actor_user_id: e.actorUserId ?? null,
    action: e.action, reason: e.reason ?? null, job_id: e.jobId ?? null, ip: e.ip ?? null,
  }))).execute();
}

export interface StoreResultInput {
  analysisId: string;
  engineVersion: string;
  report: ReportV1;
  broker?: string | null;
  /** statement_files.fingerprint per file (tradeSetFingerprint of each file analysed alone) */
  fileFingerprints?: Record<string, string>;
  parseRuns?: Omit<NewParseRun, 'analysis_id' | 'engine_version'>[];
  fills?: Omit<NewFill, 'analysis_id' | 'user_id' | 'engine_version'>[];
}

/**
 * worker store step: payload, trades, metrics, traits, fills, parse runs and file fingerprints in ONE transaction,
 * then status = ready. Idempotent: a re-delivered job finds the analysis already ready and writes nothing.
 * Returns false when there was nothing to do.
 */
export async function storeAnalysisResult(db: Db, input: StoreResultInput): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const a = await tx.selectFrom('analyses').select(['id', 'user_id', 'status', 'file_count'])
      .where('id', '=', input.analysisId).forUpdate().executeTakeFirst();
    if (!a || a.status === 'ready') return false;

    const files = await tx.selectFrom('analysis_files').select('file_id').where('analysis_id', '=', a.id).execute();
    const ctx = {
      analysisId: a.id, userId: a.user_id, engineVersion: input.engineVersion, broker: input.broker ?? null,
      sourceFileId: files.length === 1 ? files[0].file_id : null,
    };
    const rows = normaliseReport(input.report, ctx);
    for (let i = 0; i < rows.trades.length; i += 500) {
      await tx.insertInto('trades').values(rows.trades.slice(i, i + 500)).onConflict((oc) => oc.columns(['analysis_id', 'seq']).doNothing()).execute();
    }
    await tx.insertInto('report_metrics').values(rows.metrics).onConflict((oc) => oc.column('analysis_id').doNothing()).execute();
    if (rows.traits.length) {
      await tx.insertInto('report_traits').values(rows.traits).onConflict((oc) => oc.columns(['analysis_id', 'trait_id']).doNothing()).execute();
    }
    const fills = input.fills ?? [];
    for (let i = 0; i < fills.length; i += 500) {
      await tx.insertInto('fills')
        .values(fills.slice(i, i + 500).map((f) => ({ ...f, analysis_id: a.id, user_id: a.user_id, engine_version: input.engineVersion })))
        .onConflict((oc) => oc.columns(['analysis_id', 'seq']).doNothing()).execute();
    }
    if (input.parseRuns?.length) {
      await tx.insertInto('parse_runs')
        .values(input.parseRuns.map((p) => ({ ...p, analysis_id: a.id, engine_version: input.engineVersion })))
        .execute();
    }
    for (const [fileId, fp] of Object.entries(input.fileFingerprints ?? {})) {
      await tx.updateTable('statement_files').set({ fingerprint: fp }).where('id', '=', fileId).execute();
    }
    await tx.updateTable('analyses').set({
      payload: JSON.stringify(input.report), engine_version: input.engineVersion, status: 'ready', error_code: null,
      finished_at: sql`now()` as any,
    }).where('id', '=', a.id).execute();
    return true;
  });
}
