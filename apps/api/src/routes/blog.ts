/**
 * @file  apps/api/src/routes/blog.ts
 * @area  API
 * @what  REQ-7 blog API: public posts/feed/media (cacheable) and owner/admin-only writing, publishing, live preview and image upload (WebP via sharp).
 */
/**
 * Public:  GET /blog/posts?site=&tag=&page=   GET /blog/posts/:slug?site=   GET /blog/tags?site=   GET /blog/feed?site=   GET /blog/media/:key
 * Admin:   GET|POST /admin/blog/posts   GET|PATCH /admin/blog/posts/:id   POST /admin/blog/posts/:id/{publish,schedule,unpublish,archive,delete}
 *          POST /admin/blog/render   POST /admin/blog/media
 * Admin routes need the blog:publish permission (owner, admin); the database re-checks the role and writes the audit log.
 * Markdown is rendered and made safe here (lib/markdown.ts) before it is stored; the web pages only print body_html.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Perm, type Role } from '@pnl-lens/shared/admin/rbac';
import {
  listPublicPosts, publicTags, getPublicPost, publicFeed, blogSave, blogSetStatus, blogDelete, blogAdminList, blogAdminGet, isDbError,
  type BlogFields, type BlogAction,
} from '@pnl-lens/db';
import type { App, Deps } from '../app.js';
import { fail, ok, sessionUser, UUID } from '../lib/http.js';
import { renderMarkdown, readingMinutes, slugify } from '../lib/markdown.js';

const SITE = z.enum(['india', 'global']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MEDIA_KEY = /^[0-9a-f]{32}(-og)?\.webp$/;
const MAX_IMAGE = 2 * 1024 * 1024;

/** The editor's fields. Slug defaults to one made from the title; read time and HTML are computed here. */
const PostBody = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(120).optional(),
  excerpt: z.string().max(400).default(''),
  body_md: z.string().max(200_000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  site: z.enum(['india', 'global', 'both']).default('both'),
  cover_key: z.string().regex(MEDIA_KEY).nullable().optional(),
  cover_alt: z.string().trim().max(200).nullable().optional(),
  seo_title: z.string().trim().max(60).nullable().optional(),
  meta_description: z.string().trim().max(160).nullable().optional(),
  canonical_url: z.string().url().startsWith('https://').nullable().optional(),
  noindex: z.boolean().default(false),
});

/** Public, cacheable for a minute: a published or unpublished post shows up everywhere within 1 minute (REQ-7). */
const pub = <T>(reply: FastifyReply, data: T) => reply.code(200).header('Cache-Control', 'public, max-age=60').send(data);

