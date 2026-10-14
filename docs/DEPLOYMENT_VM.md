# Deploying PnL Lens on one VM (DigitalOcean + Cloudflare)

One Ubuntu 24.04 Droplet runs the whole stack with Docker Compose (`infra/compose.prod.yml`). Cloudflare sits in front (DNS, proxy, TLS to visitors). Backups go encrypted to a DigitalOcean Spaces bucket. Day-to-day operations: `docs/RUNBOOK.md`. Before launch: `docs/GO_LIVE_CHECKLIST.md`.

Deploy, backup, wipe, restore, rollback and alerts were rehearsed with the production compose file and the real scripts (`docs/RESTORE_DRILL.md`). Still to run on a real Ubuntu 24.04 machine: `provision.sh` (step 5) and the Cloudflare certificate.

## 1. Droplet

- **Image:** Ubuntu 24.04 LTS x64. **Region:** Bangalore (BLR1), to keep data in India.
- **Size:** 4 vCPU / 8 GB RAM is the target (`docs/LOAD_TEST.md`). 2 vCPU / 4 GB also works at launch: set `WORKER_CONCURRENCY=1` and `WORKER_MEM_LIMIT=1g` in `.env`.
- **Disk:** the built-in disk is enough to start. If you attach a **Volume** for data, mount it (for example `/mnt/data`) before step 5 and run provision with `DOCKER_DATA_ROOT=/mnt/data/docker`.
- **Authentication:** SSH key only (add your public key in the Droplet form). Turn on weekly Droplet backups as a second safety net.

## 2. Cloud firewall (Networking → Firewalls)

Docker publishes ports past `ufw`, so the provider firewall is the one that counts.

| Inbound | Source |
|---|---|
| TCP 22 | your own IP address(es) only |
| TCP 80, TCP 443, UDP 443 | Cloudflare ranges only: https://www.cloudflare.com/ips/ (IPv4 and IPv6) |

Outbound: allow all (email, Google sign-in, Razorpay, image pulls, backups).

## 3. Spaces bucket for backups

1. Create a Space in BLR1 (for example `pnl-lens-backups`). File listing: **restricted**.
2. Create a Spaces access key (Spaces Object Storage → Access Keys) limited to that bucket.
3. You will put these in `.env` in step 6: `RESTIC_REPOSITORY=s3:https://blr1.digitaloceanspaces.com/pnl-lens-backups/restic`, plus `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (the Spaces key), and `RESTIC_PASSWORD` (a long random password; generate it with `openssl rand -hex 32`).

## 4. Cloudflare

1. Add the domain `pnllens.com` to Cloudflare and switch the registrar's nameservers to Cloudflare's.
2. DNS: `A pnllens.com → <droplet IPv4>` and `A www → <droplet IPv4>`, both **Proxied** (orange cloud). Optional: `AAAA` records for IPv6.
3. SSL/TLS → Overview: **Full (strict)**. Edge Certificates: **Always Use HTTPS** on, minimum TLS 1.2.
4. SSL/TLS → Origin Server → **Create certificate** (RSA or ECDSA, hostnames `pnllens.com, *.pnllens.com`, 15 years). Keep the two text blocks for step 6.

## 5. Provision the server (as root, once)

From your computer, in the repo:

```bash
scp infra/scripts/provision.sh root@<droplet-ip>:/root/
ssh root@<droplet-ip> 'bash /root/provision.sh'          # options: DEPLOY_USER=deploy SWAP_GB=4 DOCKER_DATA_ROOT=/mnt/data/docker
```

What it does (safe to run again): updates packages, sets the timezone to Asia/Kolkata, installs Docker CE + the compose plugin (log rotation, live-restore), creates the `deploy` user (copying root's SSH key), turns off password and root SSH login, enables ufw (22/80/443), fail2ban, automatic security updates and a 4 GB swap file, creates `/srv/pnl-lens` and installs the cron jobs (backup 03:00, health check every 5 minutes).

From now on, log in as `ssh deploy@<droplet-ip>`.

## 6. Code, secrets and certificate (as deploy)

```bash
# read-only deploy key for the private repo: add ~/.ssh/id_ed25519.pub under GitHub → repo → Settings → Deploy keys
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
git clone git@github.com:<owner>/pnl-lens.git /srv/pnl-lens && cd /srv/pnl-lens

