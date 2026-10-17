/**
 * @file  apps/api/test/sniff.test.ts
 * @area  Tests
 * @what  Upload type check: every engine fixture is accepted with the engine's kind; executables, images, wrong ZIPs and binaries posing as CSV are refused.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sniff } from '../src/lib/sniff.js';
import { encryptFile, decryptFile, loadKeks } from '@pnl-lens/shared/file-crypto';

const FIX = path.resolve(__dirname, '../../../packages/engine/test/fixtures');

describe('sniff', () => {
  const expected: Record<string, string> = { '.csv': 'sheet', '.xlsx': 'sheet', '.pdf': 'pdf', '.docx': 'docx' };
  for (const f of fs.readdirSync(FIX)) {
    it(`accepts the engine fixture ${f}`, () => {
      const r = sniff(f, fs.readFileSync(path.join(FIX, f)));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok && expected[r.ext]) expect(r.kind).toBe(expected[r.ext]);
    });
  }
  it('accepts HTML tables saved as .xls / .doc (broker exports)', () => {
    expect(sniff('pnl.xls', Buffer.from('<html><table><tr><td>Symbol</td></tr></table></html>'))).toMatchObject({ ok: true, kind: 'sheet' });
    expect(sniff('pnl.doc', Buffer.from('<html><table><tr><td>Symbol</td></tr></table></html>'))).toMatchObject({ ok: true, kind: 'sheet' });
  });
  it('refuses other extensions', () => expect(sniff('a.exe', Buffer.from('x'))).toEqual({ ok: false, reason: 'bad_extension' }));
  it('refuses empty files', () => expect(sniff('a.csv', Buffer.alloc(0))).toEqual({ ok: false, reason: 'empty' }));
  it('refuses executables, images and archives whatever their name', () => {
    for (const head of [[0x4d, 0x5a, 0x90, 0], [0x7f, 0x45, 0x4c, 0x46], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff, 0xe0], [0x1f, 0x8b, 8, 0], [0x23, 0x21, 0x2f, 0x62]]) {
      expect(sniff('statement.csv', Buffer.from([...head, 1, 2, 3]))).toEqual({ ok: false, reason: 'bad_file_type' });
    }
  });
  it('refuses a ZIP that is not an Excel/Word file, and Excel bytes named .csv', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('random/readme.txt')]);
    expect(sniff('statement.xlsx', zip)).toEqual({ ok: false, reason: 'bad_file_type' });
    const xlsx = fs.readFileSync(path.join(FIX, 'merged_headers.xlsx'));
    expect(sniff('statement.csv', xlsx)).toEqual({ ok: false, reason: 'bad_file_type' });
  });
  it('refuses binary data posing as CSV, and a .pdf that is not a PDF', () => {
    expect(sniff('statement.csv', Buffer.from([0x41, 0, 0x42, 0, 0x43]))).toEqual({ ok: false, reason: 'bad_file_type' });
    expect(sniff('statement.pdf', Buffer.from('Symbol,Qty\nA,1\n'))).toEqual({ ok: false, reason: 'bad_file_type' });
  });
});

describe('file encryption', () => {
  const kek = { id: 'k1', key: crypto.randomBytes(32) };
  it('round-trips, never stores plaintext, and fails with the wrong key or a changed byte', () => {
    const plain = Buffer.from('Symbol,Qty,P&L\nRELIANCE,10,-120\n'.repeat(50));
    const e = encryptFile(plain, kek);
    expect(e.body.includes(plain.subarray(0, 20))).toBe(false);
    expect(e.wrappedDek).toHaveLength(60);
    expect(decryptFile(e.body, e.iv, e.wrappedDek, kek).equals(plain)).toBe(true);
    expect(() => decryptFile(e.body, e.iv, e.wrappedDek, { id: 'k1', key: crypto.randomBytes(32) })).toThrow();
    expect(() => decryptFile(e.body, e.iv, e.wrappedDek, { id: 'k2', key: kek.key })).toThrow();      // key id is bound in
    const tampered = Buffer.from(e.body); tampered[5] ^= 1;
    expect(() => decryptFile(tampered, e.iv, e.wrappedDek, kek)).toThrow();
  });
  it('loads keys from env and refuses bad ones', () => {
    const hex = crypto.randomBytes(32).toString('hex');
    expect(loadKeks({ FILE_KEK_ID: 'k1', FILE_KEK_K1: hex }).current.id).toBe('k1');
    expect(() => loadKeks({ FILE_KEK_ID: 'k1', FILE_KEK_K1: 'short' })).toThrow(/64 hex/);
    expect(() => loadKeks({ FILE_KEK_ID: 'k2', FILE_KEK_K1: hex })).toThrow(/FILE_KEK_K2/);
    expect(() => loadKeks({})).toThrow(/FILE_KEK_ID/);
  });
});
