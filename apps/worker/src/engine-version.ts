/**
 * @file  apps/worker/src/engine-version.ts
 * @area  Worker
 * @what  engine_version written on every derived row: a hash of the engine's source files and package.json (fixed at build time in the image).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __ENGINE_VERSION__: string | undefined;
/** Engine sources plus its package.json, so a parser library change (e.g. SheetJS) also gives a new version. */
export const ENGINE_FILES = ['engine.js', 'behaviour.js', 'extract.js', 'index.ts', 'node.ts', '../package.json'];

/** `e1-<12 hex>` from the engine sources; any engine change gives a new version, so old rows can be found and re-run. */
export function hashEngineSources(dir: string) {
  const h = crypto.createHash('sha256');
  for (const f of ENGINE_FILES) h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f)));
  return `e1-${h.digest('hex').slice(0, 12)}`;
}

export function engineVersion(): string {
  if (typeof __ENGINE_VERSION__ !== 'undefined') return __ENGINE_VERSION__;
  return hashEngineSources(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/engine/src'));
}
