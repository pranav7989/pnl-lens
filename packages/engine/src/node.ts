/**
 * @file  packages/engine/src/node.ts
 * @area  Engine
 * @what  Node runner: reads files exactly like the browser worker did (fileToRawSheets per file), then analyzeRaw.
 */
/**
 * The server-side entry point used by the worker and the parity tests.
 * Same path as the old browser flow (workers/analyze.worker.ts + UploadClient's PDF step):
 *   every file → fileToRawSheets(XLSX, name, bytes, { pdfjs, CFB })  → one RawSheet[] in upload order
 *   all sheets together → analyzeRaw(raw, { currency })               (the engine combines files itself)
 * The engine files are unchanged; this module only injects the libraries the browser used to inject.
 * Callers must run with TZ=Asia/Kolkata (plan D9): the engine's date fallback uses the local timezone.
 */
import * as XLSX from 'xlsx';
import CFB from 'cfb';
// @ts-ignore - legacy build has no bundled types
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore - plain JS module
import { fileToRawSheets } from './extract.js';
import { analyzeRaw } from './index';
import type { RawSheet } from './types';

export interface InputFile { name: string; data: Uint8Array }

/** Reads every file into raw sheet rows, in the given order. Throws the engine's own user-facing messages. */
export async function readFiles(files: InputFile[]): Promise<RawSheet[]> {
  const raw: RawSheet[] = [];
  for (const f of files) raw.push(...(await fileToRawSheets(XLSX, f.name, f.data, { pdfjs, CFB })));
  return raw;
}

/** Full analysis of one report's files. `report` is null when no closed trades were found. */
export async function analyzeFiles(files: InputFile[], opts: { currency?: string } = {}) {
  const raw = await readFiles(files);
  const { result, report } = analyzeRaw(raw, { currency: opts.currency });
  return { raw, result, report };
}
