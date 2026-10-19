# Privacy notes: what PnL Lens stores, where, for how long, who can read it

Written from the code on branch `backend-v2` (Phases 1–7). This is the factual basis for the Privacy Policy in `docs/legal/PRIVACY_POLICY.md`. Items marked **LAWYER** must be confirmed by a lawyer for India's DPDP Act 2023 (and Rules) and for the EU/UK GDPR before launch.

## 1. What is stored

| Data | Where | Contents | Kept for | Who can read it |
|---|---|---|---|---|
| **Uploaded statements** (raw files) | Object storage (Garage, bucket `statements`) on the server | The file, **encrypted by the API before storage**: AES-256-GCM with a fresh key per file. That key is wrapped by a key-encryption key held only in the server's `.env` (`FILE_KEK_*`) | **30 days after upload**, then the wrapped key is destroyed and the object deleted (nightly purge plus a 15-minute sweep). Sooner if the user deletes the report or the account. Files of an analysis never saved: 24 h | The worker only, in memory, to analyse or export. The API's storage key is **write-only**. Every read and decrypt is logged (`file_access_log`). Admins have no file access |
| File metadata | Postgres `statement_files` | Original file name, size, SHA-256, detected type, upload time, file-set fingerprint | Until account deletion (the name becomes `[deleted]`) | The user (through their reports); admins via SQL only |
| **Reports, trades, metrics, habits** | Postgres `reports`, `trades`, `fills`, `report_metrics`, `report_traits`, `analysis_file_reports` | The engine's output: positions, P&L, dates, symbols, behavioural traits | **Until the user deletes the report or the account** (D4). Never purged by time | The user. Admin support tools show counts and timelines, not report contents |
| Unsaved analyses (previews) | Postgres `analyses` | Same as a report, before saving | 24 h | The user |
| Account | Postgres `users` | Email, name (Google only), country (from the visitor's IP country header), role, sign-in times | Until account deletion, then anonymised (`deleted+<id>@deleted.invalid`, no name or country) | The user (`/me`); admins with `user:lookup` (every lookup is written to the audit log) |
| Password (since 19 Oct 2026) | Postgres `users.password_hash`, `password_set_at`, `password_failed`, `password_locked_until`, `sessions_valid_after` | A **scrypt hash** (salted, never the password itself), when it was set, the wrong-attempt counter and lock time | Until changed; **cleared on account deletion** (with every session ended) | Nobody: never returned by the API, the admin console or the data export |
| Sign-in codes | Postgres `otp_codes` | HMAC of the code, email, IP | 7 days | Nobody (hash only) |
| **Consents** | Postgres `consents` (append-only) | Purpose (processing / research), yes/no, policy version, SHA-256 of the exact text shown, **HMAC of the IP** (never the IP), browser user agent | Kept as proof of consent. On account deletion the IP hash and user agent are removed | The user (`/me/consents`, `/me/export`) |
| Plans and payments | Postgres `subscriptions`, `payments`, `credits` | Plan, dates, allowance; Razorpay order/payment ids, amount, status, webhook payload | **Kept after account deletion (billing law)** | Admins with the finance role |
| Data-export archives | Object storage (bucket `exports`) | ZIP of everything above for one user, encrypted like statements | **7 days**, then the archive and its key are deleted | The user (download, logged in `audit_log`). The worker can write but not read; the API can read but not write |
| Product events, error reports | Postgres `events`, `error_events` | Page/tab events, upload outcome, error messages and stacks, user id | **12 months** (nightly `purge_logs`) | Admins (Users, Product, Errors tabs) |
| Landing-page visits (since 15 Oct 2026, REQ-4) | Postgres `events` | `pricing_viewed`, `landing_scroll_depth` (depth 25/50/75/100 %), `social_click` (network, placement) and the Instagram section's `ig_*` events (card number), with the site (India/Global), from visitors **without a user id, IP or cookie**. The Instagram section loads **no Instagram or Meta resources** (self-hosted media only) | **12 months** (nightly `purge_logs`) | Admins (Product tab) |
| **Blog articles and images** (REQ-7) | Postgres `blog_posts`, `blog_redirects`; object storage bucket `media` | Articles written by the PnL Lens team and their images (re-encoded to WebP, so camera metadata is removed). **Public content, no user data**; the `media` bucket is separate from the encrypted statements and never holds user files. The author's user id is kept on each post | Until the team deletes them (soft delete in the editor) | Everyone (published posts); drafts only owner/admin. The app role can read only the published view; every write is an audited owner/admin database function. The API key reads and writes `media`; the worker key has no access |
| Blog visits (REQ-7) | Postgres `events` | `blog_view`, `blog_cta_click`, `blog_preview_click` (article slug, site) from visitors without a user id, IP or cookie; for signed-in users `signup_from_blog` and `upload_started` with `source: blog` | **12 months** (nightly `purge_logs`) | Admins (Product tab, Blog tab views) |
| Journey bar "Hide" choice (REQ-2) | The visitor's browser (`localStorage` key `pnllens.journey.collapsed`) | `1` or `0` only | Until the browser storage is cleared | Only that browser; never sent to us |
| Audit log, file-access log | Postgres `audit_log`, `file_access_log` | Who did what and when (sign-ins, report changes, admin reads, file reads/decrypts), IP for some entries | **24 months** (nightly `purge_logs`) | Admins (support timeline) |
| Research views | Postgres schema `research` (views, no copies) | Trades, metrics and habits of users whose **latest research consent is "yes"**, under an HMAC pseudonym; no email, name, file names or broker client ids | Live views: they follow the data and the consent | The worker (`lens_worker`, since 0021) to build the research datasets below; `lens_research` still cannot log in |
| Research consent requests (since 19 Oct 2026) | Postgres `research_invites`; email | The owner's "Request reports" email: who was asked, when, by whom, the SHA-256 of the link token (never the token), the answer and a hashed IP. The answer is recorded in `consents` like the upload checkbox | Until account deletion | Owner and admins (User management tab) |
| Restrictions and admin deletions | Postgres `users.restricted_*`, `audit_log` | Reason, time and who restricted or deleted an account | Restriction: until lifted; audit 24 months | Owner and admins |
| **Research datasets** (since 19 Oct 2026) | Object storage (bucket `exports`, prefix `research/`), recorded in Postgres `research_exports` | A ZIP built on the 1st and 16th of each month (or on the owner's request) from the research views: **only users whose research consent is on at build time**, trader = HMAC pseudonym, report = a pseudonym valid in that file only; no emails, names, file names, broker client ids or internal ids. Encrypted like the data exports. For future model training (no training is built) | **90 days**, then the object and its key are deleted; a user who withdraws consent is left out of every later dataset | **The owner only**, by download in the admin console (each download in `audit_log`). The worker can write but not read the bucket; the API can read but not write |
| Backups | Off-site S3-compatible storage (restic, encrypted) | Database dump plus both buckets (statement objects stay encrypted with their own keys; the KEKs are **not** in the backup) | 14 daily, 8 weekly, 12 monthly snapshots. **Deleted data can remain in backups for up to 12 months** | Operators with the restic password |
| Server logs | Docker JSON logs on the VM | Request lines (no cookies, auth headers or webhook signatures; file contents and names are not logged) | Rotated by size (`provision.sh`) | Operators |

## 2. Where

One Ubuntu 24.04 VM, planned at DigitalOcean Bengaluru (India), behind Cloudflare. Only Caddy (80/443) is reachable. Postgres, Redis, storage and the worker sit on an internal Docker network with no internet route. Email goes out through Resend, or through Google Workspace SMTP when `MAIL_DRIVER=smtp` (sign-in codes then pass through Google); card payments through Razorpay (PnL Lens never sees card data). **LAWYER:** list Cloudflare, Resend, Razorpay, Google (sign-in, and email if Workspace SMTP is used) and the backup provider as processors, with their locations (cross-border transfer for EU users).

## 3. Rights, as built

| Right | How |
|---|---|
| Access / portability | Dashboard → **Your data** → *Export my data*: ZIP with `pnl-lens-data.json` (everything in section 1 for that user) and the original statements still stored. Link valid for 7 days |
| Erasure | Delete a report (report page → Delete): payload, trades and metrics removed, files shredded. Delete the account (Dashboard → Your data → *Delete my account*, type DELETE): all reports, trades, files and analyses removed; account anonymised; sessions end at once; payments and consent proof kept |
| Withdraw research consent | Dashboard → Your data → research checkbox (append-only record; the research views drop the user at once) |
| Withdraw processing consent | Delete reports or the account (processing is needed to provide the service) |

## 4. Security measures

TLS from Cloudflare to Caddy (origin certificate). Per-file envelope encryption; key shredding on deletion. Least-privilege database roles (the API cannot write report contents or credits; the worker cannot read accounts or payments). Write-only and read-only storage keys. CSRF origin check; rate limits; strict upload type checks. The engine runs in a memory-capped child process with no network access. Security headers and a Content-Security-Policy. Containers run with read-only filesystems, no Linux capabilities and non-root users. Secret scanning and dependency audit in CI. Key rotation script (`packages/db/scripts/rewrap-keys.mjs`).

The CSP allows `'unsafe-inline'` scripts and styles, because Next.js App Router hydration needs it without nonces. This is a known trade-off; moving to nonces is a later hardening step.

## 5. For the lawyer (DPDP Act / GDPR)

1. **Lawful basis and consent text.** Processing consent is a required checkbox at upload ("I agree to PnL Lens processing these files to build my report."). Research is a separate, optional, unticked checkbox. Is consent the right basis for processing, or contract/legitimate use? Is the wording specific and informed enough (DPDP s. 6; GDPR Art. 6/7)?
2. **Files added with "+"** reuse the processing consent the user ticked when starting that report (no new checkbox). Confirm this is acceptable.
3. **Research data is pseudonymised, not anonymised.** The HMAC key is in the database and in backups. Confirm it is described correctly and that the opt-in is sufficient, including for the **research datasets** downloaded every 15 days for model training and consent given through the **one-click email link** (no sign-in; a personal 30-day link) (copies kept up to 90 days, so a withdrawal reaches older datasets only when they expire).
4. **Retention periods:** raw files 30 days; previews 24 h; export archives 7 days; sign-in codes 7 days; usage/error logs 12 months; audit/file-access logs 24 months; reports until deleted; backups up to 12 months; payments kept after deletion. Confirm each period and the legal reason for keeping payments and consent records.
5. **Account deletion keeps** payment rows and consent rows (without IP hash or user agent), and an anonymised user row. Confirm this satisfies erasure while meeting billing and proof obligations.
6. **Children:** no age check is built. The Terms and Policy drafts propose an 18+ confirmation at sign-up. Wording and mechanism are needed (DPDP verifiable parental consent).
7. **Terms acceptance** at sign-up/checkout is not built yet. Wording and mechanism are needed (checkbox or "By continuing…" line).
8. **Breach notification:** the DPDP Board and the affected users; GDPR 72 hours. The runbook has an incident section; confirm the duties and the contact.
9. **Grievance officer / DPO** name and contact for the policy and the site footer.
10. **Cross-border transfers** for non-Indian users (data stored in India; processors in other countries).
11. **Cookies:** only strictly necessary cookies (`lens_session`, the short-lived `lens_oauth`). Confirm no banner is needed.
