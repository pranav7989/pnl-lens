/**
 * @file  apps/web/components/landing/Social.tsx
 * @area  Landing
 * @what  X and Instagram icon buttons (REQ-5) for the landing header and footer; links come from the per-site config.
 */
import type { SiteConfig } from '@pnl-lens/shared/site';

export function InstagramIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></svg>;
}
export function XIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
}

/** Icon pair. `placement` goes into the social_click event (header | footer). */
export default function Social({ site, placement, className = '' }: { site: SiteConfig; placement: 'header' | 'footer'; className?: string }) {
  return (
    <div className={`lp-social ${className}`.trim()}>
      <a href={site.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="PnL Lens on Instagram" data-social="instagram" data-placement={placement}><InstagramIcon /></a>
      <a href={site.social.x} target="_blank" rel="noopener noreferrer" aria-label="PnL Lens on X" data-social="x" data-placement={placement}><XIcon /></a>
    </div>
  );
}
