# Deploying PnL Lens on DigitalOcean (pnllens.com)

**Shape:** Cloudflare DNS → DigitalOcean App Platform (Docker image, 2 instances) → DigitalOcean Managed PostgreSQL 16.
Region: **BLR (Bangalore)** for low latency in India; use SGP if BLR isn't offered for App Platform on your account.
Email: **Resend** (no email service on DigitalOcean). Payments: Razorpay. Spec file: `.do/app.yaml`.

## 1. Domain and DNS (Cloudflare, free plan)
1. Add `pnllens.com` to Cloudflare and switch the nameservers at your registrar to Cloudflare's.
2. SSL/TLS mode: **Full (strict)**. Proxy (orange cloud) **on** for `pnllens.com` and `www`.
3. Cloudflare adds the `CF-IPCountry` header to every request; the app uses it to pick the India or Global site and ₹ or $ pricing.

## 2. Database
1. Create → Databases → PostgreSQL 16, region BLR, name `pnllens-db`, with standby node for production.
2. Trusted sources: add the App Platform app once it exists (so only the app can connect).
3. Create database `lens` and user `lens_admin` (owner). Migrations create the least-privilege `lens_app` role; set its password:
   `ALTER ROLE lens_app WITH LOGIN PASSWORD '<strong password>';`
4. `APP_DATABASE_URL` = `postgresql://lens_app:<password>@<host>:25060/lens?sslmode=require` (stored as an app secret).

## 3. App Platform
1. Push the repo to GitHub. Edit `.do/app.yaml` (repo name), then `doctl apps create --spec .do/app.yaml`.
2. Fill the SECRET values in the control panel: `APP_DATABASE_URL`, `SESSION_SECRET`, `OTP_PEPPER` (32+ random chars each), `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `RAZORPAY_*`.
3. Jobs (already in the spec): **migrate** runs before every deploy; **purge** runs daily at 02:00 IST (App Platform scheduled job).
4. Domains: App Platform shows a CNAME target; create `pnllens.com` and `www` CNAME records in Cloudflare pointing to it (proxied).
5. Health check: `/api/health`. Deploys happen on every push to `main`.

## 4. Email (Resend)
Add domain `pnllens.com` in Resend and create the DNS records it lists (SPF, DKIM, return path) in Cloudflare. Sender: `no-reply@pnllens.com`. Add a DMARC record.

## 5. Google sign-in and payments
- Google OAuth client → Authorised redirect URI: `https://pnllens.com/api/auth/google/callback`.
- Payments stay `PAYMENTS_MODE=off` until Razorpay is activated. Then follow `docs/PAYMENTS_RAZORPAY.md` (link mode first, or the full integration). Webhook URL: `https://pnllens.com/api/payments/webhook`.

## 6. First owner account
Sign in once at `https://pnllens.com/login`, then in the database console run:
`UPDATE users SET role = 'owner' WHERE email = 'you@yourdomain.com';`
Open `https://pnllens.com/admin`. Add teammates from **Users → Team & roles**.

## 7. Monitoring
- App Platform → Insights: CPU/memory alerts; Alerts: deployment failed, domain failed.
- Admin console → **Errors** tab for application errors (server and browser), **Support** tab for user issues.
- Uptime check (DigitalOcean Monitoring or any uptime service) on `https://pnllens.com/api/health`.

## 8. Backups
Managed PostgreSQL keeps daily backups with point-in-time recovery. Test a restore into a new cluster once before launch.

> The AWS guide (`docs/DEPLOYMENT_AWS_ALTERNATIVE.md`) remains as an alternative; the app is the same Docker image either way.
