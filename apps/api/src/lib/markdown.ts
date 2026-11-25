/**
 * @file  apps/api/src/lib/markdown.ts
 * @area  API
 * @what  REQ-7 blog: Markdown → safe HTML on the server (no raw HTML, no scripts/iframes, safe links), reading time and slugs.
 */
/**
 * Safety comes from markdown-it's own rules, not from cleaning HTML afterwards:
 *  - html: false   raw HTML in the Markdown (<script>, <iframe>, <img onerror>…) is printed as text, never as tags;
 *  - validateLink  only http(s), mailto, relative and in-page links; javascript:, data:, vbscript: … are refused;
 *  - links get rel="noopener"; links to other sites also get nofollow (and open in a new tab);
 *  - "# Heading" becomes <h2> (the page title is the only <h1>); images lazy-load.
 */
import MarkdownIt from 'markdown-it';

const SITE_HOSTS = new Set(['pnllens.com', 'www.pnllens.com']);
const SAFE_LINK = /^(https?:|mailto:|\/(?!\/)|#|\.{0,2}\/)/i;

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
md.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const render = md.renderer.rules;
const passthrough = (tokens: any, idx: number, opts: any, _env: any, self: any) => self.renderToken(tokens, idx, opts);

render.link_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx], href = t.attrGet('href') || '';
  let external = false;
  try { const u = new URL(href, 'https://pnllens.com'); external = /^https?:$/.test(u.protocol) && !SITE_HOSTS.has(u.hostname); } catch { /* relative */ }
  t.attrSet('rel', external ? 'noopener noreferrer nofollow' : 'noopener');
  if (external) t.attrSet('target', '_blank');
  return passthrough(tokens, idx, opts, env, self);
};
render.heading_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx]; if (t.tag === 'h1') t.tag = 'h2';
  return passthrough(tokens, idx, opts, env, self);
};
render.heading_close = (tokens, idx, opts, env, self) => {
  const t = tokens[idx]; if (t.tag === 'h1') t.tag = 'h2';
  return passthrough(tokens, idx, opts, env, self);
};
const image = render.image!;
render.image = (tokens, idx, opts, env, self) => {
  tokens[idx].attrSet('loading', 'lazy'); tokens[idx].attrSet('decoding', 'async');
  return image(tokens, idx, opts, env, self);
};

export function renderMarkdown(src: string): string {
  return md.render(src || '');
}

/** About 200 words a minute, at least 1. */
export function readingMinutes(src: string): number {
  const words = (src || '').replace(/[`*_#>[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** URL slug from a title: lowercase, hyphens, ASCII only. */
export function slugify(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
