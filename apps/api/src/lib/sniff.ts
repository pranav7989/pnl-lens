/**
 * @file  apps/api/src/lib/sniff.ts
 * @area  API
 * @what  Upload type check: the real file type from its bytes (the engine's own detectKind) plus a reject list for non-statements.
 */
/**
 * The engine decides how to read a file from its bytes, not its name, and is deliberately lenient (HTML saved as
 * .xls or .doc is read as a sheet). The API must not refuse anything the engine reads, so it reuses detectKind() and
 * only adds refusals: executables, images, archives, a ZIP that is not Excel/Word, binary data posing as CSV/HTML,
 * and a .pdf that is neither a PDF nor an HTML export.
 */
// @ts-ignore - plain JS module from the engine (moved unchanged, rule 1)
import { detectKind } from '@pnl-lens/engine/extract';
import { ACCEPTED_EXT } from '@pnl-lens/shared/limits';

export type DetectedKind = 'sheet' | 'pdf' | 'docx' | 'doc' | 'rtf';
export type SniffResult = { ok: true; ext: string; kind: DetectedKind } | { ok: false; reason: 'bad_extension' | 'bad_file_type' | 'empty' };

const startsWith = (b: Buffer, sig: number[]) => sig.every((x, i) => b[i] === x);
const BLOCKED: number[][] = [
  [0x4d, 0x5a],                         // MZ: Windows executable
  [0x7f, 0x45, 0x4c, 0x46],             // ELF
  [0xcf, 0xfa, 0xed, 0xfe], [0xfe, 0xed, 0xfa, 0xcf], [0xca, 0xfe, 0xba, 0xbe],   // Mach-O / Java class
  [0x89, 0x50, 0x4e, 0x47],             // PNG
  [0xff, 0xd8, 0xff],                   // JPEG
  [0x47, 0x49, 0x46, 0x38],             // GIF
  [0x1f, 0x8b],                         // gzip
  [0x52, 0x61, 0x72, 0x21],             // RAR
  [0x37, 0x7a, 0xbc, 0xaf],             // 7z
  [0x23, 0x21],                         // #! script
];
const isZip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const isCfb = (b: Buffer) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Text (CSV, TSV, HTML table exports): no NUL bytes in the first 64 KB, unless it is UTF-16 with a BOM. */
const looksLikeText = (b: Buffer) => {
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return true;
  return !b.subarray(0, 65536).includes(0);
};
/** ZIP entry names are stored in clear in the local headers. */
const zipHas = (b: Buffer, prefix: string) => b.includes(Buffer.from(prefix, 'latin1'));

export function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function sniff(name: string, bytes: Buffer): SniffResult {
  const ext = extOf(name);
  if (!ACCEPTED_EXT.includes(ext)) return { ok: false, reason: 'bad_extension' };
  if (!bytes.length) return { ok: false, reason: 'empty' };
  if (BLOCKED.some((sig) => startsWith(bytes, sig))) return { ok: false, reason: 'bad_file_type' };

  const kind = detectKind(name, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)) as DetectedKind;
  if (isZip(bytes)) {
    const want = kind === 'docx' ? 'word/' : 'xl/';
    if (!zipHas(bytes, want)) return { ok: false, reason: 'bad_file_type' };            // some other ZIP
    if (ext === '.csv' || ext === '.pdf') return { ok: false, reason: 'bad_file_type' };
    return { ok: true, ext, kind };
  }
  if (isCfb(bytes) || kind === 'pdf' || kind === 'rtf') {
    if (ext === '.csv') return { ok: false, reason: 'bad_file_type' };
    if (kind === 'pdf' && ext !== '.pdf') return { ok: true, ext, kind };              // a PDF saved with another name: the engine reads it as PDF
    return { ok: true, ext, kind };
  }
  // Everything else is read by SheetJS as text (CSV/TSV/HTML). It must be text.
  if (!looksLikeText(bytes)) return { ok: false, reason: 'bad_file_type' };
  if (ext === '.pdf' || ext === '.docx') {
    const head = bytes.subarray(0, 2048).toString('utf8').toLowerCase();
    if (!head.includes('<table') && !head.includes('<html')) return { ok: false, reason: 'bad_file_type' };
  }
  return { ok: true, ext, kind };
}
