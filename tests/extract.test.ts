/**
 * @file  tests/extract.test.ts
 * @area  Tests
 * @what  PDF, DOCX and legacy DOC reading matches the CSV originals.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import CFB from 'cfb';
// @ts-ignore - legacy build has no bundled types
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore - plain JS module
import { fileToRawSheets, detectKind } from '@/lib/engine/extract.js';
import { analyzeRaw } from '@/lib/engine';

const fx = (f: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f)));
const run = async (f: string) => analyzeRaw(await fileToRawSheets(XLSX, f, fx(f), { pdfjs, CFB })).report!;

describe('document formats', () => {
  it('detects kinds by content, not just extension', () => {
    expect(detectKind('a.pdf', fx('groww_pnl.pdf'))).toBe('pdf');
    expect(detectKind('a.docx', fx('dhan_tradebook.docx'))).toBe('docx');
    expect(detectKind('a.doc', fx('groww_pnl.doc'))).toBe('doc');
    expect(detectKind('a.xlsx', fx('zerodha_fo_statement.xlsx'))).toBe('sheet');
  });
  it('PDF statement matches the CSV original', async () => {
    const r = await run('groww_pnl.pdf');
    expect(r.m.n).toBe(5); expect(r.m.realized).toBeCloseTo(-10221.42, 0);
  });
  it('multi-page PDF tradebook rebuilds round trips', async () => {
    const r = await run('zerodha_tradebook.pdf');
    expect(r.m.source).toBe('tradebook'); expect(r.m.n).toBe(60);
  });
  it('DOCX tradebook matches the CSV original', async () => {
    const r = await run('dhan_tradebook.docx');
    expect(r.m.n).toBe(30); expect(Math.round(r.m.realized)).toBe(83458);
  });
  it('legacy Word 97 .doc is read', async () => {
    const r = await run('groww_pnl.doc');
    expect(r.m.n).toBe(5); expect(r.m.realized).toBeCloseTo(-10221.42, 0);
  });
});
