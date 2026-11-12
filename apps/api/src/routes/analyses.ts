/**
 * @file  apps/api/src/routes/analyses.ts
 * @area  Reports
 * @what  POST /analyses (alias /uploads): consent, type sniffing, size/plan/D11 limits, encrypt, store, queue. GET /analyses/:id and /reports/:id/status.
 */
/**
 * Upload flow (plan §6): signed-in user → D11 limits (20 a day, 3 running) → multipart parts buffered up to 10 MB each
 * (the multipart plugin refuses bigger ones) → real type checked from the bytes → sha256 → encrypted with a fresh key →
 * stored (write-only key) → analysis + file rows + access log in one transaction → consent row(s) → job queued.
 * Files are buffered rather than streamed into storage on purpose: they are at most 10 MB and must pass the type
 * check before a single byte is stored.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { sql } from 'kysely';
import { MAX_FILES } from '@pnl-lens/shared/limits';
import { encryptFile } from '@pnl-lens/shared/file-crypto';
import { CONSENT_POLICY_VERSION, consentTextSha256 } from '@pnl-lens/shared/consent';
import { trackWith } from '@pnl-lens/shared/admin/telemetry';
import { analysisCounts, createUpload, getAnalysis, recordConsent, currentConsents, type NewUploadFile } from '@pnl-lens/db';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, ipHash, ipOf, UUID } from '../lib/http.js';
import { sniff } from '../lib/sniff.js';

export const DAILY_ANALYSES = 20;
export const RUNNING_ANALYSES = 3;

/** The texts the upload screen shows today (apps/web/components/UploadClient.tsx), keyed by worker error_code. */
export const ANALYSIS_ERRORS: Record<string, string> = {
  no_closed_trades: "No closed trades found in this file. Download the P&L statement or tradebook for a period with closed trades, or check it isn't a scanned PDF.",
  read_error: 'Could not read the file.',
};
const FILE_ERRORS = {
  bad_extension: (n: string) => `${n}: use Excel, CSV, PDF or Word files.`,
  bad_file_type: (n: string) => `${n} doesn't look like a broker statement. Use the Excel, CSV, PDF or Word file from your broker.`,
  empty: (n: string) => `${n} is empty.`,
};

/** Titles of the 2 most costly leaks, topped up from the strengths (short sentences) when there are fewer. */
function previewInsights(p: any): string[] {
  const leaks = [...(p.leaks || [])].sort((a: any, b: any) => Math.abs(b.impact || 0) - Math.abs(a.impact || 0)).map((l: any) => l.title);
  return [...leaks, ...(p.strengths || [])].filter((t) => typeof t === 'string' && t).slice(0, 2);
}

export function analysisView(a: NonNullable<Awaited<ReturnType<typeof getAnalysis>>>) {
  const p = a.payload as any;
  const preview = a.status === 'ready' && p ? {
    source: p.m.source, positions: p.m.n, from: p.m.from ?? null, to: p.m.to ?? null,
    markets: (p.m.markets || []).map((x: any) => x.market), currency: p.m.currency, net: p.m.net,
    leaks: (p.leaks || []).length, rules: (p.rules || []).length,
    // free preview (credits spec rule 9): total charges and the titles of the 2 biggest insights; the rest stays locked
    charges: p.m.charges ?? 0, insights: previewInsights(p), insightCount: (p.leaks || []).length + (p.strengths || []).length,
  } : null;
  return {
    id: a.id, status: a.status, fileCount: a.file_count, reportId: a.report_id, targetReportId: a.target_report_id,
    createdAt: a.created_at, finishedAt: a.finished_at, expiresAt: a.expires_at,
    error: a.status === 'failed' ? a.error_code : null,
    // the engine's own sentence when there is one (e.g. scanned PDF), else the upload screen's text
    message: a.status !== 'failed' ? null : a.error_code === 'no_closed_trades' ? ANALYSIS_ERRORS.no_closed_trades : a.error_message || ANALYSIS_ERRORS.read_error,
    preview,
  };
}

