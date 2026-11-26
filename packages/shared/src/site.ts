/**
 * @file  packages/shared/src/site.ts
 * @area  Landing
 * @what  Per-site settings (India / Global): social profile links and the Instagram section cards. One place to point a site at its own accounts.
 */
import type { Region } from './pricing';

export interface InstagramCard {
  type: 'post' | 'reel';
  url: string;
  /** label for screen readers and the placeholder card (owner can replace with the post's real title) */
  title: string;
  /** self-hosted MP4 under apps/web/public (720×1280, muted); used only if the file exists */
  videoSrc?: string;
  /** poster / post image under apps/web/public; used only if the file exists */
  posterSrc?: string;
}
export interface SiteConfig {
  social: { instagram: string; x: string; instagramHandle: string; xHandle: string };
  instagram: { cards: InstagramCard[]; followUrl: string };
}

// Owner Q8 (17 Oct 2026): the Global site uses the same accounts for now; give it its own entry here to change that.
const PNLLENS: SiteConfig = {
  social: { instagram: 'https://www.instagram.com/pnllens/', x: 'https://x.com/pnllens', instagramHandle: '@pnllens', xHandle: '@pnllens' },
  instagram: {
    followUrl: 'https://www.instagram.com/pnllens/',
    cards: [
      { type: 'post', url: 'https://www.instagram.com/p/DeTKGapE_lI/', title: 'PnL Lens post on Instagram', posterSrc: '/media/instagram/post-1.jpg' },
      { type: 'reel', url: 'https://www.instagram.com/reel/DegsPt0y0IL/', title: 'PnL Lens reel on Instagram', videoSrc: '/media/instagram/reel-2.mp4', posterSrc: '/media/instagram/reel-2.jpg' },
      { type: 'reel', url: 'https://www.instagram.com/reel/Dej-LaXS87T/', title: 'PnL Lens reel on Instagram', videoSrc: '/media/instagram/reel-3.mp4', posterSrc: '/media/instagram/reel-3.jpg' },
    ],
  },
};
export const SITE: Record<Region, SiteConfig> = { IN: PNLLENS, GLOBAL: PNLLENS };
export const siteFor = (region: Region): SiteConfig => SITE[region];
