/**
 * @file  tests/e2e-web/blog.spec.ts
 * @area  Tests
 * @what  REQ-7 blog end to end: owner drafts, previews, publishes, unpublishes, schedules; /blog, article, landing preview, sitemap; raw-HTML SEO; sanitising; support sees no Blog tab; events.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, sql, cspViolations } from './helpers';

test.describe.configure({ mode: 'serial' });

const OWNER = `blog-owner-${Date.now()}@e2e.local`, SUPPORT = `blog-support-${Date.now()}@e2e.local`;
/** Rows from earlier runs are ignored: every count below is limited to this run. */
const T0 = new Date().toISOString();
const TITLE = 'Why revenge trading costs more than it looks';
const SLUG = 'why-revenge-trading-costs-more-than-it-looks';
const BODY = [
  '# The pattern', '', 'After a loss, the **next trade comes faster** and bigger. Here is how it shows up in a statement.', '',
  '<script>alert(1)</script>', '', '<iframe src="https://example.com"></iframe>', '',
  '[bad link](javascript:alert(1)) and [an outside source](https://example.com/study).',
].join('\n');

test.beforeAll(() => {
  sql(`delete from blog_redirects; delete from blog_posts;`);
});

async function asOwner(page: Page) {
  await signIn(page, OWNER);
  sql(`update users set role = 'owner' where email = '${OWNER}'`);
}

test('with no published posts the landing preview is hidden; Blog is in the nav', async ({ page }) => {
  await page.goto('/?region=in');
  await expect(page.locator('#blog')).toHaveCount(0);
  await expect(page.locator('.lp-links a[href="/blog"]')).toHaveText('Blog');
  await page.goto('/blog');
  await expect(page.getByRole('heading', { level: 1, name: 'Read your trades better' })).toBeVisible();
  await expect(page.getByText('Articles are on their way')).toBeVisible();
});

