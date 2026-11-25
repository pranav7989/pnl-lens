<!-- @file apps/web/public/media/instagram/README.md · @area Landing · @what Where the Instagram section's self-hosted media goes (REQ-6). -->
# Instagram section media

Drop the owner's exports here with exactly these names (set in `packages/shared/src/site.ts`). The landing page picks
them up on the next build/deploy; until then each card shows a branded placeholder that links to Instagram.

| File | Card | Spec |
|---|---|---|
| `post-1.jpg` | 1 · static post | the post graphic, 720×1280 (9:16) JPG |
| `reel-2.mp4` + `reel-2.jpg` | 2 · reel DegsPt0y0IL | MP4 H.264, 720×1280, muted, ≤ 4 MB, plus a poster JPG |
| `reel-3.mp4` + `reel-3.jpg` | 3 · reel Dej-LaXS87T | same |

No Instagram embeds or Meta scripts are used on either site (GDPR); videos are served from our own domain (`media-src 'self'`).
