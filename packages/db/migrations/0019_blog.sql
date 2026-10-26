-- @file  packages/db/migrations/0019_blog.sql
-- @area  Database
-- @what  REQ-7 blog: posts, slug redirects, a public view (the only thing the app role can read), and owner/admin-only SECURITY DEFINER functions that write the audit log.
--
-- The app role (lens_app) gets SELECT on two views only: blog_public (published, or scheduled and due; not deleted)
-- and blog_public_redirects. It has no grant on the tables. Every write and every admin read goes through the
-- functions below, which re-check in the database that the actor is an active owner or admin (owner Q7) and record
-- an audit_log row with the actor. Scheduling needs no job: a scheduled post becomes visible when published_at passes.

create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  excerpt          text not null default '' check (char_length(excerpt) <= 400),
  body_md          text not null default '' check (char_length(body_md) <= 200000),
  body_html        text not null default '',
  cover_key        text,
  cover_alt        text,
  tags             text[] not null default '{}',
  site             text not null default 'both' check (site in ('india', 'global', 'both')),
  status           text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  seo_title        text check (char_length(seo_title) <= 60),
  meta_description text check (char_length(meta_description) <= 160),
  canonical_url    text check (canonical_url is null or canonical_url ~ '^https://'),
  noindex          boolean not null default false,
  reading_minutes  int not null default 1 check (reading_minutes between 1 and 240),
  author_id        uuid references public.users(id) on delete set null,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint blog_cover_alt check (cover_key is null or char_length(btrim(coalesce(cover_alt, ''))) > 0),
  constraint blog_scheduled_has_time check (status <> 'scheduled' or published_at is not null)
);
-- slugs are unique among posts that are not deleted (a deleted post's slug can be reused)
create unique index if not exists blog_posts_slug on public.blog_posts (slug) where deleted_at is null;
create index if not exists blog_posts_public on public.blog_posts (published_at desc) where deleted_at is null and status in ('published', 'scheduled');

-- old slugs of published posts → 301 to the post's current slug (REQ-7 §7.4)
create table if not exists public.blog_redirects (
  old_slug   text primary key,
  post_id    uuid not null references public.blog_posts(id),
  created_at timestamptz not null default now()
);

create or replace view public.blog_public with (security_barrier) as
  select id, slug, title, excerpt, body_html, cover_key, cover_alt, tags, site, seo_title, meta_description,
         canonical_url, noindex, reading_minutes, published_at, updated_at
    from public.blog_posts
   where deleted_at is null
     and (status = 'published' or (status = 'scheduled' and published_at <= now()));

create or replace view public.blog_public_redirects with (security_barrier) as
  select r.old_slug, p.slug, p.site from public.blog_redirects r join public.blog_public p on p.id = r.post_id;

revoke all on public.blog_posts, public.blog_redirects from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    revoke all on public.blog_posts, public.blog_redirects from lens_app;
    grant select on public.blog_public, public.blog_public_redirects to lens_app;
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function public.blog_require_editor(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = p_actor and role in ('owner', 'admin') and status = 'active') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- create / edit
-- p_id null = create. p carries: slug, title, excerpt, body_md, body_html, cover_key, cover_alt, tags, site,
-- seo_title, meta_description, canonical_url, noindex, reading_minutes (html is sanitised by the API before this call).
create or replace function public.blog_admin_save(p_actor uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old blog_posts%rowtype; v_tags text[];
begin
  perform blog_require_editor(p_actor);
  v_tags := coalesce((select array_agg(lower(btrim(t))) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t where btrim(t) <> ''), '{}');
  begin
    if p_id is null then
      insert into blog_posts (slug, title, excerpt, body_md, body_html, cover_key, cover_alt, tags, site, seo_title, meta_description,
                              canonical_url, noindex, reading_minutes, author_id)
      values (p->>'slug', p->>'title', coalesce(p->>'excerpt', ''), coalesce(p->>'body_md', ''), coalesce(p->>'body_html', ''),
              nullif(p->>'cover_key', ''), nullif(p->>'cover_alt', ''), v_tags, coalesce(p->>'site', 'both'), nullif(p->>'seo_title', ''),
              nullif(p->>'meta_description', ''), nullif(p->>'canonical_url', ''), coalesce((p->>'noindex')::boolean, false),
              coalesce((p->>'reading_minutes')::int, 1), p_actor)
      returning id into v_id;
      insert into audit_log (user_id, action, meta) values (p_actor, 'blog_created', jsonb_build_object('post', v_id, 'slug', p->>'slug'));
    else
      select * into v_old from blog_posts where id = p_id and deleted_at is null for update;
      if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
      update blog_posts set slug = p->>'slug', title = p->>'title', excerpt = coalesce(p->>'excerpt', ''), body_md = coalesce(p->>'body_md', ''),
             body_html = coalesce(p->>'body_html', ''), cover_key = nullif(p->>'cover_key', ''), cover_alt = nullif(p->>'cover_alt', ''),
             tags = v_tags, site = coalesce(p->>'site', 'both'), seo_title = nullif(p->>'seo_title', ''),
             meta_description = nullif(p->>'meta_description', ''), canonical_url = nullif(p->>'canonical_url', ''),
             noindex = coalesce((p->>'noindex')::boolean, false), reading_minutes = coalesce((p->>'reading_minutes')::int, 1), updated_at = now()
       where id = p_id;
      v_id := p_id;
      -- a published post keeps its old address: 301 from the old slug (and the new slug is no longer a redirect)
      if v_old.slug <> p->>'slug' and v_old.published_at is not null then
        insert into blog_redirects (old_slug, post_id) values (v_old.slug, p_id) on conflict (old_slug) do update set post_id = excluded.post_id;
      end if;
      delete from blog_redirects where old_slug = p->>'slug';
      insert into audit_log (user_id, action, meta) values (p_actor, 'blog_edited', jsonb_build_object('post', v_id, 'slug', p->>'slug', 'old_slug', nullif(v_old.slug, p->>'slug')));
    end if;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = 'P0001';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------- status: publish | schedule | unpublish | archive
create or replace function public.blog_admin_set_status(p_actor uuid, p_id uuid, p_action text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_old blog_posts%rowtype;
begin
  perform blog_require_editor(p_actor);
  select * into v_old from blog_posts where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_action = 'publish' then
    update blog_posts set status = 'published', published_at = case when status = 'scheduled' or published_at is null or published_at > now() then now() else published_at end, updated_at = now() where id = p_id;
  elsif p_action = 'schedule' then
    if p_at is null or p_at <= now() then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
    update blog_posts set status = 'scheduled', published_at = p_at, updated_at = now() where id = p_id;
  elsif p_action = 'unpublish' then
    update blog_posts set status = 'draft', updated_at = now() where id = p_id;
  elsif p_action = 'archive' then
    update blog_posts set status = 'archived', updated_at = now() where id = p_id;
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  insert into audit_log (user_id, action, meta)
  values (p_actor, case p_action when 'publish' then 'blog_published' when 'schedule' then 'blog_scheduled' when 'unpublish' then 'blog_unpublished' else 'blog_archived' end,
          jsonb_build_object('post', p_id, 'slug', v_old.slug, 'from', v_old.status, 'at', p_at));
end $$;

-- ---------------------------------------------------------------- soft delete (no hard delete from the UI)
create or replace function public.blog_admin_delete(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  perform blog_require_editor(p_actor);
  update blog_posts set deleted_at = now(), updated_at = now() where id = p_id and deleted_at is null returning slug into v_slug;
  if v_slug is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from blog_redirects where post_id = p_id;
  insert into audit_log (user_id, action, meta) values (p_actor, 'blog_deleted', jsonb_build_object('post', p_id, 'slug', v_slug));
end $$;

-- ---------------------------------------------------------------- admin reads (drafts included)
create or replace function public.blog_admin_list(p_actor uuid) returns setof public.blog_posts
language plpgsql stable security definer set search_path = public as $$
begin
  perform blog_require_editor(p_actor);
  return query select * from blog_posts where deleted_at is null order by updated_at desc;
end $$;

create or replace function public.blog_admin_get(p_actor uuid, p_id uuid) returns setof public.blog_posts
language plpgsql stable security definer set search_path = public as $$
begin
  perform blog_require_editor(p_actor);
  return query select * from blog_posts where id = p_id and deleted_at is null;
end $$;

do $$
declare f text;
begin
  foreach f in array array['blog_require_editor(uuid)', 'blog_admin_save(uuid, uuid, jsonb)', 'blog_admin_set_status(uuid, uuid, text, timestamptz)',
                           'blog_admin_delete(uuid, uuid)', 'blog_admin_list(uuid)', 'blog_admin_get(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'lens_app') then execute format('grant execute on function public.%s to lens_app', f); end if;
  end loop;
end $$;
