/**
 * @file  apps/web/components/admin/BlogAdmin.tsx
 * @area  Admin
 * @what  REQ-7 admin "Blog" tab (owner/admin): post list with views, Markdown editor with live preview, cover upload, SEO panel, publish/schedule/unpublish/archive/delete.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type ApiError } from '@/lib/api-browser';
import Loading from '@/components/motion/Loading';

type Status = 'draft' | 'scheduled' | 'published' | 'archived';
type Site = 'india' | 'global' | 'both';
interface Row { id: string; slug: string; title: string; status: Status; site: Site; updated_at: string; published_at: string | null; views: number }
interface Draft {
  id: string | null; title: string; slug: string; slugTouched: boolean; excerpt: string; tags: string; site: Site; body_md: string;
  cover_key: string | null; cover_alt: string; seo_title: string; meta_description: string; canonical_url: string; noindex: boolean;
  status: Status; published_at: string | null;
}
const EMPTY: Draft = { id: null, title: '', slug: '', slugTouched: false, excerpt: '', tags: '', site: 'both', body_md: '', cover_key: null, cover_alt: '',
  seo_title: '', meta_description: '', canonical_url: '', noindex: false, status: 'draft', published_at: null };

const STATUS: Record<Status, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', archived: 'Archived' };
const SITES: Record<Site, string> = { both: 'Both', india: 'India', global: 'Global' };
const IST = { timeZone: 'Asia/Kolkata' } as const;
const when = (d: string) => new Date(d).toLocaleString('en-GB', { ...IST, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST';
/** Same rule as the API (lib/markdown.ts slugify). */
const slugify = (t: string) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
const msgOf = (e: unknown) => (e as ApiError)?.message || 'Something went wrong. Please try again.';

