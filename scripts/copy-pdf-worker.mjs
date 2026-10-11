/**
 * @file  scripts/copy-pdf-worker.mjs
 * @area  Ops
 * @what  postinstall: copies the pdf.js worker into public/.
 */
// Copies pdf.js's worker into public/ so it is served as a static file (Next 14's minifier
// can't process the worker's modern syntax). Runs on postinstall; keeps versions in sync.
import fs from 'node:fs';
import path from 'node:path';
const src = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const dst = path.resolve('public/pdf.worker.min.mjs');
if (fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log('pdf.js worker → public/pdf.worker.min.mjs'); }
