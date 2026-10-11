/**
 * @file  tests/golden.test.ts
 * @area  Tests
 * @what  Engine parity: every fixture through the worker's path must equal the stored golden JSON byte for byte.
 */
/**
 * Goldens were generated from the ORIGINAL browser engine before it was moved (backend-v2 phase 1).
 * Regenerate only on a deliberate, reviewed engine change:  UPDATE_GOLDENS=1 npm test
 * Path = what the browser worker did: fileToRawSheets (per file) → analyzeRaw (all files together).
 * Only `generatedAt` is normalised; everything else must match exactly.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import CFB from 'cfb';
// @ts-ignore - legacy build has no bundled types
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore - plain JS module
import { fileToRawSheets } from '@/lib/engine/extract.js';
import { analyzeRaw } from '@/lib/engine';
import type { RawSheet } from '@/lib/engine/types';

const FIXTURES = path.join(__dirname, 'fixtures');
const GOLDEN = path.join(__dirname, 'golden');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

interface Case { id: string; files: string[]; currency?: string }
const single = fs.readdirSync(FIXTURES).filter((f) => !f.startsWith('.')).sort().map((f) => ({ id: f.replace(/\W+/g, '_'), files: [f] }));
const CASES: Case[] = [
  ...single,
  { id: 'combo_tradebook_plus_other_account', files: ['zerodha_tradebook.csv', 'groww_pnl.csv'] },
  { id: 'combo_three_files', files: ['zerodha_equity_statement.xlsx', 'zerodha_fo_statement.xlsx', 'dhan_tradebook.csv'] },
  { id: 'combo_pdf_and_doc', files: ['zerodha_tradebook.pdf', 'groww_pnl.doc'] },
  { id: 'currency_override_eur', files: ['ibkr_tradebook.csv'], currency: 'EUR' },
  { id: 'currency_override_inr_on_usd', files: ['binance_trades.csv'], currency: 'INR' },
];

/** Plain-JSON copy; engine internals may hold shared references, so cycles become a marker instead of throwing. */
function toJson(v: unknown) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(v, (_k, x) => {
    if (x && typeof x === 'object') { if (seen.has(x)) return '[circular]'; seen.add(x); }
    return x;
  }));
}

async function runCase(c: Case) {
  const raw: RawSheet[] = [];
  for (const f of c.files) raw.push(...(await fileToRawSheets(XLSX, f, new Uint8Array(fs.readFileSync(path.join(FIXTURES, f))), { pdfjs, CFB })));
  const { result, report } = analyzeRaw(raw, { currency: c.currency });
  return toJson({
    case: c,
    rawSha256: crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    report: report ? { ...report, generatedAt: '<normalised>' } : null,
    m: result.m,
    trades: result.trades,
  });
}

describe('engine parity (golden files)', () => {
  it('runs with the pinned server timezone (Asia/Kolkata, UTC+5:30)', () => {
    expect(new Date(2024, 0, 1).getTimezoneOffset()).toBe(-330);
  });
  for (const c of CASES) {
    it(`${c.id}`, async () => {
      const actual = JSON.stringify(await runCase(c), null, 1);
      const file = path.join(GOLDEN, `${c.id}.json`);
      if (UPDATE) { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, actual + '\n'); return; }
      expect(fs.existsSync(file), `missing golden ${c.id}.json — generate with UPDATE_GOLDENS=1`).toBe(true);
      expect(actual + '\n').toBe(fs.readFileSync(file, 'utf8'));
    });
  }
});
