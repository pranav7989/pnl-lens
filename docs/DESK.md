<!--
@file  docs/DESK.md
@area  Docs
@what  Desk (spec v1.0, web P0): what it is, the rules it keeps (no advice, no live prices, news only), owner decisions of 25 Nov 2026, the calculator formulas and golden example, reference data and how to change rates, events and headlines (providers, timers, admin), Trade Check (profile and watch-outs), access, and what is built in each PR.
-->
# Desk

The pre-market screen at `/desk`. The full version shows watch-outs from the trader's own trades, today's scheduled events, overnight headlines, a typed trade plan with Trade Check, and a charges / breakeven / position-size calculator.
Spec: *PnL Lens Desk, functional and technical spec v1.0* (25 Nov 2026), web (desktop) P0 only.

## Rules (spec R1–R5)
- **No advice.** Nothing on the Desk says buy, sell, avoid or names a target. Notes describe the trader's own history.
- **News only.** Headlines carry the title, source, time, link and category, never a body or a view.
- **No live prices.** The trader types every price. The Market page (docs/MARKET_IQ.md) is separate and untouched.
- **Privacy (DPDP).** Desk rows belong to the user: they are in "Export my data" and removed when the account is closed.
- **Expiry by calendar.** Expiries come from the expiry calendar, never from weekday names.

Every Desk view ends with: *Headlines and scheduled events only. Prices are entered by you. Not investment advice.*

## Owner decisions (25 Nov 2026)
- **Calculator:** shows both:
  - **charges only** (as in the mock: 1.11 points, ₹3,177.64);
  - **with your slippage**, when the trader types or saves one (2.71 points, ₹3,073.64).
- **Navigation:** "Desk" is the first link. The other links are unchanged. Visitors get "Desk" next to "User manual".
- **Headlines:** built behind a `NewsProvider` interface with a fake until the provider is chosen (PR 2).
- **Trade Check:** built from the owner's architecture document (PR 3).
- **Access:**
  - the calculator is free, including for visitors;
  - events and headlines are for signed-in users;
  - the plan, rules, checklist, watch-outs and Trade Check need an active plan and at least one report.
  - The Desk never uses report credits.

## Calculator (`packages/shared/src/desk/charges.ts`)
The same pure function runs in the browser on every keystroke and on the server (`POST /desk/calc`). Rates are fractions and come from the database, never from code.

| Charge | Formula |
|---|---|
| Turnover | (buy + sell) × qty |
| Brokerage | per order: flat, or min(pct × order value, cap) |
| STT / CTT | stt_buy × buy value + stt_sell × sell value, rounded to the rupee when `stt_round_rupee` |
| Exchange txn | exch_txn × turnover |
| SEBI fee | sebi_per_crore ÷ 1e7 × turnover |
| IPFT | ipft_per_crore ÷ 1e7 × turnover (0 unless set) |
| Stamp duty | stamp_buy × buy value |
| GST | gst × (brokerage + exchange txn + SEBI + IPFT) |
| Points to breakeven | total ÷ qty (with slippage: (total + slippage × qty) ÷ qty) |
| Net P&L | (sell − buy) × qty − total (with slippage: − slippage × qty) |
| Position size | largest qty (whole lots for F&O) with \|entry − SL\| × qty + round-trip charges + slippage ≤ risk per trade; less than one lot shows "Your risk rule allows less than 1 lot at this stop-loss" |

**Golden example (spec B2.6), tested to the paisa** in shared, API and the browser:

- Inputs: NSE options, buy 120, sell 170, qty 65, ₹20 per order.
- Charges:

  | Turnover | Brokerage | STT | Exch | GST | SEBI | Stamp | Total |
  |---|---|---|---|---|---|---|---|
  | ₹18,850.00 | ₹40.00 | ₹17.00 | ₹6.70 | ₹8.41 | ₹0.02 | ₹0.23 | ₹72.36 |

- Results:
  - charges only: 1.11 points and ₹3,177.64;
  - with slippage 1.6: ₹104.00, which gives 2.71 points and ₹3,073.64;
  - position size at risk ₹3,000 and stop-loss 90: 65 (1 lot), loss at the stop-loss ≈ ₹2,012.