export async function blogRoutes(app: App, deps: Deps) {
  async function requirePerm(req: FastifyRequest, reply: FastifyReply, perm: Perm): Promise<{ id: string; role: Role } | null> {
    const u = await sessionUser(req);
    if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; }
    const { rows } = await deps.pool.query('select role from public.users where id = $1', [u.id]);
    const role = (rows[0]?.role as Role) || 'user';
    if (!can(role, perm)) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { id: u.id, role };
  }
  const dbFail = (reply: FastifyReply, e: unknown) => {
    if (isDbError(e, 'forbidden')) return fail(reply, 403, 'forbidden');
    if (isDbError(e, 'not_found')) return fail(reply, 404, 'not_found');
    if (isDbError(e, 'slug_taken')) return fail(reply, 409, 'slug_taken', 'Another article already uses this address (slug). Choose a different one.');
    if (isDbError(e, 'schedule_in_past')) return fail(reply, 400, 'schedule_in_past', 'Choose a date and time in the future.');
    throw e;
  };
  const tags = { tags: ['blog'] }, admin = { tags: ['admin'], security: [{ session: [] }] };
  const writeLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

  /* ------------------------------------------------------------------ public */
  app.get('/blog/posts', { schema: { ...tags, summary: 'Published posts for a site, newest first (12 per page)',
    querystring: z.object({ site: SITE.default('india'), tag: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }) } },
  async (req, reply) => {
    const q = req.query as { site: 'india' | 'global'; tag?: string; page: number };
    return pub(reply, await listPublicPosts(deps.db, { site: q.site, tag: q.tag?.toLowerCase(), page: q.page }));
  });

  app.get('/blog/tags', { schema: { ...tags, summary: 'Tags used by published posts', querystring: z.object({ site: SITE.default('india') }) } }, async (req, reply) =>
    pub(reply, { tags: await publicTags(deps.db, (req.query as { site: 'india' | 'global' }).site) }));

  app.get('/blog/posts/:slug', { schema: { ...tags, summary: 'One published post, or {redirect} for an old slug', params: z.object({ slug: z.string().max(120) }), querystring: z.object({ site: SITE.default('india') }) } },
  async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    if (!SLUG.test(slug)) return fail(reply, 404, 'not_found');
    const r = await getPublicPost(deps.db, slug, (req.query as { site: 'india' | 'global' }).site);
    return r ? pub(reply, r) : fail(reply, 404, 'not_found');
  });

  app.get('/blog/feed', { schema: { ...tags, summary: 'All published posts for a site (sitemap, RSS)', querystring: z.object({ site: SITE.default('india') }) } }, async (req, reply) =>
    pub(reply, { posts: await publicFeed(deps.db, (req.query as { site: 'india' | 'global' }).site) }));

  app.get('/blog/media/:key', { config: { rateLimit: false }, schema: { ...tags, summary: 'Blog image (WebP)', params: z.object({ key: z.string() }) } }, async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (!MEDIA_KEY.test(key)) return fail(reply, 404, 'not_found');
    const m = await deps.storage.getMedia(key);
    if (!m) return fail(reply, 404, 'not_found');
    return reply.code(200).header('Cache-Control', 'public, max-age=31536000, immutable').header('Content-Type', m.contentType)
      .header('X-Content-Type-Options', 'nosniff').send(m.body);
  });

  /* ------------------------------------------------------------------ admin */
  app.get('/admin/blog/posts', { schema: { ...admin, summary: 'All posts (any status) with views' } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    try {
      const posts = await blogAdminList(deps.db, who.id);
      const { rows } = await deps.pool.query(`select props->>'slug' as slug, count(*)::int as n from public.events where name = 'blog_view' group by 1`);
      const views = new Map(rows.map((r) => [r.slug, r.n]));
      return ok(reply, { posts: posts.map((p) => ({ ...p, body_md: undefined, body_html: undefined, views: views.get(p.slug) ?? 0 })) });
    } catch (e) { return dbFail(reply, e); }
  });

  app.get('/admin/blog/posts/:id', { schema: { ...admin, summary: 'One post for the editor', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    try { const p = await blogAdminGet(deps.db, who.id, id); return p ? ok(reply, { post: p }) : fail(reply, 404, 'not_found'); }
    catch (e) { return dbFail(reply, e); }
  });

  const save = async (req: FastifyRequest, reply: FastifyReply, id: string | null) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    if ((req as any).validationError) return fail(reply, 400, 'invalid', (req as any).validationError.message);
    const b = req.body as z.infer<typeof PostBody>;
    const slug = (b.slug || slugify(b.title)).toLowerCase();
    if (!SLUG.test(slug)) return fail(reply, 400, 'invalid_slug', 'The address may use lowercase letters, numbers and hyphens only.');
    if (b.cover_key && !b.cover_alt?.trim()) return fail(reply, 400, 'alt_required', 'Describe the cover image (alt text) for people who cannot see it.');
    const f: BlogFields = {
      slug, title: b.title, excerpt: b.excerpt, body_md: b.body_md, body_html: renderMarkdown(b.body_md), cover_key: b.cover_key ?? null,
      cover_alt: b.cover_key ? b.cover_alt!.trim() : null, tags: b.tags.map((t) => t.toLowerCase()), site: b.site, seo_title: b.seo_title || null,
      meta_description: b.meta_description || null, canonical_url: b.canonical_url || null, noindex: b.noindex, reading_minutes: Math.min(240, readingMinutes(b.body_md)),
    };
    try { const newId = await blogSave(deps.db, who.id, id, f); return ok(reply, { id: newId, slug, reading_minutes: f.reading_minutes }, id ? 200 : 201); }
    catch (e) { return dbFail(reply, e); }
  };
  app.post('/admin/blog/posts', { attachValidation: true, config: writeLimit, schema: { ...admin, summary: 'Create a draft', body: PostBody } }, (req, reply) => save(req, reply, null));
  app.patch('/admin/blog/posts/:id', { attachValidation: true, config: writeLimit, schema: { ...admin, summary: 'Edit a post', params: z.object({ id: z.string() }), body: PostBody } }, (req, reply) => {
    const id = (req.params as { id: string }).id;
    return UUID.test(id) ? save(req, reply, id) : fail(reply, 404, 'not_found');
  });

  app.post('/admin/blog/posts/:id/:action', { attachValidation: true, config: writeLimit, schema: { ...admin, summary: 'Publish now, schedule (at, IST shown in the editor), unpublish, archive or delete (soft)',
    params: z.object({ id: z.string(), action: z.enum(['publish', 'schedule', 'unpublish', 'archive', 'delete']) }), body: z.object({ at: z.string().datetime({ offset: true }).optional() }).optional() } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    if ((req as any).validationError) return fail(reply, 400, 'invalid');
    const { id, action } = req.params as { id: string; action: BlogAction | 'delete' };
    if (!UUID.test(id)) return fail(reply, 404, 'not_found');
    const at = (req.body as { at?: string } | undefined)?.at;
    if (action === 'schedule' && !at) return fail(reply, 400, 'schedule_in_past', 'Choose a date and time in the future.');
    try {
      if (action === 'delete') await blogDelete(deps.db, who.id, id);
      else await blogSetStatus(deps.db, who.id, id, action, at ? new Date(at) : null);
      return ok(reply, { ok: true });
    } catch (e) { return dbFail(reply, e); }
  });

  app.post('/admin/blog/render', { attachValidation: true, config: { rateLimit: { max: 240, timeWindow: '1 minute' } }, schema: { ...admin, summary: 'Live preview of Markdown (the same renderer as publishing)', body: z.object({ markdown: z.string().max(200_000) }) } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    if ((req as any).validationError) return fail(reply, 400, 'invalid');
    const md = (req.body as { markdown: string }).markdown;
    return ok(reply, { html: renderMarkdown(md), reading_minutes: readingMinutes(md) });
  });

  app.post('/admin/blog/media', { config: writeLimit, schema: { ...admin, summary: 'Upload an image (JPG, PNG or WebP, ≤ 2 MB) → WebP + 1200×630 social card', consumes: ['multipart/form-data'] } },
  async (req, reply) => {
    const who = await requirePerm(req, reply, 'blog:publish'); if (!who) return;
    if (!req.isMultipart()) return fail(reply, 415, 'invalid_upload', 'Send the image as a form upload.');
    let buf: Buffer;
    try {
      const part = await req.file({ limits: { fileSize: MAX_IMAGE, files: 1 } });
      if (!part) return fail(reply, 400, 'no_file', 'Choose an image.');
      buf = await part.toBuffer();
    } catch (e: any) {
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'image_too_large', 'Images must be 2 MB or smaller.');
      throw e;
    }
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!isJpg && !isPng && !isWebp) return fail(reply, 415, 'invalid_image', 'Use a JPG, PNG or WebP image.');
    try {
      const id = crypto.randomBytes(16).toString('hex');
      const main = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const og = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize(1200, 630, { fit: 'cover', position: 'attention' }).webp({ quality: 80 }).toBuffer();
      await deps.storage.putMedia(`${id}.webp`, main.data, 'image/webp');
      await deps.storage.putMedia(`${id}-og.webp`, og, 'image/webp');
      await deps.pool.query(`insert into public.audit_log (user_id, action, meta) values ($1, 'blog_media_uploaded', $2)`, [who.id, JSON.stringify({ key: `${id}.webp`, bytes: buf.length })]);
      return ok(reply, { key: `${id}.webp`, ogKey: `${id}-og.webp`, width: main.info.width, height: main.info.height, url: `/api/v1/blog/media/${id}.webp` }, 201);
    } catch {
      return fail(reply, 415, 'invalid_image', 'This image could not be read. Try a different file.');
    }
  });
}
