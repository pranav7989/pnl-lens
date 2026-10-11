/**
 * @file  apps/web/scripts/copy-pdf-worker.mjs
 * @area  Ops
 * @what  postinstall: copies the pdf.js worker into public/.
 */
// Copies pdf.js's worker into public/ so it is served as a static file (Next 14's minifier
// can't process the worker's modern syntax). Runs on postinstall; keeps versions in sync.
// npm workspaces hoist dependencies to the repo root, so the package is resolved, not assumed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let src = null;
try { src = path.join(path.dirname(createRequire(path.join(webRoot, 'package.json')).resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.min.mjs'); } catch { /* not installed yet */ }
const dst = path.join(webRoot, 'public/pdf.worker.min.mjs');
if (src && fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log('pdf.js worker → apps/web/public/pdf.worker.min.mjs'); }
