# Go-live checklist

Everything the code can do is built and tested (`docs/BACKEND_V2_PLAN.md`, Phases 1–8). What is left needs a person: accounts, keys, legal review and a few decisions. Tick each item before switching DNS to the new server.

## A. Owner tasks (accounts and keys)

| # | Task | Where |
|---|---|---|
| A1 | DigitalOcean account; Droplet (BLR1, Ubuntu 24.04, 4 vCPU / 8 GB), cloud firewall, Spaces bucket + key | `docs/DEPLOYMENT_VM.md` §1–3 |
| A2 | Cloudflare: domain, proxied DNS, Full (strict), origin certificate | `DEPLOYMENT_VM.md` §4 |
| A3 | Email, one of: **Resend** (verify `pnllens.com` with SPF/DKIM in Cloudflare, API key, sender `no-reply@pnllens.com`) or **Google Workspace SMTP** (`MAIL_DRIVER=smtp`, a mailbox with 2-Step Verification and an App password; `MAIL_FROM` = that mailbox or a "Send mail as" alias such as `no-reply@pnllens.com`; about 2,000 emails a day) | `.env` `RESEND_API_KEY` or `SMTP_USER`/`SMTP_PASS`, `MAIL_FROM` |
| A4 | Google Cloud: OAuth consent screen (app name, logo, privacy/terms URLs) + Web client; redirect URI `https://pnllens.com/api/auth/google/callback` | `.env` `GOOGLE_*` |
| A5 | Company registration and a Razorpay live account (KYC). Until then `PAYMENTS_MODE=off`; plans only through the owner grant | `docs/PAYMENTS_RAZORPAY.md` |
| A6 | GitHub: Actions secrets `DEPLOY_*`, environment `production`, deploy key on the server, GHCR read token | `DEPLOYMENT_VM.md` §6–7 |
| A7 | `.env` complete and **saved in a password manager** (it holds `FILE_KEK_K1` and `RESTIC_PASSWORD`, without which files and backups cannot be read) | `DEPLOYMENT_VM.md` §6 |
| A8 | First owner account promoted | `DEPLOYMENT_VM.md` §9 |
| A9 | `ALERT_EMAIL` set; trigger one test alert by stopping the api for 6 minutes (`dc stop api`), then start it and confirm the "recovered" mail | `docs/RUNBOOK.md` |
| A10 | First backup run by hand, then a restore drill on a throwaway Droplet | `RUNBOOK.md`, `docs/RESTORE_DRILL.md` |
| A11 | Landing footer: replace `[Company legal name]` and `[Registered address]`, and add the policy page links once the lawyer-approved texts are published | `LEGAL` in `apps/web/components/landing/Landing.tsx` |

## B. Engineering items with a date

| # | Item | When |
|---|---|---|
| B1 | Bump `next` 15.5.26 → 15.5.27 and `source-map-js` → 1.2.2 (build-time advisories; the versions pass the two-week rule on **2026-10-14**). Run the full verification and the visual check, then remove both entries from `infra/security/audit-allowlist.json` | 2026-10-14 to 2026-10-28. On 2026-10-28 the allow-list expires and CI fails until it is done |
| B2 | Check the Cloudflare IP ranges in `infra/caddy/Caddyfile.prod` against https://www.cloudflare.com/ips/ | before launch, then every 6 months |
| B3 | Confirm DigitalOcean encrypts the Droplet disk at rest, or attach an encrypted Volume for `DOCKER_DATA_ROOT`. The privacy policy may say "encrypted disk" only if true | before launch |

## C. Legal (lawyer review before publishing)

The drafts are in `docs/legal/`. The factual basis written from the code is `docs/PRIVACY_NOTES.md` (its **LAWYER** items).

- [ ] Every **LAWYER CHECK** in `docs/legal/PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` resolved (DPDP Act 2023 + Rules; EU/UK GDPR for foreign users).
- [ ] Open **BUILD CHECK** items that need wording before they can be built (each is a small UI change once the text is approved):
  - Terms acceptance at sign-up and checkout (checkbox or sentence with links).
  - "I am 18 or older" confirmation at sign-up (DPDP: under 18 is a child).
  - EU/UK 14-day withdrawal: express consent + acknowledgement at checkout, or a refund rule.
  - "Monthly check-up reminders" and "share with coach" in plan descriptions: build them or remove the wording.
- [ ] BUILD CHECK items that become true with this deployment, to tick on the live server: hosting in Bengaluru, encrypted backups (location: the Spaces bucket), the cookie list re-checked on the live site, the processor list (Cloudflare, Resend, Razorpay, Google, DigitalOcean).
- [ ] Remove all markers and the "how to read this draft" boxes, then publish the policy and terms pages.

## D. Launch day

1. `git tag v1.0.0 && git push origin v1.0.0` → the deploy job is green.
2. `https://pnllens.com` loads through Cloudflare (padlock, HSTS). `curl -s https://pnllens.com/api/v1/ready` → `{"ok":true,...}`.
3. Sign up with a real email; upload a real statement; save the report; open it on a second device; delete it.
4. Export my data → the ZIP downloads. Delete a test account → signed out, data gone.
5. If payments are on: buy the cheapest plan with a real card, check that the webhook granted it (admin console), then refund it in Razorpay and check that the refund shows.
6. The next morning: `/var/log/pnl-lens-backup.log` shows `backup_ok`; the health log shows no alerts.
- [ ] Replace the drafts in `docs/legal` with the lawyer-approved Terms and Privacy Policy (they're shown at /terms and /privacy). Remove the LAWYER/BUILD CHECK markers so the "Draft — under legal review" note disappears.