test('owner drafts, previews and publishes; the article is server-rendered with full SEO; unpublish removes it', async ({ page, context, request }) => {
  const csp = cspViolations(page);
  await asOwner(page);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Blog' }).click();
  await page.getByRole('button', { name: 'New article' }).click();
  await page.getByLabel('Title', { exact: true }).fill(TITLE);
  await page.getByLabel('Excerpt', { exact: true }).fill('A short look at the trade after the loss.');
  await page.getByLabel(/^Tags/).fill('Habits, costs');
  await page.getByLabel(/^Meta description/).fill('How revenge trading shows up in a broker statement, and a simple rule that stops it.');
  await page.getByLabel(/^Body \(Markdown\)/).fill(BODY);
  // live preview: the server renderer, with raw HTML shown as text
  const preview = page.locator('.ab-preview .bl-body');
  await expect(preview.locator('h2')).toHaveText('The pattern');
  await expect(preview).toContainText('<script>alert(1)</script>');
  await expect(preview.locator('script, iframe')).toHaveCount(0);
  await expect(page.locator('[data-blog-editor] .ab-slug input')).toHaveValue(SLUG);
  await expect(page.locator('.ab-serp .t')).toContainText(TITLE.slice(0, 40));

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(404);

  // private preview (draft) in a new tab, never indexed
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Preview' }).click()]);
  await tab.waitForLoadState();
  await expect(tab.getByText(/Preview · draft/)).toBeVisible();
  await expect(tab.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(tab.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await tab.close();

  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published.' })).toBeVisible();

  // raw HTML from the server (not the DOM): text, title, description, canonical, JSON-LD, no injected tags
  const raw = await (await request.get(`/blog/${SLUG}`)).text();
  expect(raw).toContain(`<title>${TITLE} · PnL Lens</title>`);
  expect(raw).toContain('After a loss, the <strong>next trade comes faster</strong> and bigger.');
  expect(raw).toContain('<meta name="description" content="How revenge trading shows up in a broker statement, and a simple rule that stops it."');
  expect(raw).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"]+/blog/${SLUG}"`));
  expect(raw).toContain('<link rel="alternate" hrefLang="en-IN"');
  expect(raw).not.toMatch(/<script>alert|<iframe|href="javascript:/);
  expect(raw).toContain('rel="noopener noreferrer nofollow"');
  const ld = [...raw.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1])).flat();
  const posting = ld.find((x) => x['@type'] === 'BlogPosting'), crumbs = ld.find((x) => x['@type'] === 'BreadcrumbList');
  expect(posting).toMatchObject({ headline: TITLE, author: { name: 'PnL Lens' } });
  expect(posting.datePublished).toBeTruthy(); expect(posting.dateModified).toBeTruthy();
  expect(crumbs.itemListElement).toHaveLength(3);

  // article page: one H1, CTA, note; events
  await page.goto(`/blog/${SLUG}`);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('.bl-cta')).toContainText('See these patterns in your own trades');
  await expect(page.locator('.bl-note')).toHaveText('Not investment advice.');
  await expect.poll(() => sql(`select count(*) from events where name = 'blog_view' and props->>'slug' = '${SLUG}' and created_at >= '${T0}'`)).not.toBe('0');
  await page.getByRole('link', { name: 'Analyse my trades' }).click();
  await page.waitForURL(/\/upload\?from=blog/);
  await expect.poll(() => sql(`select count(*) from events where name = 'blog_cta_click' and props->>'slug' = '${SLUG}' and created_at >= '${T0}'`)).toBe('1');

  // list, tag filter, landing preview (both sites: posted to Both), sitemap, RSS
  await page.goto('/blog');
  await expect(page.locator(`.bl-card[href="/blog/${SLUG}"]`)).toContainText('Read article →');
  await page.goto('/blog?tag=habits');
  await expect(page.locator('.bl-card')).toHaveCount(1);
  for (const region of ['in', 'global']) {
    await page.goto(`/?region=${region}`);
    await expect(page.locator('#blog .lp-h2')).toHaveText('Read your trades better');
    await expect(page.locator('#blog .bl-card')).toHaveCount(1);
    await expect(page.locator('#blog').getByRole('link', { name: 'All articles' })).toHaveAttribute('href', '/blog');
  }
  await page.locator('#blog .bl-card').click();
  await page.waitForURL(`**/blog/${SLUG}`);
  await expect.poll(() => sql(`select count(*) from events where name = 'blog_preview_click' and props->>'slug' = '${SLUG}' and created_at >= '${T0}'`)).toBe('1');
  expect(await (await request.get('/sitemap.xml')).text()).toContain(`/blog/${SLUG}</loc>`);
  expect(await (await request.get('/blog/rss.xml')).text()).toContain(`<title>${TITLE}</title>`);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/Sitemap: .*\/sitemap\.xml/);

  // unpublish: gone everywhere on the next request
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Blog' }).click();
  await page.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Unpublished.' })).toBeVisible();
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(404);
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain(SLUG);
  await page.goto('/?region=in');
  await expect(page.locator('#blog')).toHaveCount(0);

  const audit = sql(`select string_agg(action, ',' order by id) from audit_log where action like 'blog_%' and meta->>'slug' = '${SLUG}' and created_at >= '${T0}'`);
  expect(audit).toBe('blog_created,blog_edited,blog_edited,blog_published,blog_edited,blog_unpublished')   // save, preview (saves), publish (saves first), unpublish (saves first);
  expect(csp).toEqual([]);
});

test('schedule: hidden until the time passes; renaming a published post keeps a 301 from the old address', async ({ page, request }) => {
  await asOwner(page);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Blog' }).click();
  await page.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Schedule (IST)').fill('2099-01-01T09:30');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Scheduled for 1 Jan 2099/ })).toBeVisible();
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(404);
  sql(`update blog_posts set published_at = now() - interval '1 second' where slug = '${SLUG}'`);   // the time arrives
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(200);

  await page.locator('[data-blog-editor] .ab-slug input').fill('revenge-trading-costs');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  const old = await request.get(`/blog/${SLUG}`, { maxRedirects: 0 });
  expect(old.status()).toBe(308);                                    // Next's permanentRedirect (permanent, like 301)
  expect(old.headers().location).toMatch(/\/blog\/revenge-trading-costs$/);
});

test('support and other staff see no Blog tab and the API refuses them', async ({ page }) => {
  await signIn(page, SUPPORT);
  sql(`update users set role = 'support' where email = '${SUPPORT}'`);
  await page.goto('/admin');
  await expect(page.getByRole('tab').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Blog' })).toHaveCount(0);
  const r = await page.evaluate(async () => (await fetch('/api/v1/admin/blog/posts')).status);
  expect(r).toBe(403);
  const p = await page.evaluate(async () => (await fetch('/api/v1/admin/blog/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).status);
  expect(p).toBe(403);
  await page.goto('/admin/blog/preview/00000000-0000-0000-0000-000000000000');
  await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
});

test('phone: the article and the list read well at 390 px with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/blog/revenge-trading-costs');
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/blog');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
