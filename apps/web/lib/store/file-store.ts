/**
 * @file  apps/web/lib/store/file-store.ts
 * @area  Reports
 * @what  Report store on a local JSON file (development only).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Store, CreateReportInput, ReportSummary, GetReportResult } from './types';
import { reportTtlDays } from '@pnl-lens/shared/limits';

/** Development store: a single JSON file under .data/. Mirrors the SQL functions' semantics. */
type Row = ReportSummary & { userId: string; report: any | null; fileHashes: string[] };
interface DB { credits: Record<string, number>; reports: Row[] }

const FILE = path.join(process.cwd(), '.data', 'dev-store.json');
const DEFAULT_DEV_CREDITS = Number(process.env.DEV_STARTING_CREDITS || 5);

function load(): DB {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { credits: {}, reports: [] }; }
}
function save(db: DB) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
const summary = ({ userId, report, fileHashes, ...s }: Row): ReportSummary => s;

export class FileStore implements Store {
  async getCredits(userId: string) {
    const db = load();
    if (db.credits[userId] == null) { db.credits[userId] = DEFAULT_DEV_CREDITS; save(db); }
    return db.credits[userId];
  }

  async createReportWithCredit(userId: string, input: CreateReportInput) {
    const db = load();
    const bal = db.credits[userId] ?? DEFAULT_DEV_CREDITS;
    if (bal <= 0) return { error: 'no_credits' as const };
    db.credits[userId] = bal - 1;
    const now = new Date();
    const row: Row = {
      id: crypto.randomUUID(), userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + reportTtlDays() * 864e5).toISOString(),
      fileNames: input.fileNames, fileHashes: input.fileHashes,
      market: input.report.m.market ?? null, currency: input.report.m.currency ?? null,
      tradeCount: input.report.m.n, netPnl: input.report.m.net,
      purged: false, report: input.report,
    };
    db.reports.push(row);
    save(db);
    return { id: row.id };
  }

  async listReports(userId: string) {
    return load().reports.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summary);
  }

  async getReport(userId: string, id: string): Promise<GetReportResult> {
    const r = load().reports.find((x) => x.id === id && x.userId === userId);
    if (!r) return { status: 'not_found' };
    if (r.purged || new Date(r.expiresAt) < new Date()) return { status: 'purged', summary: { ...summary(r), purged: true } };
    return { status: 'ok', summary: summary(r), report: r.report };
  }

  async deleteReport(userId: string, id: string) {
    const db = load();
    const r = db.reports.find((x) => x.id === id && x.userId === userId && !x.purged);
    if (!r) return false;
    r.report = null; r.purged = true; r.fileNames = ['[deleted]'];
    save(db);
    return true;
  }

  async purgeExpired() {
    const db = load();
    let n = 0;
    for (const r of db.reports) if (!r.purged && new Date(r.expiresAt) < new Date()) { r.report = null; r.purged = true; r.fileNames = ['[purged]']; n++; }
    if (n) save(db);
    return n;
  }
}
