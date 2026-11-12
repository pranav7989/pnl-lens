<!--
@file  docs/SHARE_CARD.md
@area  Docs
@what  Share card ("My Trading Discipline"): the spec as built — the legal safety rule (no results, returns or securities; SEBI disclaimer), layout, tile catalogue, slot filling, text styles, founding trader numbers, QR, dialog, tests — and the owner decisions of 29 Oct and 3 Nov.
-->
# Share card: "My Trading Discipline"

The card a trader posts from **Share progress** in the report header. It replaces the PR #24 progress card.
Code: `packages/shared/src/insights/share.ts` (content, slots, layout, text styles, colours),
`packages/shared/src/insights/share-qr.ts` (QR), `apps/web/components/workspace/share-draw.ts` (canvas drawing),
`ShareCard.tsx` (dialog), migration `0032_founding_traders.sql`.

## Legal safety rule (owner, 3 Nov 2026)
The card shows **how a trader keeps to their process, never what they earned**, so it cannot read as a claim of returns or performance in a security (SEBI circular of October 2024 on unregistered persons, FAQs January 2025) or as investment advice.

**Never on the card:**
- profit or loss, returns, %, win rate, best or worst trade/day/month, green days;
- any security, contract or underlying name;
- money or currency;
- a person's name or client id.

**Only:**
- counts of plan rules kept, habits fixed, months, habits and trades reviewed;
- the name of a habit dimension (Progress);
- the level.

**The disclaimer** is drawn on every card and cannot be switched off:
- *"Not investment advice or a recommendation."*
- plus *"PnL Lens is not registered with SEBI."* (India, i.e. INR or market India) or *"PnL Lens is not a registered investment adviser."* (Global).

`share.test.ts` enforces this on every golden report: no result words, %, currency or security names.

**Conduct rules for PnL Lens itself** (not code):
- never repost user cards on PnL Lens accounts or use them in ads;
- no rewards for posting;
- the QR goes to the general home page;
- no broker affiliate or referral deals before the lawyer has seen the card.

## Rules
1. **Discipline only**, as above. A tile appears only when it is a real strength. Otherwise the next tile in the pool takes its slot.
2. **Drawn in the browser** on a canvas, after `document.fonts.ready`. Nothing is sent to a server to build it.
3. **The engine is unchanged.** Everything is computed from the stored report.
4. **One source of truth.** Labels, chip names, copy, the disclaimer, colours, layout and text styles live only in `share.ts`.

## Canvas
- **Card** 1080 × 1728. **Story** 1080 × 1920: the card centred on black, with the glow continuing.
- Margin 72, content width 936, gap 20. Black background with a soft yellow glow top-right.
- Logo and "PnL Lens" at the top left; the period ("Jan–Mar 2025") in grey, right-aligned.
- Title: "MY TRADING" in white, "DISCIPLINE" in yellow #FFD400.
- **Founding badge** (when the user has a number and has not hidden it):
  - a gold gradient #FFE27A → #E0A800 with a star and a soft glow;
  - text "FOUNDING TRADER / #0427 / 1000".
- **Rows:**

| Row | y | Height | Slots (width) |
|---|---|---|---|
| A | 620 | 340 | A1 hero (560) · A2 (356) |
| B | 980 | 250 | B1 (448) · B2 (468) |
| C | 1250 | 220 | C1 (380) · C2 (272) · C3 (244) |

  When fewer tiles qualify, a row shares its width between the tiles it has, and fewer rows are centred between the badge and the footer.
- **Slot styles** (the accent belongs to the slot, not the stat):

| Slot | Style |
|---|---|
| A1 | Yellow fill, black text, trophy |
| A2 | Green border |
| B1 | Blue border, blue value |
| B2 | Purple border, purple value |
| C1 | Orange fill, black text |
| C2 | Green border, green value |
| C3 | Yellow border, yellow value |

  Card fill #1A1A1A, radius 28, 3px border with a soft accent glow.
- **Each tile:** an UPPERCASE label, a big value and an optional sub-line. The value shrinks in 4px steps (88 → 40). It goes onto two lines when that allows a bigger size.
- **Footer:**
  - QR 164 × 164: 33 modules × 4px plus a white 4-module quiet zone;
  - "My own trades, reviewed with PnL Lens.";
  - 🌐 "pnllens.com" in yellow at 44px;
  - the two disclaimer lines in small grey.

## Text styles (Manrope, the site's `--f-sans`)

| Style | Use | Spec |
|---|---|---|
| Display | Title | 800, 104px |
| Value | Tile values, badge number | 800, 88 → 40px |
| Label | Tile labels, "FOUNDING TRADER" | 800, 28px, uppercase, 0.04em |
| Body | Sub-lines, footer line, wordmark; "pnllens.com" at 44px | 700, 32px |
| Small | Period, disclaimer | 600, 24px, #9A9A9A |

## Tile catalogue

