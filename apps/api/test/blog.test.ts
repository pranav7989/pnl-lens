/**
 * @file  apps/api/test/blog.test.ts
 * @area  Tests
 * @what  REQ-7 blog API: roles (403 for support/finance/analyst/user), CRUD, publish visibility, Markdown sanitising, slug redirects, image upload checks (WebP + 1200×630), cache headers, sign-up/upload attribution.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { testDbAvailable, makeUser } from '@pnl-lens/db/testing';
import { testApp, as, multipart, ORIGIN, type TestApp } from './helpers.js';

const ok = await testDbAvailable();

describe.skipIf(!ok)('blog', () => {
  let x: TestApp, owner: string, admin: string;
  beforeAll(async () => {
    x = await testApp('t_api_blog');
    owner = await makeUser(x.t, { role: 'owner' }); admin = await makeUser(x.t, { role: 'admin' });
  });
  afterAll(async () => { await x?.close(); });

  const create = async (by: string, body: object) => x.app.inject({ method: 'POST', url: '/api/v1/admin/blog/posts', headers: await as(by), payload: body });
  const act = async (by: string, id: string, action: string, body?: object) =>
    x.app.inject({ method: 'POST', url: `/api/v1/admin/blog/posts/${id}/${action}`, headers: await as(by), payload: body ?? {} });
  const pub = (path: string) => x.app.inject({ method: 'GET', url: `/api/v1${path}` });

  it('only owner and admin can use the admin blog routes', async () => {
    for (const role of ['support', 'finance', 'analyst', 'user'] as const) {
      const u = await makeUser(x.t, role === 'user' ? {} : { role });
      expect((await create(u, { title: 'Nope' })).statusCode).toBe(403);
      expect((await x.app.inject({ method: 'GET', url: '/api/v1/admin/blog/posts', headers: await as(u) })).statusCode).toBe(403);
      const m = multipart([{ name: 'file', filename: 'a.png', content: Buffer.from('x') }]);
      expect((await x.app.inject({ method: 'POST', url: '/api/v1/admin/blog/media', payload: m.payload, headers: { ...m.headers, ...(await as(u)) } })).statusCode).toBe(403);
    }
    expect((await create('', { title: 'x' })).statusCode).toBe(401);
    expect((await create(admin, { title: 'Admin can write' })).statusCode).toBe(201);
  });

  it('draft → publish → visible (cached 60 s) → unpublish → gone', async () => {
    const r = await create(owner, { title: 'Why revenge trades hurt', excerpt: 'Short read.', body_md: '# Heading\n\nSome **bold** text.', tags: ['Habits'] });
    expect(r.statusCode).toBe(201);
    const { id, slug, reading_minutes } = r.json();
    expect(slug).toBe('why-revenge-trades-hurt'); expect(reading_minutes).toBe(1);
    expect((await pub(`/blog/posts/${slug}`)).statusCode).toBe(404);

    expect((await act(owner, id, 'publish')).json()).toEqual({ ok: true });
    const one = await pub(`/blog/posts/${slug}?site=global`);
    expect(one.statusCode).toBe(200);
    expect(one.headers['cache-control']).toBe('public, max-age=60');
    expect(one.json().post.body_html).toContain('<h2>Heading</h2>');
    expect(one.json().post.tags).toEqual(['habits']);
    const list = (await pub('/blog/posts?site=india')).json();
    expect(list.posts.map((p: any) => p.slug)).toContain(slug);
    expect((await pub('/blog/posts?site=india&tag=habits')).json().posts).toHaveLength(1);
    expect((await pub('/blog/tags?site=india')).json().tags.map((t: any) => t.tag ?? t)).toContain('habits');
    expect((await pub('/blog/feed?site=india')).json().posts.some((p: any) => p.slug === slug)).toBe(true);

    const admins = (await x.app.inject({ method: 'GET', url: '/api/v1/admin/blog/posts', headers: await as(owner) })).json();
    expect(admins.posts.find((p: any) => p.id === id)).toMatchObject({ status: 'published', views: 0 });
    expect((await x.app.inject({ method: 'GET', url: '/api/v1/admin/blog/posts', headers: await as(owner) })).headers['cache-control']).toContain('no-store');

    expect((await act(owner, id, 'unpublish')).statusCode).toBe(200);
    expect((await pub(`/blog/posts/${slug}`)).statusCode).toBe(404);
    const audit = await x.t.admin.query(`select action from audit_log where meta->>'post' = $1 order by id`, [id]);
    expect(audit.rows.map((a) => a.action)).toEqual(['blog_created', 'blog_published', 'blog_unpublished']);
  });

  it('site targeting: an India-only post is not on the Global site', async () => {
    const { id, slug } = (await create(owner, { title: 'Only for India', site: 'india' })).json();
    await act(owner, id, 'publish');
    expect((await pub(`/blog/posts/${slug}?site=india`)).statusCode).toBe(200);
    expect((await pub(`/blog/posts/${slug}?site=global`)).statusCode).toBe(404);
  });

  it('sanitises pasted HTML and unsafe links; external links get nofollow', async () => {
    const md = [
      '<script>alert(1)</script>', '', '<iframe src="https://evil.example"></iframe>', '',
      '[bad](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=)', '',
      '[out](https://example.com/x) [in](/pricing) ![pic](https://example.com/a.png)',
    ].join('\n');
    const html = (await x.app.inject({ method: 'POST', url: '/api/v1/admin/blog/render', headers: await as(owner), payload: { markdown: md } })).json().html as string;
    expect(html).not.toMatch(/<script|<iframe|href="javascript:|href="data:/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://example.com/x" rel="noopener noreferrer nofollow" target="_blank">out</a>');
    expect(html).toContain('<a href="/pricing" rel="noopener">in</a>');
    expect(html).toContain('loading="lazy"');
  });

  it('slug conflicts are 409; renaming a published post leaves a redirect', async () => {
    const { id } = (await create(owner, { title: 'Position sizing basics' })).json();
    expect((await create(owner, { title: 'Position sizing basics' })).statusCode).toBe(409);
    expect((await create(owner, { title: 'x', slug: 'Bad Slug!' })).statusCode).toBe(400);
    await act(owner, id, 'publish');
    const edit = await x.app.inject({ method: 'PATCH', url: `/api/v1/admin/blog/posts/${id}`, headers: await as(owner), payload: { title: 'Position sizing', slug: 'position-sizing' } });
    expect(edit.statusCode).toBe(200);
    expect((await pub('/blog/posts/position-sizing-basics')).json()).toEqual({ redirect: 'position-sizing' });
    expect((await pub('/blog/posts/position-sizing')).json().post.title).toBe('Position sizing');
  });

  it('schedule needs a future time; cover needs alt text; delete is soft', async () => {
    const { id, slug } = (await create(owner, { title: 'Scheduled one' })).json();
    expect((await act(owner, id, 'schedule', { at: new Date(Date.now() - 60_000).toISOString() })).statusCode).toBe(400);
    expect((await act(owner, id, 'schedule')).statusCode).toBe(400);
    expect((await act(owner, id, 'schedule', { at: new Date(Date.now() + 3600_000).toISOString() })).statusCode).toBe(200);
    expect((await pub(`/blog/posts/${slug}`)).statusCode).toBe(404);
    await x.t.admin.query(`update blog_posts set published_at = now() - interval '1 second' where id = $1`, [id]);
    expect((await pub(`/blog/posts/${slug}`)).statusCode).toBe(200);

    expect((await create(owner, { title: 'Cover', cover_key: 'a'.repeat(32) + '.webp' })).json().error).toBe('alt_required');
    expect((await act(owner, id, 'delete')).statusCode).toBe(200);
    expect((await pub(`/blog/posts/${slug}`)).statusCode).toBe(404);
    expect((await act(owner, id, 'archive')).statusCode).toBe(404);
    expect((await x.t.admin.query('select deleted_at from blog_posts where id = $1', [id])).rows[0].deleted_at).not.toBeNull();
  });

  it('image upload: type and size checks, WebP output and a 1200×630 social card', async () => {
    const up = async (content: Buffer, filename = 'a.png') => {
      const m = multipart([{ name: 'file', filename, content, type: 'image/png' }]);
      return x.app.inject({ method: 'POST', url: '/api/v1/admin/blog/media', payload: m.payload, headers: { ...m.headers, ...(await as(owner)) } });
    };
    expect((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg')).statusCode).toBe(415);
    expect((await up(Buffer.alloc(2 * 1024 * 1024 + 10, 0xff))).statusCode).toBe(413);

    const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#f5c400' } }).png().toBuffer();
    const r = await up(png);
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.key).toMatch(/^[0-9a-f]{32}\.webp$/); expect(b.ogKey).toBe(b.key.replace('.webp', '-og.webp'));
    expect([b.width, b.height]).toEqual([1600, 1067]);
    const og = await sharp(x.storage.media.get(b.ogKey)!.body).metadata();
    expect([og.format, og.width, og.height]).toEqual(['webp', 1200, 630]);

    const got = await pub(`/blog/media/${b.key}`);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/webp');
    expect(got.headers['cache-control']).toContain('immutable');
    expect((await pub('/blog/media/..%2Fstatements%2Fx')).statusCode).toBe(404);
    expect((await pub(`/blog/media/${'b'.repeat(32)}.webp`)).statusCode).toBe(404);
  });

  it('attribution: a first sign-in from the blog is signup_from_blog; uploads from the blog carry source=blog', async () => {
    const post = (url: string, payload: object) => x.app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN } });
    const signIn = async (email: string, source?: string) => {
      await post('/api/v1/auth/otp/request', { email });
      const code = x.mail.at(-1)!.subject.slice(0, 6);
      expect((await post('/api/v1/auth/otp/verify', { email, code, ...(source ? { source } : {}) })).statusCode).toBe(200);
    };
    const count = async (email: string) => Number((await x.t.admin.query(
      `select count(*) from events e join users u on u.id = e.user_id where e.name = 'signup_from_blog' and u.email = $1`, [email])).rows[0].count);
    await signIn('reader@t.local', 'blog');
    expect(await count('reader@t.local')).toBe(1);
    await signIn('reader@t.local', 'blog');                                   // a returning user is not a new sign-up
    expect(await count('reader@t.local')).toBe(1);
    await signIn('direct@t.local');
    expect(await count('direct@t.local')).toBe(0);

    const u = await makeUser(x.t);
    const csv = fs.readFileSync(path.resolve(__dirname, '../../../packages/engine/test/fixtures/zerodha_tradebook.csv'));
    const m = multipart([{ name: 'consent', value: 'true' }, { name: 'source', value: 'blog' }, { name: 'files', filename: 'z.csv', content: csv }]);
    expect((await x.app.inject({ method: 'POST', url: '/api/v1/analyses', payload: m.payload, headers: { ...m.headers, ...(await as(u)) } })).statusCode).toBe(202);
    const ev = await x.t.admin.query(`select props from events where name = 'upload_started' and user_id = $1`, [u]);
    expect(ev.rows[0].props).toMatchObject({ source: 'blog' });
  });
});
