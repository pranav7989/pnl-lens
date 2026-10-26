/**
 * @file  apps/worker/src/research.ts
 * @area  Worker
 * @what  Research dataset (every 1st and 16th, or "Build now"): CSVs from the pseudonymised research views (opted-in users only), zipped, encrypted, kept 90 days; expiry sweep.
 */
/**
 * Reads only research.subjects / trades / report_metrics / report_traits (0014): users whose current research consent
 * is yes, user id replaced by a stable HMAC pseudonym ("subject"). Internal report ids never leave the database: each
 * export replaces them with HMAC(report id, a random key made for this export and then discarded), so files from one
 * export line up but cannot be joined back to the database or to another export's report ids.
 * Pseudonymised, not anonymous: the subject key lives in the database. Stored like the data exports (encrypted, in the
 * exports bucket under research/), readable only by the API's read-only key, downloaded by the owner (audited).
 */
import crypto from 'node:crypto';
import { sql } from 'kysely';
import { encryptFile, type Kek } from '@pnl-lens/shared/file-crypto';
import type { Db } from '@pnl-lens/db';
import type { WorkerStorage } from './storage.js';
import { buildZip } from './zip.js';

export const RESEARCH_KEEP_DAYS = 90;

export interface ResearchDeps { db: Db; storage: WorkerStorage; currentKek: Kek }
type Row = Record<string, unknown>;

