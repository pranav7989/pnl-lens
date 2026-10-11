/**
 * @file  lib/engine/extract.js
 * @area  Engine
 * @what  Reads PDF (pdf.js), Word .docx/.doc and RTF into table rows for the engine.
 */
// @ts-nocheck
/**
 * Turns non-spreadsheet broker files into the same row arrays the engine reads from Excel/CSV.
 *   PDF   → pdf.js text positions → lines (by y) → cells (by x gaps)        [text PDFs only]
 *   DOCX  → word/document.xml tables (via SheetJS's zip reader)           [no extra library]
 *   DOC   → Word 97–2003 binary: piece table → text → table rows (cell mark \x07)
 *   RTF / HTML saved as .doc → handled here (RTF) or by SheetJS (HTML tables)
 * Libraries are injected (XLSX, pdfjs) so this runs in the browser, the Web Worker and node tests.
 */

const td = (enc) => new TextDecoder(enc);
const u8 = (c) => (c instanceof Uint8Array ? new Uint8Array(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)) : Uint8Array.from(c));

export function detectKind(name, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = String.fromCharCode(...b.slice(0, 8));
  if (head.startsWith('%PDF')) return 'pdf';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return /\.docx?$/i.test(name) ? 'doc' : 'sheet'; // CFB: .doc or legacy .xls
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (b[0] === 0x50 && b[1] === 0x4b) return /\.docx$/i.test(name) ? 'docx' : (/\.doc$/i.test(name) ? 'docx' : 'sheet'); // zip
  if (/\.(docx?|pdf)$/i.test(name)) {
    const txt = td('utf-8').decode(b.slice(0, 2048)).toLowerCase();
    if (txt.includes('<table') || txt.includes('<html')) return 'sheet'; // HTML disguised as .doc — SheetJS reads it
  }
  return 'sheet';
}

/* ---------------- shared helpers ---------------- */
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
function textBlockToRows(text) {
  // Word binary text: each cell ends with \x07 and each row ends with one more \x07, so an empty cell
  // and a row end look the same. The header row (no blank cells in broker exports) fixes the width k:
  // the first empty token after it is the row end, then every (k+1)th token is a row end.
  const rows = [];
  for (const p of text.replace(/\r\n?/g, '\r').split('\r')) {
    if (p.includes('\x07')) {
      const tokens = p.split('\x07').map(clean);
      if (tokens[tokens.length - 1] === '') tokens.pop(); // text after the final mark
      const k = tokens.indexOf('');
      if (k <= 0) { rows.push(tokens); continue; }
      for (let i = 0; i < tokens.length; i += k + 1) rows.push(tokens.slice(i, i + k));
    } else {
      const line = p.includes('\t') ? p.split('\t').map(clean) : [clean(p)];
      rows.push(line.some((c) => c !== '') ? line : []);
    }
  }
  return rows;
}

/* ---------------- DOCX ---------------- */
export function docxToRows(CFB, bytes) {
  const zip = CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' });
  const entry = CFB.find(zip, 'word/document.xml') || CFB.find(zip, '/word/document.xml') || CFB.find(zip, 'Root Entry/word/document.xml');
  if (!entry) throw new Error('This Word file has no document body');
  const xml = td('utf-8').decode(u8(entry.content));
  const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const cellText = (c) => clean(unxml((c.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(' ')));
  const rows = [];
  // walk body in order so paragraphs before a table (titles, periods) are kept as single-cell rows
  const body = xml.split(/<w:body>/)[1] || xml;
  const tokens = body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
  for (const tok of tokens) {
    if (tok.startsWith('<w:tbl>')) {
      for (const tr of tok.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []) rows.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(cellText));
      rows.push([]);
    } else {
      const t = cellText(tok);
      rows.push(t ? [t] : []);
    }
  }
  return [{ name: 'Document', rows }];
}