| Key | Label | Value (as the hero, under "Biggest achievement") | Shown only if |
|---|---|---|---|
| planKept | 30-day plan | "4 of 5 rules kept" (+ "from my 30-day plan") | The earlier 30-day plan has ≥ 3 rules met |
| habitsFixed | Habits fixed | "2" ("2 habits fixed") | Progress tracker has ≥ 1 habit marked fixed |
| improving | Months improving | "3" ("3 months improving") | Progress score improved ≥ 2 months in a row |
| level | Level reached | "Disciplined" ("Reached Disciplined") | Level is Steady, Disciplined or Elite |
| topHabit | Strongest habit | "Cost efficiency" | The highest Progress dimension, scoring 70+ |
| months | Months reviewed | "3" | ≥ 1 month in Progress |
| habits | Habits tracked | "6" | Always (the Progress dimensions) |
| tradesReviewed | Trades reviewed | "96" | Always |

## Slot filling (same report → same card)
1. **Hero (A1):** the first eligible tile from
   - planKept
   - → habitsFixed
   - → improving
   - → level
   - → tradesReviewed.

   The user may pick another eligible hero. Only the hero carries the "Biggest achievement" label.
2. **Default tiles:** A2 topHabit, B1 level, B2 habitsFixed, C1 months, C2 habits, C3 tradesReviewed.
3. **Pool**, in order, when a default isn't eligible, is used or was switched off:
   - planKept → improving → level → habitsFixed → topHabit → months → habits → tradesReviewed.
4. **No duplicates.**
   - The card always shows min(7, eligible) tiles.
   - A tile can be switched off only while a spare can take its place; otherwise its chip is locked.

## Founding trader numbers (migration 0032)
- **Storage:** `users.founding_no` (1–1000, unique), from a one-row counter updated inside the granting transaction. A rolled-back grant leaves no gap.
- **Who gets one:**
  - given once, on the first **paid** plan (trigger on `subscriptions` with a `payment_id`);
  - or on a manual grant the owner ticks **Founding trader** (`admin_grant_plan(…, p_founding)`);
  - never to staff roles, or to accounts the owner marks **test** (`users.is_test`, admin console).
- **Write protection:** the app roles cannot write either column (guard trigger), and cannot call the assign or reset functions.
- **Never reassigned:** account deletion keeps the number on the anonymised row.
- **Reset before launch:**
  - `MIGRATE_DATABASE_URL=… npm run founding:reset -w @pnl-lens/db -- --yes`;
  - refused once any payment is paid.
- **API:** `GET /me` returns `foundingNo`.

## QR
- The URL is `https://pnllens.com/?utm_source=share_card&utm_medium=qr`, the same for both sites, because the landing page picks India or Global from the visitor's country.
- It carries no user data, so the modules were generated once and committed (`share-qr.ts`, error correction M). No QR library ships.
- A unit test decodes the committed modules, and the visual test decodes the QR on the drawn card.
- A visit records `landing_visit {region, source, medium}`. The admin's Landing page panel shows "Share cards made" and "Visits from share card QR codes".

## Dialog
- **Contents:**
  - a note on what is never shown (results, returns, money, names, securities) and that the disclaimer is always on;
  - **Biggest achievement** chips;
  - **Tiles** chips (switch one off and the pool refills it);
  - **Card / Story**;
  - **Founding badge** (only with a number);
  - a live preview, with an `aria-label` summarising the tiles and a plain-text list under it;
  - **Download image** (`pnl-lens-discipline.png` / `pnl-lens-discipline-story.png`) and **Share…** (where the phone supports sharing files).
- **Event:** `share_card_used { how, format, hero, tiles, badge }`.
- **Placement:** the button is in the report header on every view. Inside one file's tab, the card uses only that file's data, without the plan check.

## Changes from the original brief
**29 Oct (owner review):**
- founding numbers: manual grants count only when ticked;
- QR pre-made;
- small reports show fewer tiles instead of padding.

**3 Nov (owner: "no law issues or SEBI issues"):**
- every results tile removed: pro in (underlying), best day, best trade %, best month, green days, trades won, win streak, wins in a row;
- the title is "MY TRADING DISCIPLINE" instead of "MY TRADING EDGE";
- the SEBI / registered-adviser disclaimer is always on;
- discipline tiles added: habits fixed, months improving, strongest habit.

**Still open for the owner:**
- lawyer sign-off on the final card (questions in the PR);
- a phone scan of the QR;
- the target design image.

## Tests
- `packages/shared/test/share.test.ts`, on every golden report:
  - the legal safety rule: no result words, %, currency, security or underlying names;
  - the disclaimer, SEBI for India;
  - each tile rule checked on its own;
  - slot filling (hero order, defaults and pool, switching off, with and without a number);
  - no duplicates; determinism;
  - formats; layout sums; the committed QR decodes.
- `packages/db/test/db/founding.test.ts`:
  - numbers are given once and in order;
  - only on a paid plan or a ticked grant;
  - never to staff or test accounts;
  - nothing past 1000;
  - no gap after a rollback;
  - reset refused after a paid order;
  - app roles locked out.
- `tests/e2e-web/share.spec.ts`:
  - the dialog, hero and tile chips;
  - Card and Story downloads (sizes and names);
  - the badge from `/me` and its toggle;
  - the event props;
  - a QR visit counted.
- `tests/e2e-web/share-visual.spec.ts`:
  - the real drawing code on a blank page with the site's font;
  - 2 golden reports × Card/Story compared with stored snapshots (`-darwin` and `-linux`);
  - the QR on the drawn card decodes.
  - No stack needed.
