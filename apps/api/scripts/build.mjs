#!/usr/bin/env node
/**
 * @file  apps/api/scripts/build.mjs
 * @area  Ops
 * @what  Bundles apps/api with esbuild into dist/main.js: workspace packages (db, shared, engine/extract) inlined, npm dependencies left external.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const deps = (p) => Object.keys(JSON.parse(fs.readFileSync(path.resolve(root, p), 'utf8')).dependencies || {});
// npm packages stay external (installed in the image); @pnl-lens/* workspace sources are bundled.
const external = [...new Set([...deps('package.json'), ...deps('../../packages/db/package.json'), ...deps('../../packages/shared/package.json')])]
  .filter((d) => !d.startsWith('@pnl-lens/'));

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(root, 'dist/main.js'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
