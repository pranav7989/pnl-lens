/**
 * @file  scripts/gen-index.mjs
 * @area  Ops
 * @what  Regenerates the file table in docs/INDEX.md from the @file/@area/@what headers. Run: npm run docs:index
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['apps', 'packages', 'infra', 'scripts', 'tests'];
const EXT = /\.(ts|tsx|js|mjs|py|sql|css)$/;
const SKIP = ['node_modules', '.next', 'fixtures', 'golden', 'public'];
const CONFIG = /^(next\.config\.mjs|vitest\.config\.ts|eslint\.config\.mjs)$/; // tool configs, not source
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!SKIP.includes(f.name)) walk(p); } else if (EXT.test(f.name) && !f.name.endsWith('.d.ts') && !CONFIG.test(f.name)) files.push(p); } };
DIRS.forEach((d) => fs.existsSync(path.join(ROOT, d)) && walk(path.join(ROOT, d)));
const rows = files.map((p) => {
  const head = fs.readFileSync(p, 'utf8').slice(0, 600);
  const g = (k) => (head.match(new RegExp(`@${k}\\s+(.+)`)) || [])[1]?.replace(/\s*\*\/\s*$/, '').trim() || '';
  return { file: path.relative(ROOT, p).split(path.sep).join('/'), area: g('area') || 'Other', what: g('what') || '(no header)' };
});
const KNOWN = ['Pages', 'Landing', 'Brand', 'Auth', 'Reports', 'Engine', 'Report UI', 'Payments', 'Admin', 'API', 'Worker', 'Core', 'Styles', 'Database', 'Ops', 'Offline', 'Tests', 'Other'];
// any other area is listed at the end instead of being dropped
const ORDER = [...KNOWN.slice(0, -1), ...[...new Set(rows.map((x) => x.area))].filter((a) => !KNOWN.includes(a)).sort(), 'Other'];
let out = '';
for (const a of ORDER) {
  const r = rows.filter((x) => x.area === a).sort((x, y) => x.file.localeCompare(y.file));
  if (!r.length) continue;
  out += `\n### ${a}\n\n| File | What it does |\n|---|---|\n` + r.map((x) => `| \`${x.file}\` | ${x.what.replace(/\|/g, '\\|')} |`).join('\n') + '\n';
}
const idx = path.join(ROOT, 'docs/INDEX.md');
const doc = fs.readFileSync(idx, 'utf8');
const next = doc.replace(/<!-- FILES:START -->[\s\S]*<!-- FILES:END -->/, `<!-- FILES:START -->\n_Generated from file headers by \`npm run docs:index\` — ${rows.length} files._\n${out}\n<!-- FILES:END -->`);
fs.writeFileSync(idx, next);
console.log(`docs/INDEX.md: ${rows.length} files indexed`);
