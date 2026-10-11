/**
 * @file  scripts/gen-index.mjs
 * @area  Ops
 * @what  Regenerates the file table in docs/INDEX.md from the @file/@area/@what headers. Run: npm run docs:index
 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIRS = ['app', 'components', 'lib', 'workers', 'db', 'scripts', 'offline', 'tests'];
const EXT = /\.(ts|tsx|js|mjs|py|sql|css)$/;
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!['node_modules', '.next', 'fixtures'].includes(f.name)) walk(p); } else if (EXT.test(f.name) && !f.name.endsWith('.d.ts')) files.push(p); } };
DIRS.forEach((d) => fs.existsSync(path.join(ROOT, d)) && walk(path.join(ROOT, d)));
const rows = files.map((p) => {
  const head = fs.readFileSync(p, 'utf8').slice(0, 600);
  const g = (k) => (head.match(new RegExp(`@${k}\\s+(.+)`)) || [])[1]?.replace(/\s*\*\/\s*$/, '').trim() || '';
  return { file: path.relative(ROOT, p), area: g('area') || 'Other', what: g('what') || '(no header)' };
});
const ORDER = ['Pages', 'Landing', 'Brand', 'Auth', 'Reports', 'Engine', 'Report UI', 'Payments', 'Admin', 'Core', 'Styles', 'Database', 'Ops', 'Offline', 'Tests', 'Other'];
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