export async function analysisRoutes(app: App, deps: Deps) {
  const upload = async (req: any, reply: any) => {
    const user = await requireUser(req, reply); if (!user) return;
    const acct = await deps.db.selectFrom('users').select('status').where('id', '=', user.id).executeTakeFirst();
    if (!acct || acct.status !== 'active') return fail(reply, 403, 'blocked', 'This account is disabled.');

    const counts = await analysisCounts(deps.db, user.id);
    if (counts.running >= RUNNING_ANALYSES) return fail(reply, 429, 'too_many_running', 'Wait for your current files to finish, then try again.');
    if (counts.today >= DAILY_ANALYSES) return fail(reply, 429, 'daily_limit', `You can analyse up to ${DAILY_ANALYSES} uploads a day. Try again tomorrow.`);
    if (!req.isMultipart()) return fail(reply, 415, 'invalid_upload', 'Send the files as a form upload.');

    const fields: Record<string, string> = {};
    const files: { name: string; bytes: Buffer }[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') files.push({ name: String(part.filename || 'file').slice(0, 255), bytes: await part.toBuffer() });
      else fields[part.fieldname] = String(part.value ?? '');
    }

    if (fields.consent !== 'true') return fail(reply, 400, 'consent_required', 'Tick the box to agree to processing before uploading.');
    if (!files.length) return fail(reply, 400, 'no_files', 'Choose at least one broker statement.');
    const currency = fields.currency ? fields.currency.toUpperCase() : null;
    if (currency && !/^[A-Z]{3,4}$/.test(currency)) return fail(reply, 400, 'bad_currency', 'Unknown currency.');

    // "+" flow: re-analyse the report's current statements together with the new ones.
    let targetReportId: string | null = null, existingFileIds: string[] = [];
    let maxFiles = MAX_FILES;
    if (fields.reportId) {
      if (!UUID.test(fields.reportId)) return fail(reply, 404, 'not_found');
      const r = await deps.db.selectFrom('reports as r').innerJoin('subscriptions as s', 's.id', 'r.subscription_id')
        .select(['r.id', 'r.analysis_id', 's.files_per_report', 's.ends_at'])
        .where('r.id', '=', fields.reportId).where('r.user_id', '=', user.id).where('r.purged_at', 'is', null).executeTakeFirst();
      if (!r || !r.analysis_id) return fail(reply, 404, 'not_found');
      // credits spec: "+" is free only while the report's plan window is open (checked before any file is stored)
      if (new Date(r.ends_at).getTime() <= Date.now()) {
        return fail(reply, 402, 'plan_expired', 'Your plan has ended. Your reports are still here. Choose a plan to add statements or create new reports.');
      }
      const prev = await deps.db.selectFrom('analysis_files as af').innerJoin('statement_files as f', 'f.id', 'af.file_id')
        .select(['f.id', 'f.status']).where('af.analysis_id', '=', r.analysis_id).orderBy('af.position').execute();
      if (prev.some((f) => f.status !== 'stored')) {
        return fail(reply, 409, 'files_expired', 'The statements in this report were deleted after 30 days, so new files can’t be added to it. Start a new report instead.');
      }
      targetReportId = r.id; existingFileIds = prev.map((f) => f.id); maxFiles = r.files_per_report;
    } else {
      const plan = await deps.db.selectFrom('subscriptions').select(sql<number>`max(files_per_report)`.as('m'))
        .where('user_id', '=', user.id).where('ends_at', '>', sql<Date>`now()`).where(sql<boolean>`reports_used < reports_total`).executeTakeFirst();
      if (plan?.m) maxFiles = Math.min(MAX_FILES, plan.m);
    }
    if (existingFileIds.length + files.length > maxFiles) {
      return fail(reply, 400, 'too_many_files', `Your plan allows up to ${maxFiles} broker statement${maxFiles === 1 ? '' : 's'} per report.`);
    }

    // Check every file before storing any.
    const checked = [];
    for (const f of files) {
      const s = sniff(f.name, f.bytes);
      if (!s.ok) {
        await trackWith(deps.pool, user.id, 'upload_failed', { reason: s.reason, ext: f.name.split('.').pop()?.toLowerCase() });
        return fail(reply, s.reason === 'bad_extension' ? 400 : 415, s.reason, FILE_ERRORS[s.reason](f.name));
      }
      checked.push({ ...f, ext: s.ext, kind: s.kind });
    }

    const rows: NewUploadFile[] = [];
    for (const f of checked) {
      const enc = encryptFile(f.bytes, deps.config.keks.current);
      const storageKey = `f/${crypto.randomUUID()}`;
      await deps.storage.put(storageKey, enc.body);
      rows.push({
        originalName: f.name, ext: f.ext, detectedKind: f.kind, sizeBytes: f.bytes.length,
        sha256: crypto.createHash('sha256').update(f.bytes).digest('hex'), storageKey,
        encKeyId: enc.encKeyId, wrappedDek: enc.wrappedDek, iv: enc.iv,
      });
    }
    const ip = ipOf(req);
    const { analysisId } = await createUpload(deps.db, { userId: user.id, files: rows, targetReportId, existingFileIds, currencyOverride: currency, ip });

    const consentBase = { userId: user.id, policyVersion: CONSENT_POLICY_VERSION, ipHash: ipHash(deps.config.ipHashSecret, ip), userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
    await recordConsent(deps.db, { ...consentBase, purpose: 'processing', granted: true, textSha256: consentTextSha256('processing') });
    if (fields.research === 'true' && !(await currentConsents(deps.db, user.id)).research) {
      await recordConsent(deps.db, { ...consentBase, purpose: 'research', granted: true, textSha256: consentTextSha256('research') });
    }

    await deps.queue.enqueue(analysisId);
    await trackWith(deps.pool, user.id, 'upload_started', { files: rows.length, ext: rows.map((r) => r.ext.slice(1)).join(','), ...(fields.source === 'blog' ? { source: 'blog' } : {}) });
    return ok(reply, { analysisId, status: 'queued' }, 202);
  };
  const uploadSchema = {
    tags: ['analyses'], security: [{ session: [] }], consumes: ['multipart/form-data'],
    summary: 'Upload 1–3 broker statements (multipart: files, consent=true, research?, currency?, reportId? for "+")',
  };
  const uploadLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  app.post('/analyses', { schema: uploadSchema, config: uploadLimit }, upload);
  app.post('/uploads', { schema: { ...uploadSchema, summary: 'Alias of POST /analyses (master prompt name)' }, config: uploadLimit }, upload);

  /**
   * Remove a statement from a report: starts an analysis over the remaining statements (no upload). Applying it with
   * POST /reports/:id/files keeps the removed statement's place (file-set lock), as in the offline tool.
   */
  app.post('/reports/:id/files/remove', {
    schema: { tags: ['reports'], summary: 'Re-analyse a report without one of its statements', security: [{ session: [] }],
      params: z.object({ id: z.string() }), body: z.object({ fileId: z.string().regex(UUID) }) },
    config: uploadLimit,
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const counts = await analysisCounts(deps.db, user.id);
    if (counts.running >= RUNNING_ANALYSES) return fail(reply, 429, 'too_many_running', 'Wait for your current files to finish, then try again.');
    if (counts.today >= DAILY_ANALYSES) return fail(reply, 429, 'daily_limit', `You can analyse up to ${DAILY_ANALYSES} uploads a day. Try again tomorrow.`);
    const r = await deps.db.selectFrom('reports').select(['id', 'analysis_id']).where('id', '=', req.params.id).where('user_id', '=', user.id).where('purged_at', 'is', null).executeTakeFirst();
    if (!r?.analysis_id) return fail(reply, 404, 'not_found');
    const files = await deps.db.selectFrom('analysis_files as af').innerJoin('statement_files as f', 'f.id', 'af.file_id')
      .select(['f.id', 'f.status']).where('af.analysis_id', '=', r.analysis_id).orderBy('af.position').execute();
    if (!files.some((f) => f.id === req.body.fileId)) return fail(reply, 404, 'not_found');
    if (files.length < 2) return fail(reply, 400, 'last_file', 'A report needs at least one statement. Delete the report instead.');
    const keep = files.filter((f) => f.id !== req.body.fileId);
    if (keep.some((f) => f.status !== 'stored')) {
      return fail(reply, 409, 'files_expired', 'The statements in this report were deleted after 30 days, so it can’t be changed. Start a new report instead.');
    }
    const { analysisId } = await createUpload(deps.db, { userId: user.id, files: [], targetReportId: r.id, existingFileIds: keep.map((f) => f.id), ip: ipOf(req) });
    await deps.queue.enqueue(analysisId);
    return ok(reply, { analysisId, status: 'queued' }, 202);
  });

  app.get('/analyses/:id', {
    schema: { tags: ['analyses'], summary: 'Job status (queued / parsing / analysing / storing / ready / failed) and preview', security: [{ session: [] }], params: z.object({ id: z.string() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const a = await getAnalysis(deps.db, user.id, req.params.id);
    return a ? ok(reply, analysisView(a)) : fail(reply, 404, 'not_found');
  });

  /** The latest job for a report (the "+" flow), or ready when nothing is running. */
  app.get('/reports/:id/status', {
    schema: { tags: ['reports'], summary: 'Status of the latest job for a report', security: [{ session: [] }], params: z.object({ id: z.string() }) },
  }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const owned = await deps.db.selectFrom('reports').select('id').where('id', '=', req.params.id).where('user_id', '=', user.id).where('purged_at', 'is', null).executeTakeFirst();
    if (!owned) return fail(reply, 404, 'not_found');
    const latest = await deps.db.selectFrom('analyses').select('id')
      .where('user_id', '=', user.id)
      .where((eb) => eb.or([eb('target_report_id', '=', req.params.id), eb('report_id', '=', req.params.id)]))
      .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (!latest) return ok(reply, { reportId: req.params.id, status: 'ready', analysis: null });
    const a = (await getAnalysis(deps.db, user.id, latest.id))!;
    return ok(reply, { reportId: req.params.id, status: a.status, analysis: analysisView(a) });
  });
}