export default function BlogAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<{ posts: Row[] }>('/admin/blog/posts').then((j) => setRows(j.posts)).catch((e) => setErr(msgOf(e)));
  useEffect(() => { load(); }, []);

  const open = async (id: string) => {
    try {
      const { post: p } = await api<{ post: any }>(`/admin/blog/posts/${id}`);
      setEdit({ id: p.id, title: p.title, slug: p.slug, slugTouched: true, excerpt: p.excerpt, tags: (p.tags || []).join(', '), site: p.site, body_md: p.body_md,
        cover_key: p.cover_key, cover_alt: p.cover_alt || '', seo_title: p.seo_title || '', meta_description: p.meta_description || '',
        canonical_url: p.canonical_url || '', noindex: p.noindex, status: p.status, published_at: p.published_at });
    } catch (e) { setErr(msgOf(e)); }
  };

  if (edit) return <Editor initial={edit} onClose={() => { setEdit(null); load(); }} />;
  return (
    <div className="rv-panel s12" data-blog-admin>
      <div className="rv-ph"><h3>Blog</h3><small>owner and admin only · every change is in the audit log</small></div>
      <div className="ab-bar"><button className="btn" onClick={() => setEdit({ ...EMPTY })}>New article</button></div>
      {err && <p className="status err">{err}</p>}
      {!rows ? <Loading /> : (
        <div className="rv-tw"><table className="rv-t">
          <thead><tr><th>Title</th><th>Status</th><th>Site</th><th>Last edited</th><th className="n">Views</th><th /></tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.title}</b><br /><small className="mut">/blog/{r.slug}</small></td>
              <td><span className={`ab-st ${r.status}`}>{STATUS[r.status]}</span>{r.status === 'scheduled' && r.published_at && <><br /><small className="mut">{when(r.published_at)}</small></>}</td>
              <td>{SITES[r.site]}</td><td>{when(r.updated_at)}</td><td className="n">{r.views}</td>
              <td><button className="btn ghost" onClick={() => open(r.id)}>Edit</button></td>
            </tr>
          )) : <tr><td colSpan={6} className="mut">No articles yet. Start with “New article”.</td></tr>}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Editor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const [p, setP] = useState<Draft>(initial);
  const [html, setHtml] = useState(''), [mins, setMins] = useState(1);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [busy, setBusy] = useState(false);
  const [at, setAt] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setP((d) => ({ ...d, [k]: v }));

  // live preview: the same server renderer that publishing uses, 400 ms after typing stops
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api<{ html: string; reading_minutes: number }>('/admin/blog/render', { body: { markdown: p.body_md } })
        .then((j) => { setHtml(j.html); setMins(j.reading_minutes); }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [p.body_md]);

  const slug = p.slugTouched ? p.slug : slugify(p.title);
  const body = () => ({
    title: p.title, slug, excerpt: p.excerpt, body_md: p.body_md, site: p.site, noindex: p.noindex,
    tags: p.tags.split(',').map((t) => t.trim()).filter(Boolean),
    cover_key: p.cover_key, cover_alt: p.cover_key ? p.cover_alt : null,
    seo_title: p.seo_title || null, meta_description: p.meta_description || null, canonical_url: p.canonical_url || null,
  });
  /** Saves (create or edit) and returns the id, or null after showing the problem. */
  const save = async (): Promise<string | null> => {
    if (!p.title.trim()) { setMsg({ ok: false, text: 'Add a title.' }); return null; }
    if (p.cover_key && !p.cover_alt.trim()) { setMsg({ ok: false, text: 'Describe the cover image (alt text) for people who cannot see it.' }); return null; }
    try {
      const j = p.id ? await api<{ id: string; slug: string }>(`/admin/blog/posts/${p.id}`, { method: 'PATCH', body: body() })
        : await api<{ id: string; slug: string }>('/admin/blog/posts', { body: body() });
      setP((d) => ({ ...d, id: j.id, slug: j.slug, slugTouched: true }));
      return j.id;
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }); return null; }
  };
  const run = async (label: string, fn: (id: string) => Promise<unknown>, status?: Status) => {
    setBusy(true); setMsg(null);
    const id = await save();
    if (id) {
      try { await fn(id); if (status) set('status', status); setMsg({ ok: true, text: label }); }
      catch (e) { setMsg({ ok: false, text: msgOf(e) }); }
    }
    setBusy(false);
  };
  const action = (a: string, extra?: object) => (id: string) => api(`/admin/blog/posts/${id}/${a}`, { body: extra ?? {} });

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setMsg({ ok: false, text: 'Images must be 2 MB or smaller.' }); return; }
    const fd = new FormData(); fd.append('file', f, f.name);
    setBusy(true);
    const r = await fetch('/api/v1/admin/blog/media', { method: 'POST', body: fd, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { set('cover_key', j.key); setMsg({ ok: true, text: 'Cover uploaded. Describe it in the alt text box.' }); }
    else setMsg({ ok: false, text: j.message || 'Upload failed.' });
  };
  const schedule = () => {
    if (!at) { setMsg({ ok: false, text: 'Choose a date and time.' }); return; }
    run(`Scheduled for ${when(`${at}:00+05:30`)}.`, action('schedule', { at: `${at}:00+05:30` }), 'scheduled');
  };

  const seoTitle = p.seo_title || p.title, seoDesc = p.meta_description || p.excerpt;
  return (
    <div className="rv-panel s12 ab-editor" data-blog-editor>
      <div className="rv-ph"><h3>{p.id ? 'Edit article' : 'New article'}</h3><small><span className={`ab-st ${p.status}`}>{STATUS[p.status]}</span></small></div>
      <div className="ab-bar">
        <button className="btn ghost" onClick={onClose}>← All articles</button>
        <span className="ab-sp" />
        <button className="btn ghost" disabled={busy} onClick={() => run('Draft saved.', async () => {})}>Save draft</button>
        <button className="btn ghost" disabled={busy} onClick={() => run('Preview opened in a new tab.', async (id) => { window.open(`/admin/blog/preview/${id}`, '_blank', 'noopener'); })}>Preview</button>
        <button className="btn" disabled={busy} onClick={() => run('Published. It is live on the blog now.', action('publish'), 'published')}>Publish now</button>
      </div>
      {msg && <p className={`status ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</p>}

      <div className="ab-cols">
        <div className="ab-form">
          <label>Title<input value={p.title} maxLength={200} onChange={(e) => set('title', e.target.value)} /></label>
          <label>Address (slug)
            <span className="ab-slug"><span>/blog/</span><input value={slug} maxLength={120} onChange={(e) => setP((d) => ({ ...d, slug: e.target.value.toLowerCase(), slugTouched: true }))} /></span>
            {p.published_at && p.status !== 'draft' && <small className="mut">Changing the address of a published article keeps the old one working (permanent redirect).</small>}
          </label>
          <label>Excerpt<textarea rows={2} value={p.excerpt} maxLength={400} onChange={(e) => set('excerpt', e.target.value)} /></label>
          <div className="ab-row">
            <label>Tags <small className="mut">comma separated</small><input value={p.tags} onChange={(e) => set('tags', e.target.value)} placeholder="habits, costs" /></label>
            <label>Site<select value={p.site} onChange={(e) => set('site', e.target.value as Site)}>{(['both', 'india', 'global'] as Site[]).map((s) => <option key={s} value={s}>{SITES[s]}</option>)}</select></label>
          </div>
          <fieldset className="ab-cover"><legend>Cover image <small className="mut">JPG, PNG or WebP, up to 2 MB</small></legend>
            {p.cover_key && <img src={`/api/v1/blog/media/${p.cover_key.replace(/\.webp$/, '-og.webp')}`} alt="" width={1200} height={630} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0])} aria-label="Cover image" />
            {p.cover_key && <>
              <label>Alt text (required)<input value={p.cover_alt} maxLength={200} onChange={(e) => set('cover_alt', e.target.value)} /></label>
              <button className="btn ghost" onClick={() => setP((d) => ({ ...d, cover_key: null, cover_alt: '' }))}>Remove cover</button>
            </>}
          </fieldset>
          <label>Body (Markdown) <small className="mut">{mins} min read</small>
            <textarea className="ab-md" rows={18} value={p.body_md} onChange={(e) => set('body_md', e.target.value)} placeholder={'## A heading\n\nWrite in plain paragraphs. **Bold**, lists, [links](https://…) and images you uploaded.'} />
          </label>

          <fieldset className="ab-seo"><legend>SEO</legend>
            <label>SEO title <small className={(p.seo_title.length > 60) ? 'loss' : 'mut'}>{p.seo_title.length}/60</small><input value={p.seo_title} maxLength={60} placeholder={p.title} onChange={(e) => set('seo_title', e.target.value)} /></label>
            <label>Meta description <small className={(p.meta_description.length > 160) ? 'loss' : 'mut'}>{p.meta_description.length}/160</small><textarea rows={2} value={p.meta_description} maxLength={160} placeholder={p.excerpt} onChange={(e) => set('meta_description', e.target.value)} /></label>
            <div className="ab-serp" aria-label="Google-style preview">
              <span className="u">pnllens.com › blog › {slug || 'your-article'}</span>
              <span className="t">{(seoTitle || 'Article title').slice(0, 60)}{seoTitle.length > 60 ? '…' : ''} · PnL Lens</span>
              <span className="d">{(seoDesc || 'The meta description appears here.').slice(0, 160)}</span>
            </div>
            <label>Canonical URL <small className="mut">leave empty for this article’s own address</small><input value={p.canonical_url} placeholder={`https://pnllens.com/blog/${slug}`} onChange={(e) => set('canonical_url', e.target.value)} /></label>
            <label className="ab-check"><input type="checkbox" checked={p.noindex} onChange={(e) => set('noindex', e.target.checked)} /> Hide from search engines (noindex)</label>
          </fieldset>

          <fieldset className="ab-actions"><legend>Publishing</legend>
            <div className="ab-row">
              <label>Schedule (IST)<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
              <button className="btn ghost" disabled={busy} onClick={schedule}>Schedule</button>
            </div>
            <div className="ab-bar">
              <button className="btn ghost" disabled={busy || !p.id || p.status === 'draft'} onClick={() => run('Unpublished. It is a draft again.', action('unpublish'), 'draft')}>Unpublish</button>
              <button className="btn ghost" disabled={busy || !p.id || p.status === 'archived'} onClick={() => run('Archived.', action('archive'), 'archived')}>Archive</button>
              <button className="btn ghost btn-danger-quiet" disabled={busy || !p.id} onClick={async () => {
                if (!p.id || !confirm('Delete this article? It disappears from the site and this list (kept in the database).')) return;
                try { await action('delete')(p.id); onClose(); } catch (e) { setMsg({ ok: false, text: msgOf(e) }); }
              }}>Delete</button>
            </div>
          </fieldset>
        </div>

        <div className="ab-side">
          <div className="ab-rules" role="note">
            <b>Content rules</b>
            <ul>
              <li>No tips, calls, targets or promises of profit. No attacks on named brokers.</li>
              <li>Indian/UK spelling (analyse, behaviour). Brand name always “PnL Lens”.</li>
              <li>“Not investment advice.” is appended automatically to every article.</li>
            </ul>
          </div>
          <div className="ab-preview"><small className="mut">Live preview</small>
            <h1>{p.title || 'Article title'}</h1>
            <div className="bl-body" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </div>
  );
}
