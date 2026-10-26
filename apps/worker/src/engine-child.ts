/**
 * @file  apps/worker/src/engine-child.ts
 * @area  Worker
 * @what  Child process that runs the engine on one job's decrypted files (memory-capped, killed on timeout); returns the report, per-file fingerprints, fills and parse info.
 */
/**
 * Runs exactly the parity path (packages/engine/src/node.ts): every file through fileToRawSheets in upload order,
 * then analyzeRaw over all sheets together, so combined reports follow today's rules. Each file is also analysed
 * alone, only to compute its file-set fingerprint the way the offline tool does and to record a parse run.
 * One child per job: the engine's module-level state (setCurrency, plan F4) can never leak between jobs, and a
 * hostile file can only kill this process. The engine is not changed (rule 1).
 */
import { readFiles } from '@pnl-lens/engine/node';
import { analyzeRaw, engine } from '@pnl-lens/engine';
import type { ReportV1 } from '@pnl-lens/engine/types';
import { tradeSetFingerprint, fnv } from '@pnl-lens/db/normalise';

export interface ChildInput { files: { name: string; data: Uint8Array }[]; currency?: string | null }
export interface ChildFill { symbol: string; side: 'buy' | 'sell'; qty: number; price: number | null; fees: number | null; date: string | null; time: string | null; sheet: string }
export interface ChildFile {
  index: number; fingerprint: string; tradeCount: number; sheetCount: number; durationMs: number;
  outcome: 'ok' | 'no_trades'; format: string | null; mapping: unknown[]; fills: ChildFill[];
  /** this file's own report (only when the job has 2+ files; the workspace shows it as the file's tab) */
  report?: ReportV1 | null;
}
export type ChildOutput =
  | { ok: true; report: ReportV1 | null; files: ChildFile[]; durationMs: number }
  | { ok: false; kind: 'read_error'; message: string; fileIndex: number | null };

const pad = (n: number) => String(n).padStart(2, '0');

export async function runEngine(input: ChildInput): Promise<ChildOutput> {
  const t0 = Date.now();
  const opts = input.currency ? { currency: input.currency } : {};
  const files: ChildFile[] = [];
  const allRaw = [];
  for (let i = 0; i < input.files.length; i++) {
    const f = input.files[i], t = Date.now();
    let raw;
    try { raw = await readFiles([f]); }
    catch (e) { return { ok: false, kind: 'read_error', message: (e as Error)?.message || 'Could not read the file', fileIndex: i }; }
    allRaw.push(...raw);
    // fills: the engine's own sheet parser (read-only use; analyzeRaw below parses the same sheets again)
    const fills: ChildFill[] = [];
    for (const s of raw) {
      const parsed = engine.parseSheetAuto(s.rows, s.name, s.file);
      for (const x of parsed.fills || []) {
        fills.push({ symbol: x.symbol, side: x.side === 'S' ? 'sell' : 'buy', qty: x.qty, price: x.price ?? null, fees: x.fees ?? null,
          date: x.date ?? null, time: x.hour != null ? `${pad(x.hour)}:${pad(x.minute ?? 0)}` : null, sheet: s.name });
      }
    }
    const alone = analyzeRaw(raw, opts);
    const trades = alone.report?.trades ?? [];
    files.push({
      index: i,
      // same rule as apps/web/offline/app_offline.js fingerprint(): by trades, or by raw content when there are none
      fingerprint: alone.report ? tradeSetFingerprint(trades) : 'r' + fnv(JSON.stringify(raw).slice(0, 400000)),
      tradeCount: trades.length, sheetCount: raw.length, durationMs: Date.now() - t,
      outcome: alone.report ? 'ok' : 'no_trades',
      format: alone.report?.m.source ?? null,
      mapping: (alone.result as any)?.mapping ?? [],
      fills,
      ...(input.files.length > 1 ? { report: alone.report } : {}),
    });
  }
  const { report } = analyzeRaw(allRaw, opts);
  return { ok: true, report, files, durationMs: Date.now() - t0 };
}

// Child-process entry (only when started by engine-runner): one message in, one message out, then exit.
if (process.env.PNL_ENGINE_CHILD === '1' && process.send) {
  process.once('message', async (msg: ChildInput) => {
    let out: ChildOutput;
    try { out = await runEngine(msg); }
    catch (e) { out = { ok: false, kind: 'read_error', message: (e as Error)?.message || 'Could not read the file', fileIndex: null }; }
    process.send!(out, () => process.exit(0));
  });
}