## Reference data (migration 0033)
| Table | What |
|---|---|
| `charge_rates` | One rate set per segment, exchange and `effective_from`. The set used is the newest on or before the trade date. Seeded with 1 Apr 2026 for every segment and exchange, plus the F&O STT from 1 Oct 2024. |
| `brokerage_plans` | Seeded with "Discount broker": ₹20 per order for options; 0.03% capped at ₹20 for intraday, futures, currency and commodity futures; ₹0 for delivery. One default per segment. |
| `market_calendar` | Weekdays from 1 Jan 2026 to 31 Mar 2027, by segment and exchange: equity 09:00 / 09:15 / 15:30, currency 09:00–17:00, MCX 09:00–23:30 (23:55 Nov–Mar). The 2026 NSE holidays are marked. |
| `expiry_calendar`, `instrument_master` | Filled daily from Market IQ (see Events and headlines). |
| `desk_settings` | Per trader: risk per trade, max daily loss, max trades a day, brokerage plan, default exchange, average slippage, adherence target. In the data export; cleared on account deletion. |

**When SEBI, an exchange or the government changes a charge:** an owner or admin adds a new rate set from the date it applies (`POST /admin/charge-rates`). Old sets are never edited, so past dates still compute as they did. Holidays for 2027 go in with `POST /admin/market-calendar` once NSE publishes them. Every change is written to `audit_log`.

## Events and headlines (PR 2, migration 0034)
The cards for signed-in traders:
- **Scheduled events:** today's events in time order, each with a HIGH / MED / EXPIRY tag, and a timeline of the session (09:15–15:30) with a "now" marker.
- **Overnight headlines:** up to 6 headlines since the last NSE close, newest first, with the badge "News only · no views". Links open in a new tab. When the feed has not succeeded for 15 minutes the card says "Headlines unavailable · last updated hh:mm".

The browser refreshes both cards every 60 s (`GET /desk/today`, cached 60 s in the API).

| Source | How |
|---|---|
| Headlines | `NewsProvider` (`packages/shared/src/providers/news.ts`). Only the title, source, link, time and category are kept (`cleanHeadline`); there is no body column. A headline is stored once per link, and once per title within 6 hours (`title_key`, any script). Headlines are deleted after 7 days. |
| Events from a provider | `EventsProvider` (`providers/events.ts`); the provider's importance maps to HIGH / MED / LOW (`impactFrom`). Events are upserted by source id. An event the provider stops sending is hidden; if it comes back, it is shown again. |
| Generated rows | Market open / close, or the holiday, from `market_calendar`; expiries from `expiry_calendar` (never weekday names, so the Sept 2025 Thursday → Tuesday change follows the data). |
| Expiries and lot sizes | Copied daily at 07:40 from Market IQ (`/internal/instruments/fno`). Upcoming expiries are replaced and past ones kept. A lot-size change opens a new `instrument_master` row (`valid_from` / `valid_to`). An empty answer changes nothing. |
| Manual events | Admin console → **Desk** (owner/admin): add an event, or hide / show one. An edited or hidden event becomes *manual*, and providers never overwrite it. Every change is written to `desk_event_history` and `audit_log`. |

**Providers:**
- `NEWS_PROVIDER` / `EVENTS_PROVIDER` = `off` (production default) or `fake` (development: items titled "Sample headline:" / "Sample event:" on example.com links).
- The real headline provider is added once the owner sends its name, docs and key. It needs one new class that implements `NewsProvider`.

**Timers** (API, `apps/api/src/lib/desk-sync.ts`, `DESK_SYNC=off` stops them):
- headlines every 5 minutes;
- events and generated rows every 30 minutes from 06:00 to 22:00 IST;
- the calendar check from 07:35;
- the expiry copy from 07:40.

**Calendar check:** it looks for:
- a missing NSE equity day in the next 2 weeks;
- a calendar that ends within 30 days;
- a segment without charge rates;
- no Nifty expiry in the next 10 days (when Market IQ is connected).

Any problem raises one error event a day in the admin **Errors** tab. Each job's last success, count and error are listed in the **Desk** tab, which also has **Run now** buttons.

## Trade Check: profile and watch-outs (PR 3, migration 0035)
Built from the owner's architecture doc ("Trade Check: personalised trade plans from each trader's own P&L", 24 Nov 2026), phase 1.

