/**
 * @file  packages/db/test/db/blog.test.ts
 * @area  Tests
 * @what  REQ-7 blog in the database: app role reads the public view only, owner/admin-only functions, audit rows, visibility rules, slug redirects.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { blogSave, blogSetStatus, blogDelete, blogAdminList, blogAdminGet, listPublicPosts, getPublicPost, publicFeed, type BlogFields } from '../../src/queries/blog.js';
import { DbError } from '../../src/errors.js';
import { testDbAvailable, freshDb, makeUser, asRole, expectPgError, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { if (e instanceof DbError) return e.code; throw e; } };
const fields = (slug: string, o: Partial<BlogFields> = {}): BlogFields => ({
  slug, title: 'Why losses run longer', excerpt: 'A short note', body_md: 'Body', body_html: '<p>Body</p>', cover_key: null, cover_alt: null,
  tags: ['habits'], site: 'both', seo_title: null, meta_description: null, canonical_url: null, noindex: false, reading_minutes: 3, ...o,
});
const audit = async (t: TestDb, post: string) => (await t.admin.query(`select action, user_id from audit_log where meta->>'post' = $1 order by id`, [post])).rows;

describe.skipIf(!ok)('blog (0019)', () => {
  let t: TestDb; let owner: string, admin: string;
  beforeAll(async () => { t = await freshDb('t_blog'); owner = await makeUser(t, { role: 'owner' }); admin = await makeUser(t, { role: 'admin' }); });
  afterAll(async () => { await t?.close(); });

  it('the app role cannot touch the tables, only the public views', async () => {
    await expectPgError(asRole(t, 'lens_app', 'select * from blog_posts'), '42501');
    await expectPgError(asRole(t, 'lens_app', `insert into blog_posts (slug, title) values ('x', 'x')`), '42501');
    await expectPgError(asRole(t, 'lens_app', 'select * from blog_redirects'), '42501');
    expect(await asRole(t, 'lens_app', 'select count(*)::int as n from blog_public')).toEqual([{ n: 0 }]);
    await expectPgError(asRole(t, 'lens_app', `update blog_public set title = 'x'`), '42501');
  });

  it('only active owners and admins can write or read drafts (Q7); every action is audited', async () => {
    for (const role of ['user', 'support', 'finance', 'analyst']) {
      const u = await makeUser(t, { role });
      expect(await code(blogSave(t.app, u, null, fields(`p-${role}`))), role).toBe('forbidden');
      expect(await code(blogAdminList(t.app, u)), role).toBe('forbidden');
    }
    const id = await blogSave(t.app, owner, null, fields('first-post'));
    await blogSave(t.app, admin, id, fields('first-post', { title: 'Edited' }));
    await blogSetStatus(t.app, admin, id, 'publish');
    await blogSetStatus(t.app, owner, id, 'unpublish');
    await blogSetStatus(t.app, owner, id, 'schedule', new Date(Date.now() + 3600_000));
    await blogSetStatus(t.app, owner, id, 'archive');
    await blogDelete(t.app, owner, id);
    expect((await audit(t, id)).map((r) => r.action)).toEqual(['blog_created', 'blog_edited', 'blog_published', 'blog_unpublished', 'blog_scheduled', 'blog_archived', 'blog_deleted']);
    expect((await audit(t, id)).map((r) => r.user_id)).toEqual([owner, admin, admin, owner, owner, owner, owner]);
    expect(await blogAdminGet(t.app, owner, id)).toBeNull();        // soft-deleted: gone from admin lists too
    const blocked = await makeUser(t, { role: 'admin' }); await t.admin.query(`update users set status = 'blocked' where id = $1`, [blocked]);
    expect(await code(blogSave(t.app, blocked, null, fields('blocked-admin')))).toBe('forbidden');
  });

  it('the public view shows published and due posts only, for the right site', async () => {
    const mk = async (slug: string, site: BlogFields['site']) => blogSave(t.app, owner, null, fields(slug, { site }));
    const draft = await mk('draft-post', 'both'); void draft;
    const pub = await mk('live-post', 'both'); await blogSetStatus(t.app, owner, pub, 'publish');
    const india = await mk('india-only', 'india'); await blogSetStatus(t.app, owner, india, 'publish');
    const later = await mk('later-post', 'both'); await blogSetStatus(t.app, owner, later, 'schedule', new Date(Date.now() + 86400_000));
    const due = await mk('due-post', 'global'); await blogSetStatus(t.app, owner, due, 'schedule', new Date(Date.now() + 60_000));
    await t.admin.query(`update blog_posts set published_at = now() - interval '1 minute' where id = $1`, [due]);   // its time has come
    const arch = await mk('archived-post', 'both'); await blogSetStatus(t.app, owner, arch, 'publish'); await blogSetStatus(t.app, owner, arch, 'archive');
    const slugs = async (site: 'india' | 'global') => (await listPublicPosts(t.app, { site })).posts.map((p) => p.slug).sort();
    expect(await slugs('india')).toEqual(['india-only', 'live-post']);
    expect(await slugs('global')).toEqual(['due-post', 'live-post']);
    expect((await publicFeed(t.app, 'global')).map((p) => p.slug).sort()).toEqual(['due-post', 'live-post']);
    expect(await getPublicPost(t.app, 'later-post', 'india')).toBeNull();
    expect(await getPublicPost(t.app, 'india-only', 'global')).toBeNull();
    expect((await getPublicPost(t.app, 'india-only', 'india'))?.post?.title).toBe('Why losses run longer');
    expect((await listPublicPosts(t.app, { site: 'india', tag: 'habits' })).total).toBe(2);
    expect((await listPublicPosts(t.app, { site: 'india', tag: 'costs' })).total).toBe(0);
  });

  it('slugs are unique; a published post keeps its old address as a redirect; drafts do not', async () => {
    const a = await blogSave(t.app, owner, null, fields('costs-guide'));
    expect(await code(blogSave(t.app, owner, null, fields('costs-guide')))).toBe('slug_taken');
    await blogSave(t.app, owner, a, fields('costs-guide-v2'));                                   // draft rename: no redirect
    expect(await getPublicPost(t.app, 'costs-guide', 'india')).toBeNull();
    await blogSetStatus(t.app, owner, a, 'publish');
    await blogSave(t.app, owner, a, fields('broker-costs-guide'));                               // published rename: 301
    expect(await getPublicPost(t.app, 'costs-guide-v2', 'india')).toEqual({ redirect: 'broker-costs-guide' });
    await blogSetStatus(t.app, owner, a, 'unpublish');
    expect(await getPublicPost(t.app, 'costs-guide-v2', 'india')).toBeNull();                    // unpublished: no redirect either
    expect(await code(blogSetStatus(t.app, owner, a, 'schedule', new Date(Date.now() - 1000)))).toBe('schedule_in_past');
    await expectPgError(asRole(t, 'lens_app', `select public.blog_admin_save($1::uuid, null, '{"slug":"Bad Slug","title":"x"}'::jsonb)`, [owner]), '23514');
  });
});
