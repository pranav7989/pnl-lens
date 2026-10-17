#!/usr/bin/env node
/**
 * @file  apps/worker/scripts/build.mjs
 * @area  Ops
 * @what  Bundles the worker (dist/main.js) and the engine child process (dist/engine-child.js) with esbuild; engine_version fixed from the engine sources.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const deps = (p) => Object.keys(JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8')).dependencies || {});
// npm packages stay external (installed in the image; pdf.js loads its own worker file at runtime); @pnl-lens/* are bundled.
const external = [...new Set(['apps/worker', 'packages/engine', 'packages/db', 'packages/shared'].flatMap((p) => deps(`${p}/package.json`)))]
  .filter((d) => !d.startsWith('@pnl-lens/'));
external.push('pdfjs-dist/*', 'xlsx/*');

// Same hash as src/engine-version.ts computes from the sources in dev and tests.
const ENGINE_FILES = ['engine.js', 'behaviour.js', 'extract.js', 'index.ts', 'node.ts', '../package.json'];
const h = crypto.createHash('sha256');
for (const f of ENGINE_FILES) h.update(f).update('\0').update(fs.readFileSync(path.join(repo, 'packages/engine/src', f)));
const ENGINE_VERSION = `e1-${h.digest('hex').slice(0, 12)}`;

await build({
  entryPoints: { main: path.join(root, 'src/main.ts'), 'engine-child': path.join(root, 'src/engine-child.ts') },
  outdir: path.join(root, 'dist'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  external,
  define: { __ENGINE_VERSION__: JSON.stringify(ENGINE_VERSION) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
console.log(`engine_version ${ENGINE_VERSION}`);
