/**
 * @file  packages/db/src/queries/blog.ts
 * @area  Database
 * @what  REQ-7 blog: public reads (published posts per site, redirects, feed) and owner/admin writes through the blog_admin_* SQL functions.
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import type { BlogPostsTable, BlogSite } from '../types.js';
import type { Selectable } from 'kysely';
import { rethrow } from '../errors.js';

export type BlogPost = Selectable<BlogPostsTable>;
/** India visitors see posts for india + both; Global visitors global + both. */
const sitesFor = (site: 'india' | 'global'): BlogSite[] => [site, 'both'];

export async function listPublicPosts(db: Db, o: { site: 'india' | 'global'; tag?: string; page?: number; perPage?: number }) {
  const per = o.perPage ?? 12, page = Math.max(1, o.page ?? 1);
  let q = db.selectFrom('blog_public').where('site', 'in', sitesFor(o.site));
  if (o.tag) q = q.where(sql<boolean>`${o.tag} = any(tags)`);
  const [rows, total] = await Promise.all([
    q.select(['slug', 'title', 'excerpt', 'cover_key', 'cover_alt', 'tags', 'reading_minutes', 'published_at', 'updated_at'])
      .orderBy('published_at', 'desc').limit(per).offset((page - 1) * per).execute(),
    q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
  ]);
  return { posts: rows, total: total?.n ?? 0, page, pages: Math.max(1, Math.ceil((total?.n ?? 0) / per)) };
}

export async function publicTags(db: Db, site: 'india' | 'global') {
  const { rows } = await sql<{ tag: string; n: number }>`select t as tag, count(*)::int as n from blog_public, unnest(tags) t
    where site in (${site}, 'both') group by t order by n desc, t`.execute(db);
  return rows;
}

/** The post for this slug and site, or `{ redirect }` when the slug is an old address of a published post. */
export async function getPublicPost(db: Db, slug: string, site: 'india' | 'global') {
  const post = await db.selectFrom('blog_public').selectAll().where('slug', '=', slug).where('site', 'in', sitesFor(site)).executeTakeFirst();
  if (post) return { post };
  const r = await db.selectFrom('blog_public_redirects').select('slug').where('old_slug', '=', slug).where('site', 'in', sitesFor(site)).executeTakeFirst();
  return r ? { redirect: r.slug } : null;
}

/** Every published post for the site (sitemap, RSS). */
export async function publicFeed(db: Db, site: 'india' | 'global') {
  return db.selectFrom('blog_public').select(['slug', 'title', 'excerpt', 'site', 'noindex', 'published_at', 'updated_at'])
    .where('site', 'in', sitesFor(site)).orderBy('published_at', 'desc').execute();
}

export interface BlogFields {
  slug: string; title: string; excerpt: string; body_md: string; body_html: string; cover_key: string | null; cover_alt: string | null;
  tags: string[]; site: BlogSite; seo_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: boolean; reading_minutes: number;
}

/** Create (id null) or edit. Owner/admin only, checked in the DB; audited. Throws DbError forbidden | not_found | slug_taken. */
export async function blogSave(db: Db, actorId: string, id: string | null, f: BlogFields): Promise<string> {
  try {
    const { rows } = await sql<{ id: string }>`select public.blog_admin_save(${actorId}::uuid, ${id}::uuid, ${JSON.stringify(f)}::jsonb) as id`.execute(db);
    return rows[0].id;
  } catch (e) { rethrow(e); }
}

export type BlogAction = 'publish' | 'schedule' | 'unpublish' | 'archive';
/** Throws DbError forbidden | not_found | schedule_in_past | invalid_action. */
export async function blogSetStatus(db: Db, actorId: string, id: string, action: BlogAction, at?: Date | null): Promise<void> {
  try { await sql`select public.blog_admin_set_status(${actorId}::uuid, ${id}::uuid, ${action}::text, ${at ?? null}::timestamptz)`.execute(db); }
  catch (e) { rethrow(e); }
}

export async function blogDelete(db: Db, actorId: string, id: string): Promise<void> {
  try { await sql`select public.blog_admin_delete(${actorId}::uuid, ${id}::uuid)`.execute(db); } catch (e) { rethrow(e); }
}

export async function blogAdminList(db: Db, actorId: string): Promise<BlogPost[]> {
  try { return (await sql<BlogPost>`select * from public.blog_admin_list(${actorId}::uuid)`.execute(db)).rows; } catch (e) { rethrow(e); }
}

export async function blogAdminGet(db: Db, actorId: string, id: string): Promise<BlogPost | null> {
  try { return (await sql<BlogPost>`select * from public.blog_admin_get(${actorId}::uuid, ${id}::uuid)`.execute(db)).rows[0] ?? null; } catch (e) { rethrow(e); }
}
