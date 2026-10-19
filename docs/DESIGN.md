<!-- @file docs/DESIGN.md · @area Docs · @what The visual system: colour tokens, type scale, spacing, radius, motion and component rules for every screen. -->
# Design system

The website is dark, with yellow as the brand signature. The quality comes from proportion, typography, spacing and restraint, not from effects. All values live as tokens in `apps/web/app/globals.css` (`:root`). The landing page (`landing.css`, `.lp`) and the report, workspace and admin styles (`report.css`, `workspace.css`) use the same tokens. Set up 17 Oct 2026 (PR #3, an approved exception to rule 8: visual only, no wording or behaviour changes).

## Colour

| Role | Token | Value | Use |
|---|---|---|---|
| Page | `--bg` | `#000` | Page background |
| Surface 1 | `--s1` (`--panel`) | `#0C0C0D` | Cards and panels |
| Surface 2 | `--s2` (`--panel2`) | `#151517` | Inputs, nested cards, menus |
| Surface 3 | `--s3` | `#1D1D20` | Hover fills, selected segment, tooltips |
| Hairline | `--line` / `--line-strong` / `--line-hover` | `#232326` / `#38383C` / `#4A4A50` | Borders: resting, control, hover |
| Text | `--ink` / `--ink-2` / `--ink-3` (`--muted`) | `#F5F5F7` / `#C2C2C7` / `#8E8E93` | Primary, secondary, labels. All pass WCAG AA on every surface |
| Brand | `--y`, `--y-hover`, `--y-press` | `#FFD60A` … | Primary action, selected tab underline, current level, key emphasis only |
| Brand tint | `--y-tint`, `--y-line` | 8% / 42% yellow | Selected items, "Medium" pills, highlighted plan |
| Text on yellow | `--on-y` | `#0A0A0A` | 14:1 on yellow |
| Data | `--gain`, `--loss`, `--warn` | `#3DD68C`, `#FF6961`, `#FFB27A` | Profit, loss, flagged patterns |

Rules:
- Yellow is a signature, not a background. There are no yellow slabs and no glows. One yellow primary button per view.
- No gradients on surfaces. Charts may use a soft area fill.
- Shadows only on floating layers (`--shadow`): tooltip, dialog, loader, the lock message.

## Type (Manrope; system font as fallback)
- **Sizes:** 11 / 12 / 13 / 14 (body) / 15 / 17 / 20 / 24 / 32 / 40, plus `clamp()` display sizes for page and landing titles.
- **Weights:**
  - 400 for body, 500 for labels and nav, 600 for headings and buttons;
  - 650–700 only for large numbers and the H1;
  - never above 700 (Manrope's variable font stops at 800, and heavier weights looked crude).
- **Letter-spacing:** -.015 to -.035em on headings and large numbers, 0 on body, +.06–.08em on small uppercase labels.
- **Numbers** are `tabular-nums` everywhere.

## Shape and spacing
- **Radius:** 8 for controls (`--r-sm`), 10–12 for small cards and items (`--r`), 16 for panels (`--r-lg`). 999 only for real pills.
- **Spacing:** panels pad 20px, grids gap 16px, and section rhythm on the landing page uses one ramp. Phones keep the REQ-4 rule: pricing within 4 screen-heights.

## Motion (19 Oct 2026, owner: "Apple-like")
Replaces the PR #3 rule of colour-only hovers and 6px fades. The landing page tells a scroll story; inside the app, motion is quieter.

**Tokens** (`apps/web/app/motion.css`):
- `--ease-out-expo` `cubic-bezier(.16,1,.3,1)`: the default decelerate;
- `--ease-spring`: a CSS `linear()` spring with about 4% overshoot, falling back to expo;
- `--ease-in-out`;
- durations `--d-1` 160ms (press), `--d-2` 280ms (hover, tabs), `--d-3` 520ms (entrances), `--d-4` 900ms (scenes);
- stagger 60–70ms.

**Rules:**
- Animate only transform, opacity and clip-path, so there's no layout shift and REQ-4 pricing depth is unchanged. **Never animate `filter`**: animated blur crashes Linux WebKit (found in CI). A static blur is fine.
- No animation that holds its final transform on a wrapper of `position: fixed` elements (use `backwards`): in WebKit it re-anchors fixed children (the "See plans" pill).
- Content is fully visible within about 600ms.
- Nothing is hidden without JavaScript: reveal states apply only under `html.mo`, which the runtime sets after marking what's already on screen.
- `prefers-reduced-motion` makes everything static (checked in `motion.spec.ts`).

**Where it's used:**
- **Page navigation:** `app/template.tsx` fades in and rises 10px.
- **In-place swaps** use View Transitions on named regions only, so the header never moves:
  - report tabs (`rv-tab`);
  - the sign-in card, which morphs to the next step's height (`mo-card`);
  - admin tabs (`mo-swap`).
- **Reveal on scroll:** `[data-reveal]`, with `.in` added by `components/motion/MotionRuntime.tsx` (one observer, plus a scroll-time safety net). `[data-count-up]` counts plain-text numbers up and ends on the exact original text.
- **Tab bars:** a sliding yellow ink (`.mo-ink`) under every `.tabs`.
- **Touch:** buttons scale to .97 when pressed; primary buttons get a soft yellow glow on hover; cards lift 2–4px with the spring (pointer devices only).
- **Landing:**
  - the hero rises in line by line with a blur;
  - the ledger card settles in and tilts slightly with the pointer;
  - the step line draws across;
  - the sample dashboard tilts up and scales in on scroll (desktop, CSS scroll-driven animation);
  - card grids stagger;
  - the most popular plan has a slow light running round its border;
  - FAQ answers open smoothly;
  - the nav link of the section on screen is underlined;
  - the final call to action has a pointer spotlight;
  - the "See plans" pill springs in.
- **App:**
  - **Upload and preview:** the drop zone breathes and glows on drag; file rows slide in; the "Analysing…" card springs in; the free preview's tiles and insights stagger.
  - **Plans and history:** the plan bar fills on load; history rows stagger.
  - **Report:** chart lines draw on the expo curve and bars grow with the spring.
  - **Admin:** bars grow and rows fade in.
  - **Blog:** cards lift and their covers zoom; covers un-blur; a reading-progress line runs along the top of articles.
  - **Messages and loading:** status messages slide in, and errors shake once; loading states are shimmer skeletons ("Loading…" is kept for screen readers).

## Components
- **Buttons:**
  - `.btn` (yellow), `.btn.ghost` (hairline), `.btn-danger`;
  - states: hover lightens, active presses, disabled at 45%, focus is a 2px yellow ring.
- **Inputs:** `.field` (and the filters): `--s2` fill, a `--line-strong` border, and a yellow border plus a soft ring on focus.
- **Tabs:** grey text, white when selected, with a 2px yellow underline that slides.
- **Segmented controls** (report groups, sample dashboard): the selected segment is a raised `--s3` chip, not yellow.
- **Pills:** severity uses a tinted background with a coloured hairline (`.lv`, `.rv-lv`).
- **Instagram row** (`components/landing/Instagram.tsx`): 9:16 cards, radius 20, gap 20, width `clamp(232px, 68vw, 300px)`; a yellow Post/Reel chip; the follow card is the one solid-yellow surface on the page; a 220 px progress line. Snapping only after the visitor moves the row by hand.
- **Social icons** (`components/landing/Social.tsx`, links in `packages/shared/src/site.ts`): 38 px (40 px on phones) square buttons, grey hairline; yellow with a black icon on hover and focus.
- **Blog** (`app/blog.css`, `components/blog/*`, REQ-7): cards on `--s1` with a hairline, a 1200×630 cover on top, a tinted yellow tag chip, a yellow "Read article →"; three columns, two at ≤ 900 px, one at ≤ 620 px. Articles: 720 px column, 18 px body at 1.7 line height (17 px on phones), Markdown headings at H2/H3 (one H1 per page), and a tinted-yellow CTA card then "Not investment advice.". The landing preview reuses the same cards inside a standard `.lp-section`.
- **Sign-in card** (`app/(auth)/login`, `components/auth/LoginForm.tsx`, 19 Oct 2026): one 440 px card (radius 24, hairline). Order: "Continue with Google" (dark `--s2` provider button with the coloured G, shown only when Google is configured), a small "OR", the email box ("Enter your email", no visible label), and the yellow "Continue with email". 44 px controls (48 px on phones), radius 12. The code step keeps its layout. Steps in the same card: **Welcome back** (the email with "Change", a password box with a show/hide eye, Sign in, "Forgot password?"), **Check your email** (the code), **Set a password** / **Choose a new password** (password + repeat, the rule line, "Save and continue").
- **User management** (`components/admin/UserAdmin.tsx`): search box, pill filter chips (selected = yellow), a table with status chips (Included green, Asked yellow, Declined/Restricted grey) and small ghost action buttons; delete opens a modal that requires the typed email and a reason.
- **Research consent page** (`app/research/consent`, email link): the sign-in card with the exact consent sentence in a quote block (yellow left rule), three reassurance bullets, a yellow "Yes, include my reports" and a ghost "No thanks"; then a thank-you state.
- **Reports pill** (header, credits spec): yellow-hairline pill "5 reports left"; with none, a link "No reports left · See plans" (below 380 px just "See plans"). Customers never see the word "credit".
- **Free preview** (`Workspace.tsx`, no plan): three tiles (Net P&L, Total charges, Trades), "2 of N insights" with two titles, then a blurred placeholder dashboard (decorative shapes, no data) under a centred "Get the full report from ₹99 / $9" button.
- **Blog editor** (`components/admin/BlogAdmin.tsx`): two columns (form; content rules and live preview, sticky), one column at ≤ 960 px; status chips (published green, scheduled yellow); a white Google-style result preview in the SEO panel.
