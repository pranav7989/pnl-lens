/**
 * @file  apps/worker/test/global-setup.ts
 * @area  Tests
 * @what  Builds the worker bundles once before the tests (the engine child process runs from dist/, as in the image).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function setup() {
  execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/build.mjs')], { stdio: 'ignore' });
}
