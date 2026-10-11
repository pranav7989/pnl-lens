#!/usr/bin/env node
/**
 * @file  infra/scripts/gen-env.mjs
 * @area  Ops
 * @what  Fills .env with random secrets for every stack variable that is missing. Never changes or prints existing values.
 */
/**
 * Usage (repo root):  npm run stack:env   [-- --file path/to/.env]
 * Safe to re-run: only empty or missing keys are added. Changing an existing secret is a deliberate,
 * manual step (see docs/INFRA.md, "Rotating secrets"). The file is created with owner-only permissions.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fi = process.argv.indexOf('--file');
const file = fi > 0 ? path.resolve(process.argv[fi + 1]) : path.join(root, '.env');

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const SPEC = [
  ['POSTGRES_USER', () => 'lens_admin'],
  ['POSTGRES_PASSWORD', () => hex(32)],
  ['LENS_APP_PASSWORD', () => hex(32)],
  ['LENS_WORKER_PASSWORD', () => hex(32)],
  ['REDIS_PASSWORD', () => hex(32)],
  ['GARAGE_RPC_SECRET', () => hex(32)],
  ['GARAGE_ADMIN_TOKEN', () => hex(32)],
  ['S3_API_ACCESS_KEY_ID', () => 'GK' + hex(12)],
  ['S3_API_SECRET_ACCESS_KEY', () => hex(32)],
  ['S3_WORKER_ACCESS_KEY_ID', () => 'GK' + hex(12)],
  ['S3_WORKER_SECRET_ACCESS_KEY', () => hex(32)],
];

const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
const have = new Map();
for (const line of text.split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) have.set(m[1], m[2]); }

const added = [];
let out = text;
if (out && !out.endsWith('\n')) out += '\n';
if (!text) out += `# Local secrets for docker compose. Git-ignored — never commit. Template: .env.example\n`;
for (const [k, gen] of SPEC) {
  if (have.get(k)) continue;
  if (have.has(k)) out = out.replace(new RegExp(`^\\s*${k}\\s*=.*$`, 'm'), `${k}=${gen()}`);
  else out += `${k}=${gen()}\n`;
  added.push(k);
}
if (added.length) {
  fs.writeFileSync(file, out, { mode: 0o600 });
  console.log(`${path.relative(root, file) || file}: added ${added.length} value(s): ${added.join(', ')}`);
} else console.log(`${path.relative(root, file) || file}: all ${SPEC.length} values present, nothing changed`);