/* ---------------- legacy .doc (Word 97–2003) ---------------- */
export function docToRows(CFB, bytes) {
  const cfb = CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' });
  const wd = CFB.find(cfb, 'WordDocument');
  if (!wd) throw new Error('Not a Word document');
  const w = u8(wd.content), dv = new DataView(w.buffer);
  const flags = dv.getUint16(0x0a, true);
  const table = CFB.find(cfb, (flags & 0x0200) ? '1Table' : '0Table');
  if (!table) throw new Error('Word table stream missing');
  const t = u8(table.content), tv = new DataView(t.buffer);
  // FIB: csw, fibRgW, cslw, fibRgLw, cbRgFcLcb, then FibRgFcLcb97 where fcClx/lcbClx are entries 33
  let pos = 32; const csw = dv.getUint16(pos, true); pos += 2 + csw * 2;
  const cslw = dv.getUint16(pos, true); pos += 2 + cslw * 4;
  pos += 2; // cbRgFcLcb
  const fcClx = dv.getUint32(pos + 33 * 8, true), lcbClx = dv.getUint32(pos + 33 * 8 + 4, true);
  let p = fcClx; const end = fcClx + lcbClx;
  while (p < end && t[p] === 0x01) p += 3 + tv.getUint16(p + 1, true); // skip Prc
  if (t[p] !== 0x02) throw new Error('Unsupported Word format');
  const lcb = tv.getUint32(p + 1, true); p += 5;
  const n = (lcb - 4) / 12;
  const cps = [], pcds = [];
  for (let i = 0; i <= n; i++) cps.push(tv.getUint32(p + i * 4, true));
  const pcdBase = p + (n + 1) * 4;
  for (let i = 0; i < n; i++) pcds.push(tv.getUint32(pcdBase + i * 8 + 2, true));
  let text = '';
  const cp1252 = td('windows-1252'), u16 = td('utf-16le');
  for (let i = 0; i < n; i++) {
    const len = cps[i + 1] - cps[i]; if (len <= 0) continue;
    const fc = pcds[i];
    if (fc & 0x40000000) { const off = (fc & 0x3fffffff) / 2; text += cp1252.decode(w.slice(off, off + len)); }
    else text += u16.decode(w.slice(fc, fc + len * 2));
  }
  return [{ name: 'Document', rows: textBlockToRows(text) }];
}

/* ---------------- RTF ---------------- */
export function rtfToRows(bytes) {
  let s = td('windows-1252').decode(bytes);
  s = s.replace(/\\cell\b ?/g, '\x07').replace(/\\row\b ?/g, '\x07\r').replace(/\\(par|line)\b ?/g, '\r').replace(/\\tab\b ?/g, '\t')
       .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
       .replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return [{ name: 'Document', rows: textBlockToRows(s) }];
}

/* ---------------- PDF ---------------- */
export async function pdfToRows(pdfjs, bytes) {
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const rows = [];
  let anyText = false;
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 8, s: i.str }));
    if (items.length) anyText = true;
    // group into lines by y (tolerance scales with font size)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35));
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null;
      for (const it of l.items) {
        const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
        const charW = it.w / Math.max(1, it.s.length) || it.h * 0.5;
        if (cur && gap < Math.max(2.2, charW * 1.1)) { cur.s += (gap > charW * 0.25 ? ' ' : '') + it.s; cur.w = it.x + it.w - cur.x; }
        else { cur = { x: it.x, w: it.w, s: it.s }; cells.push(cur); }
      }
      rows.push(cells.map((c) => clean(c.s)));
    }
    rows.push([]); // page break
    page.cleanup();
  }
  await task.destroy();
  if (!anyText) throw new Error('This PDF has no readable text (it may be a scan). Download the Excel/CSV or a text PDF from your broker.');
  return [{ name: 'PDF', rows: dropRepeatedHeaders(rows) }];
}

/** Multi-page PDFs repeat the table header on each page; keep the first one so rows stay in one table. */
function dropRepeatedHeaders(rows) {
  const key = (r) => r.join('\u0001').toLowerCase();
  const seen = new Map();
  for (const r of rows) if (r.length >= 3) seen.set(key(r), (seen.get(key(r)) || 0) + 1);
  const repeated = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  const out = [], used = new Set();
  for (const r of rows) {
    if (!r.length) continue; // page breaks inside one table would end it early
    const k = key(r);
    if (repeated.has(k)) { if (used.has(k)) continue; used.add(k); }
    out.push(r);
  }
  return out;
}

/**
 * Entry point. Returns RawSheet[] ({ file, name, rows }) for one file, whatever its format.
 * opts.pdfjs is required only for PDFs (lazy-load it in the caller).
 * opts.CFB: SheetJS's `cfb` reader; defaults to XLSX.CFB (present in the full browser build, absent in the ESM build).
 */
export async function fileToRawSheets(XLSX, name, bytes, opts = {}) {
  const kind = detectKind(name, bytes);
  const CFB = opts.CFB || XLSX.CFB;
  if ((kind === 'docx' || kind === 'doc') && !CFB) throw new Error('Word support is not loaded');
  const tag = (sheets) => sheets.map((s) => ({ file: name, name: s.name, rows: s.rows }));
  if (kind === 'pdf') {
    if (!opts.pdfjs) throw new Error('PDF support is not loaded');
    return tag(await pdfToRows(opts.pdfjs, bytes));
  }
  if (kind === 'docx') return tag(docxToRows(CFB, bytes));
  if (kind === 'doc') return tag(docToRows(CFB, bytes));
  if (kind === 'rtf') return tag(rtfToRows(bytes));
  const wb = XLSX.read(bytes, { type: 'array' });
  return wb.SheetNames.map((n) => ({ file: name, name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true, blankrows: true }) }));
}
