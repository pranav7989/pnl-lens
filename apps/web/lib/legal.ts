/**
 * @file  apps/web/lib/legal.ts
 * @area  Legal
 * @what  Reads a legal text from docs/legal (bundled into the image via outputFileTracingIncludes) and renders it to safe HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** docs/legal/<file> from the repo root (production image) or from apps/web (dev). */
export function legalHtml(file: 'TERMS_OF_SERVICE.md' | 'PRIVACY_POLICY.md'): { html: string; draft: boolean } {
  for (const base of [process.cwd(), path.join(process.cwd(), '..', '..')]) {
    const p = path.join(base, 'docs', 'legal', file);
    if (fs.existsSync(p)) {
      const src = fs.readFileSync(p, 'utf8');
      return { html: md.render(src), draft: /DRAFT|LAWYER CHECK|BUILD CHECK/.test(src) };
    }
  }
  return { html: '<p>This page is being prepared. Write to <a href="mailto:support@pnllens.com">support@pnllens.com</a> for a copy.</p>', draft: true };
}