/** RFC 4180 CSV. Text that a spreadsheet would run as a formula (= + - @ at the start, not a number) gets a leading '. */
export function toCsv(rows: Row[], columns: string[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

const README = (at: Date, counts: { subjects: number; reports: number; trades: number }, engines: string[]) => `# PnL Lens research dataset

Built: ${at.toISOString()} · traders: ${counts.subjects} · reports: ${counts.reports} · trades: ${counts.trades}
Engine version(s): ${engines.join(', ') || '—'}

## Who is in it
Only users whose research consent ("Also let PnL Lens use my data, anonymised, to improve its analysis") was ON when
this file was built, with an active account and at least one report (traders with no reports are left out). Each file is a full snapshot: someone who withdraws consent is left out
of the next dataset. Delete old datasets when they are no longer needed (they are kept 90 days on the server).

## Privacy
Pseudonymised, not anonymous. There are no emails, names, file names, broker client ids or internal ids.
- subject   = a stable pseudonym for one trader (the same in every dataset)
- report    = a pseudonym for one report, valid inside THIS dataset only
Do not try to re-identify anyone, do not combine with other data to do so, and do not share outside PnL Lens.

## Files
subjects.csv   subject, country (2 letters, may be empty), joined_month
reports.csv    one row per report: subject, report, trade count, wins/losses, win rate, payoff, profit factor,
               realized / charges / other / net P&L (report currency), from/to dates, source (broker or file type),
               market, currency, progress score, extra (JSON with more statistics), engine version
trades.csv     one row per closed position: subject, report, symbol, market, instrument, direction, entry/exit
               dates and hour, holding days, quantity, prices, P&L, %, style and more (engine field names)
habits.csv     the behavioural traits found per report: trait id, area, name, score, level, primary

Numbers use a dot as decimal separator. Dates are YYYY-MM-DD; times are UTC.
`;

/** Builds one dataset. id: a "Build now" row (pending); none = the schedule creates its own. */
export async function buildResearchExport(deps: ResearchDeps, id?: string): Promise<{ id: string; status: 'ready' | 'skipped' }> {
  let rowId = id;
  if (rowId) {
    const r = await deps.db.updateTable('research_exports').set({ status: 'building' }).where('id', '=', rowId).where('status', '=', 'pending')
      .returning('id').executeTakeFirst();
    if (!r) return { id: rowId, status: 'skipped' };
  } else {
    const running = await deps.db.selectFrom('research_exports').select('id').where('status', 'in', ['pending', 'building']).executeTakeFirst();
    if (running) return { id: running.id, status: 'skipped' };                       // a manual build is already on its way
    rowId = (await deps.db.insertInto('research_exports').values({ requested_by: null, status: 'building' }).returning('id').executeTakeFirstOrThrow()).id;
  }
  try {
    // one consistent snapshot of consent and data
    const data = await deps.db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      const q = async (text: string) => (await sql.raw<Row>(text).execute(trx)).rows;
      return {
        subjects: await q('select subject, country, joined_month from research.subjects order by joined_month, subject'),
        reports: await q('select * from research.report_metrics order by subject, from_date nulls last, report_id'),
        trades: await q('select * from research.trades order by subject, report_id, seq'),
        habits: await q('select * from research.report_traits order by subject, report_id, trait_id'),
      };
    });

    // per-export report pseudonyms; the key is never stored
    const key = crypto.randomBytes(32);
    const pseudo = new Map<string, string>();
    const report = (id: unknown) => {
      const k = String(id);
      if (!pseudo.has(k)) pseudo.set(k, crypto.createHmac('sha256', key).update(k).digest('hex').slice(0, 24));
      return pseudo.get(k)!;
    };
    const swap = (rows: Row[]): Row[] => rows.map(({ report_id, ...r }) => ({ subject: r.subject, report: report(report_id), ...r }));
    const reports = swap(data.reports), trades = swap(data.trades), habits = swap(data.habits);
    // a trader is listed only with at least one report in this dataset (opted in but no reports yet, or all deleted: left out)
    const withData = new Set(reports.map((r) => r.subject));
    const subjects = data.subjects.filter((s) => withData.has(s.subject));
    const cols = (rows: Row[], fallback: string[]) => (rows[0] ? Object.keys(rows[0]) : fallback);

    const at = new Date();
    const counts = { subjects: subjects.length, reports: reports.length, trades: trades.length };
    const engines = [...new Set(reports.map((r) => String(r.engine_version ?? '')).filter(Boolean))].sort();
    const zip = buildZip([
      { name: 'README.md', data: Buffer.from(README(at, counts, engines)) },
      { name: 'subjects.csv', data: Buffer.from(toCsv(subjects, ['subject', 'country', 'joined_month'])) },
      { name: 'reports.csv', data: Buffer.from(toCsv(reports, cols(reports, ['subject', 'report']))) },
      { name: 'trades.csv', data: Buffer.from(toCsv(trades, cols(trades, ['subject', 'report']))) },
      { name: 'habits.csv', data: Buffer.from(toCsv(habits, cols(habits, ['subject', 'report']))) },
    ]);
    const enc = encryptFile(zip, deps.currentKek);
    const storageKey = `research/${crypto.randomUUID()}`;
    await deps.storage.putExport(storageKey, enc.body);
    await deps.db.updateTable('research_exports').set({
      status: 'ready', ...counts, storage_key: storageKey, enc_key_id: enc.encKeyId, wrapped_dek: enc.wrappedDek, iv: enc.iv, size_bytes: zip.length,
      completed_at: sql`now()` as any, expires_at: sql`now() + make_interval(days => ${RESEARCH_KEEP_DAYS})` as any, error: null,
    }).where('id', '=', rowId).execute();
    return { id: rowId, status: 'ready' };
  } catch (e) {
    await deps.db.updateTable('research_exports').set({ status: 'failed', error: String((e as Error).message || e).slice(0, 200), completed_at: sql`now()` as any })
      .where('id', '=', rowId).execute();
    throw e;
  }
}

/** Deletes datasets older than 90 days (object and key). The row stays as a record. */
export async function sweepResearch(db: Db, storage: WorkerStorage): Promise<number> {
  const due = await db.selectFrom('research_exports').select(['id', 'storage_key'])
    .where('status', '=', 'ready').where('deleted_at', 'is', null).where('expires_at', '<', sql<Date>`now()`).limit(100).execute();
  for (const r of due) {
    if (r.storage_key) await storage.deleteExport(r.storage_key).catch((e: any) => { if (e?.name !== 'NoSuchKey') throw e; });
    await db.updateTable('research_exports').set({ storage_key: null, wrapped_dek: null, iv: null, deleted_at: sql`now()` as any }).where('id', '=', r.id).execute();
  }
  return due.length;
}
