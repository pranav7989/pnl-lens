#!/usr/bin/env node
/**
 * @file  infra/scripts/audit.mjs
 * @area  Ops
 * @what  Production dependency audit for CI: fails on high/critical advisories unless allow-listed with a reason and an end date (infra/security/audit-allowlist.json).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allow = JSON.parse(fs.readFileSync(path.join(root, 'infra/security/audit-allowlist.json'), 'utf8')).entries;
let out;
try { out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
catch (e) { out = e.stdout; }                                   // npm audit exits non-zero when it finds anything
const vulns = JSON.parse(out).vulnerabilities || {};
const today = new Date().toISOString().slice(0, 10);
const problems = [], accepted = [];
for (const e of allow) if (e.until < today) problems.push(`allow-list entry for ${e.package} expired on ${e.until}: upgrade it or renew the entry with a reason`);
for (const [name, v] of Object.entries(vulns)) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  const ok = allow.find((e) => e.package === name && e.until >= today);
  (ok ? accepted : problems).push(`${name} (${v.severity})${ok ? ` — accepted until ${ok.until}: ${ok.reason}` : ''}`);
}
for (const a of accepted) console.log(`accepted: ${a}`);
if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
console.log(`audit ok: no unaccepted high/critical production advisories (${Object.keys(vulns).length} advisories in total)`);