1. **Features** (`packages/shared/src/features/build.ts`): one pure function describes a stored trade, and in PR 4 a typed plan line, in the same words:
   - underlying, instrument, call/put, opening side;
   - weekly/monthly, days to expiry (0 / 1 / 2–4 / 5+), weekday;
   - time of day (before 11:00 / 11:00–13:00 / from 13:00);
   - size vs the usual quantity (≤1× / 1–2× / >2×);
   - place in the day, losses before it in the day;
   - premium band (<₹50 / ₹50–150 / >₹150).

   A feature the data can't give is left out (statements have no side, dates or times), and the card says "Upload a tradebook to unlock time-of-day checks."
2. **Profile** (`packages/shared/src/profile/build.ts`):
   - **Segments:** every single feature, every pair, and 6 named triples.
   - **Shown:** only with **8 trades on 4 different days**.
   - **Statistics:** Wilson 90% win-rate range, seeded bootstrap of the average, shrinkage (k = 10) towards the trader's own average, recency weights with a 90-day half-life **counted back from the trader's newest trade** (so an old statement still shows its habits, and newer better trades fade an old warning).
   - **Weak:** the win-rate top is under the overall rate − 10 points, or the shrunk average is below 0 and the segment is in the bottom 20% by total.
   - **Strong:** the win-rate bottom is over the overall rate + 5 points, and the shrunk average is above 0.
3. **Rebuild** (worker `profile.rebuild`, queue `profiles`):
   - **When:** the API asks for one whenever a report is saved, gets files, or is deleted. A nightly catch-up (02:30 IST and at start-up) covers anything missed.
   - **Input:** the trades of all live reports in the trader's main currency, read through `profile_source_trades()`. A trade in two reports counts once.
   - **Versioning:** a new version is written and switched in one transaction. Two versions are kept.
4. **Watch-outs** (`GET /desk/profile`; needs an active plan and a live report):
   - up to 3 lines, weak habits first and one strength when there is one;
   - the same habit is never shown twice (narrower/broader segments, or the very same trades);
   - every line states its sample and period, e.g. "Your history: option buys on expiry day · 12 expiries · 3 profitable · −₹18,420 (Apr–Sep 2026)";
   - "(older data)" when the newest trade is over 60 days old;
   - the card header: "Checked against your trades up to …".

**Deviations from the doc, written down in the code:**
- **Size** uses the trader's median quantity, because there is no lot-size history before Nov 2026.
- **Time buckets** break on whole hours, because stored trades have the hour only.
- **"After losses"** uses the day's earlier entries, because exit times aren't stored.
- **Statements without dates** use the contract expiry as the day.
- **Recency** counts back from the newest trade, not from today. Weighting from today would hide every habit of an older statement; the doc's "(older data)" rule shows such profiles are still meant to be shown.
- Built in the worker from Postgres. A Redis cache can follow if PR 4's checks need it.

**Wording:** all text comes from `packages/shared/src/plan/templates.ts`. A test scans every template and rendered line for advice phrasing. A lawyer should confirm the wording before launch.

## Build (web P0)
| PR | Contents | State |
|---|---|---|
| 1 | Reference data, calculator, settings, admin endpoints, `/desk` page with the session line and the calculator card, nav link, disclaimer | built |
| 2 | Events and headlines: providers with fakes, API timers, expiry and lot sizes from Market IQ, admin Desk tab, `GET /desk/today` | built |
| 3 | Trade Check phase 1: features, profile builder and rebuild job, watch-outs card | built |
| 4 | Trade Check phase 2: typed plan lines, parser, `check()` in browser + API, rules (incl. suggested from your trades), chips, decision log, checklist | next |

Tests:
- `packages/shared/test/desk-charges.test.ts`;
- `apps/api/test/desk.test.ts`;
- `packages/shared/test/desk-providers.test.ts`, `packages/shared/test/trade-check-profile.test.ts`;
- `apps/worker/test/profile.test.ts`, `apps/api/test/desk-profile.test.ts`;
- `apps/api/test/desk-feeds.test.ts`;
- `packages/db/test/db/desk.test.ts`;
- `services/market-iq/tests/test_instruments.py` (the expiry reference);
- `tests/e2e-web/desk.spec.ts`.
