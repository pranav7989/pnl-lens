/**
 * @file  apps/worker/src/pipeline.ts
 * @area  Worker
 * @what  One analysis job: fetch + decrypt files (logged) → engine in a child process → store payload, trades, fills, metrics, traits, parse runs in one transaction.
 */
/**
 * Failure rules (plan §6):
 *  - A problem with the FILE (unreadable, no closed trades, too slow, too big) is final: the analysis is marked failed
 *    with the engine's own message and the job completes, so it is not retried. Nothing is spent: a report can only be
 *    created from a ready analysis (create_report_from_analysis), so a failed file never costs a credit.
 *  - A problem with the INFRASTRUCTURE (storage, database, a missing key) throws, so BullMQ retries with backoff;
 *    after the last attempt main.ts marks the analysis failed (internal_error).
 *  - Idempotent: a re-delivered job for a ready, claimed or failed analysis does nothing, and the store step itself
 *    is a single transaction guarded by the analysis status.
 */
import { decryptFile, type Kek } from '@pnl-lens/shared/file-crypto';
import { loadJob, setAnalysisStatus, logFileAccess, storeAnalysisResult, type Db, type NewFill } from '@pnl-lens/db';
import type { WorkerStorage } from './storage.js';
import type { ChildInput } from './engine-child.js';
import type { RunResult } from './engine-runner.js';

export const FAILURE_MESSAGES = {
  timeout: 'This file took too long to read. Download the Excel or CSV version from your broker and try again.',
  too_complex: 'This file is too large or complex to read. Download the Excel or CSV version from your broker and try again.',
  files_expired: 'These statements were deleted after 30 days. Upload them again to build the report.',
  internal_error: 'Something went wrong while reading your files. Please upload them again.',
} as const;

export interface PipelineDeps {
  db: Db;
  storage: WorkerStorage;
  keks: Map<string, Kek>;
  runEngine: (input: ChildInput) => Promise<RunResult>;
  engineVersion: string;
}

export type Outcome = 'ready' | 'failed' | 'skipped';

const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function processAnalysis(deps: PipelineDeps, analysisId: string, jobId?: string): Promise<Outcome> {
  const job = await loadJob(deps.db, analysisId);
  if (!job) return 'skipped';                                           // draft already purged
  const a = job.analysis;
  if (a.status === 'ready' || a.status === 'failed' || a.claimed_at) return 'skipped';

  const fail = async (code: string, message: string | null) => { await setAnalysisStatus(deps.db, analysisId, 'failed', code, message ?? undefined); return 'failed' as const; };

  await setAnalysisStatus(deps.db, analysisId, 'parsing');
  if (job.files.some((f) => f.status !== 'stored' || !f.wrapped_dek || !f.iv)) return fail('files_expired', FAILURE_MESSAGES.files_expired);

  const inputs: ChildInput['files'] = [];
  for (const f of job.files) {
    const kek = deps.keks.get(f.enc_key_id);
    if (!kek) throw new Error(`file key ${f.enc_key_id} is not configured`);    // infrastructure: retried
    const body = await deps.storage.get(f.storage_key);
    await logFileAccess(deps.db, [{ fileId: f.id, ownerUserId: a.user_id, actorKind: 'worker', action: 'read', reason: 'analysis', jobId: jobId ?? null }]);
    const plain = decryptFile(body, f.iv!, f.wrapped_dek!, kek);
    await logFileAccess(deps.db, [{ fileId: f.id, ownerUserId: a.user_id, actorKind: 'worker', action: 'decrypt', reason: 'analysis', jobId: jobId ?? null }]);
    inputs.push({ name: f.original_name, data: new Uint8Array(plain.buffer, plain.byteOffset, plain.byteLength) });
  }

  await setAnalysisStatus(deps.db, analysisId, 'analysing');
  const r = await deps.runEngine({ files: inputs, currency: a.currency_override });
  inputs.length = 0;                                                    // drop plaintext as soon as possible

  if (!r.ok) {
    if (r.kind === 'read_error') {
      const f = r.fileIndex != null ? job.files[r.fileIndex] : null;
      if (f) {
        await deps.db.insertInto('parse_runs').values({ file_id: f.id, analysis_id: analysisId, engine_version: deps.engineVersion, outcome: 'error', error_code: 'read_error' }).execute();
      }
      return fail('read_error', r.message);
    }
    if (r.kind === 'timeout') {
      await deps.db.insertInto('parse_runs').values(job.files.map((f) => ({ file_id: f.id, analysis_id: analysisId, engine_version: deps.engineVersion, outcome: 'timeout' as const, error_code: 'timeout' }))).execute();
      return fail('timeout', FAILURE_MESSAGES.timeout);
    }
    if (r.kind === 'crashed' && r.oom) return fail('too_complex', FAILURE_MESSAGES.too_complex);
    throw new Error(`engine child crashed (not a file problem): ${r.message}`);   // infrastructure: retried, then dead letter
  }

  const parseRuns = r.files.map((pf) => ({
    file_id: job.files[pf.index].id, detected_broker: null, detected_format: pf.format,
    column_mapping: JSON.stringify(pf.mapping ?? []), warnings: null, sheet_count: pf.sheetCount,
    trade_count: pf.tradeCount, duration_ms: pf.durationMs, outcome: pf.outcome, error_code: null,
  }));
  if (!r.report) {
    await deps.db.insertInto('parse_runs').values(parseRuns.map((p) => ({ ...p, analysis_id: analysisId, engine_version: deps.engineVersion }))).execute();
    return fail('no_closed_trades', null);
  }

  await setAnalysisStatus(deps.db, analysisId, 'storing');
  let seq = 0;
  const fills: Omit<NewFill, 'analysis_id' | 'user_id' | 'engine_version'>[] = [];
  for (const pf of r.files) {
    for (const x of pf.fills) {
      fills.push({ source_file_id: job.files[pf.index].id, seq: seq++, symbol: x.symbol, side: x.side, qty: x.qty, price: x.price, fees: x.fees,
        trade_date: isDate(x.date), trade_time: x.time, currency: r.report.m.currency, source_row: x.sheet });
    }
  }
  await storeAnalysisResult(deps.db, {
    analysisId, engineVersion: deps.engineVersion, report: r.report,
    fileFingerprints: Object.fromEntries(r.files.map((pf) => [job.files[pf.index].id, pf.fingerprint])),
    parseRuns, fills,
  });
  return 'ready';
}
