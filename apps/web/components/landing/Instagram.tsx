/**
 * @file  apps/web/components/landing/Instagram.tsx
 * @area  Landing
 * @what  REQ-6 Instagram section: 3 posts/reels and a follow card in one row that slides sideways on scroll (landing.js). Self-hosted media only, no Meta resources.
 */
/**
 * Media per card (checked on the server, so the page never points at a missing file):
 *   videoSrc exists  → muted, looping <video> (landing.js plays it when ≥60% visible, never with reduced motion)
 *   posterSrc exists → the image
 *   neither          → a branded placeholder (title + play icon). Drop the files into apps/web/public/media/instagram/
 *                      (names in packages/shared/src/site.ts) and the card switches over with no code change.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SiteConfig } from '@pnl-lens/shared/site';
import { LogoMark } from '@/components/brand/Logo';
import { InstagramIcon } from './Social';

const PUBLIC = path.join(process.cwd(), 'public');
const exists = (src?: string) => !!src && fs.existsSync(path.join(PUBLIC, src.replace(/^\//, '')));
const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

export default function Instagram({ site }: { site: SiteConfig }) {
  const { cards, followUrl } = site.instagram;
  return (
    <section className="lp-section lp-ig" id="instagram" data-ig>
      <header className="lp-head">
        <h2 className="lp-h2">Your habits, one reel at a time</h2>
        <p className="lp-sub">Short lessons on the traps that quietly shape a P&amp;L. Watch here, then follow us for more.</p>
      </header>
      <div className="ig-rail" data-ig-rail tabIndex={0} role="region" aria-label="PnL Lens posts and reels on Instagram">
        {cards.map((c, i) => {
          const video = c.type === 'reel' && exists(c.videoSrc), poster = exists(c.posterSrc) ? c.posterSrc : undefined;
          return (
            <div className="ig-item" key={c.url}>
              <a className={`ig-card${video || poster ? '' : ' placeholder'}`} href={c.url} {...ext} aria-label={`${c.title} (opens Instagram)`} data-ig-card={i + 1}>
                <span className="ig-chip">{c.type === 'reel' ? 'Reel' : 'Post'}</span>
                {video
                  ? <video src={c.videoSrc} poster={poster} muted playsInline loop preload="none" data-ig-video={i + 1} aria-hidden="true" />
                  : poster
                    ? <img src={poster} alt="" width={720} height={1280} loading="lazy" decoding="async" />
                    : <span className="ig-ph" aria-hidden="true"><InstagramIcon />{c.type === 'reel' && <i className="ig-play" />}<b>{c.title}</b></span>}
              </a>
              <a className="ig-view" href={c.url} {...ext} data-ig-card={i + 1}>View on Instagram ↗</a>
            </div>
          );
        })}
        <div className="ig-item">
          <div className="ig-card ig-follow">
            <LogoMark size={56} tone="black" />
            <b className="ig-handle">{site.social.instagramHandle}</b>
            <p>Short reels on the habits behind your P&amp;L. Revenge trading, overtrading, loss aversion and more.</p>
            <a className="ig-follow-btn" href={followUrl} {...ext} data-ig-follow>Follow on Instagram</a>
          </div>
          <p className="ig-also">Also on X: <a href={site.social.x} {...ext} data-social="x" data-placement="instagram_section">{site.social.xHandle}</a></p>
        </div>
      </div>
      <div className="ig-progress" aria-hidden="true"><i data-ig-progress /></div>
      <p className="lp-foot-note">Educational content. Not investment advice.</p>
    </section>
  );
}