# .env: generated secrets (no Node on the server: run the generator in the same Node image the app uses)
cp .env.example .env && chmod 600 .env
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:22.23.2-bookworm-slim node infra/scripts/gen-env.mjs
nano .env      # fill the "production accounts" block (below); delete the TEST_* lines if you like (unused here)

# Cloudflare origin certificate (step 4.4)
mkdir -p infra/certs && nano infra/certs/origin.pem && nano infra/certs/origin.key
sudo chown root:root infra/certs/origin.key && sudo chmod 600 infra/certs/origin.key && chmod 644 infra/certs/origin.pem
```

Production values in `.env` (meanings: `docs/ENVIRONMENT.md`):

| Variable | Value |
|---|---|
| `APP_URL` / `DOMAIN` / `TLS_MODE` | `https://pnllens.com` / `pnllens.com` / `cloudflare` |
| `IMAGE_REGISTRY` | `ghcr.io/<owner-lowercase>/pnl-lens` (images built by GitHub Actions). Leave it out to build on the server instead |
| `MAIL_FROM` / `RESEND_API_KEY` | a verified Resend sender on pnllens.com / its API key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (Web), redirect URI `https://pnllens.com/api/auth/google/callback` |
| `PAYMENTS_MODE` + `RAZORPAY_*` | `off` until the company and Razorpay account are ready (`docs/PAYMENTS_RAZORPAY.md`) |
| `RESTIC_*` / `AWS_*` | step 3 |
| `ALERT_EMAIL` | who receives downtime and disk alerts |

**Keep a copy of the finished `.env` in a password manager now.** It holds the file-encryption key (`FILE_KEK_K1`). Without it, neither the stored statements nor the backups of them can be decrypted.

If the images come from GHCR, log the deploy user in once with a GitHub token that has only `read:packages`: `docker login ghcr.io -u <github-user>`.

## 7. GitHub Actions

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | droplet IP |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | a **new** private key whose public half is in `/home/deploy/.ssh/authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <droplet-ip>` |

Settings → Environments → `production`: add yourself as a required reviewer if every deploy should wait for a click.

`ci.yml` runs on every push. `deploy.yml` runs when you push a `v*` tag: it builds and pushes the four images, then runs `infra/scripts/deploy.sh <tag>` on the server over SSH.

## 8. First deploy

```bash
git tag v1.0.0 && git push origin v1.0.0       # from your computer, on a commit that passed CI
```

Or by hand on the server: `cd /srv/pnl-lens && infra/scripts/deploy.sh v1.0.0`. The script checks out the tag, pulls (or builds) the images, runs migrations and role setup, starts everything, and waits for `https://pnllens.com/api/v1/ready` through Caddy. If the site does not become ready, it rolls back to the previous version by itself.

## 9. After the first deploy

1. Open https://pnllens.com, sign up with the owner's email, then make that account the owner:
   ```bash
   cd /srv/pnl-lens && PGPASSWORD="$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2-)" \
     docker compose --env-file .env -f infra/compose.prod.yml exec -T -e PGPASSWORD postgres \
     psql -U lens_admin -d lens -c "update users set role = 'owner' where email = 'owner@example.com'"
   ```
2. Run the first backup by hand and check that it works: `infra/scripts/backup.sh` (then `tail /var/log/pnl-lens-backup.log` the next morning).
3. Razorpay (when payments go on): webhook URL `https://pnllens.com/api/v1/payments/webhook`, events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed` (`docs/PAYMENTS_RAZORPAY.md`).
4. Work through `docs/GO_LIVE_CHECKLIST.md`.
