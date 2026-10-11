# Architecture

```
Browser ──────────────────────────────────────────────┐
  Landing (India / Global) · Upload · Report · Admin   │  Files are parsed HERE (Web Worker + pdf.js).
  lib/engine  ← runs in the browser                    │  Raw statements never leave the device.
                    │  report JSON (~50–200 KB)        │
                    ▼                                  │
Cloudflare (DNS, TLS, CF-IPCountry) ───────────────────┘
                    │
DigitalOcean App Platform — Next.js 14 (Docker, 2 instances, BLR)
  app/api/*  : auth · reports · payments · admin · events/errors · health
  jobs       : migrate (pre-deploy) · purge (daily 02:00 IST)
                    │
DigitalOcean Managed PostgreSQL 16
  users · credits · reports · payments · subscriptions · events · error_events · support_tickets · costs · audit_log
External: Resend (email) · Google (sign-in) · Razorpay (payments, when enabled)
```

| Decision | Why |
|---|---|
| Analysis runs in the browser | Privacy (raw files never uploaded) and no server compute or GPU needed |
| No AI model anywhere | All insights are rules + pre-written text; predictable, cheap, auditable |
| Credits spent in one SQL function | No double-spend; no report without payment |
| Plans granted only by the verified webhook | Browser callbacks can be faked or lost |
| App connects as `lens_app` (no DELETE, no DDL) | A compromised app can't drop or wipe tables |
| Role checked from the database on every admin request | Role changes apply instantly; UI hiding is not security |
| Report JSON is versioned (`version: 1`) | Engine upgrades stay compatible with stored reports |
| Offline single-file builds | Demos and a local tool from the same code (`offline/`) |
