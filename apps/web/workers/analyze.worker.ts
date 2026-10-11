/**
 * @file  apps/web/workers/analyze.worker.ts
 * @area  Engine
 * @what  Web Worker: parses spreadsheets/Word files and runs the engine off the main thread.
 */
/// <reference lib="webworker" />
/**
 * Parses files off the main thread. Spreadsheets, CSV and Word files are read here; PDFs are
 * extracted on the page with pdf.js (it needs its own worker) and arrive as ready-made rows.
 * Raw bytes never leave the browser; only the serialized report is posted back.
 */
import * as XLSX from 'xlsx';
import CFB from 'cfb';
import { analyzeRaw, guessHeaders } from '@pnl-lens/engine';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain JS module
import { fileToRawSheets } from '@pnl-lens/engine/extract';
import type { RawSheet, ColumnOverride } from '@pnl-lens/engine/types';

type In =
  | { type: 'analyze'; files: { name: string; data: ArrayBuffer }[]; extracted?: RawSheet[]; currency?: string }
  | { type: 'remap'; override: ColumnOverride; currency?: string };

let raw: RawSheet[] | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    if (msg.type === 'analyze') {
      raw = [...(msg.extracted || [])];
      for (const f of msg.files) raw.push(...(await fileToRawSheets(XLSX, f.name, new Uint8Array(f.data), { CFB })));
    }
    if (!raw) throw new Error('No files loaded');
    const { report } = analyzeRaw(raw, { currency: msg.currency, override: msg.type === 'remap' ? msg.override : undefined });
    (self as any).postMessage({ type: 'result', report, headers: report ? null : guessHeaders(raw) });
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: err?.message || 'Could not read the file' });
  }
};
