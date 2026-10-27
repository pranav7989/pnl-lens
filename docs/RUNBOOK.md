# Runbook (production VM)

Everything runs from `/srv/pnl-lens` as the `deploy` user. Set up: `docs/DEPLOYMENT_VM.md`. Short form used below:

```bash
cd /srv/pnl-lens
dc() { docker compose --env-file .env -f infra/compose.prod.yml "$@"; }
```

All scripts write one JSON line per step. Cron logs are in `/var/log/pnl-lens-backup.log` and `/var/log/pnl-lens-health.log`.

## Deploy and roll back

| Task | How |
|---|---|
| Deploy a version | Push a tag `vX.Y.Z` (GitHub Actions builds the images, then runs `deploy.sh`), or on the server `infra/scripts/deploy.sh vX.Y.Z` |
| What is running | `cat .deploy/current` (previous: `.deploy/previous`), `dc ps` |
| Roll back | `infra/scripts/deploy.sh "$(cat .deploy/previous)"`. A failed deploy already rolls back by itself |
| Run migrations only | `dc run --rm migrate` (also runs on every deploy before api/worker start) |

Each deploy also reloads Caddy with that version's `infra/caddy/Caddyfile.prod` (graceful). A Caddyfile that does not load fails the deploy, which rolls back.

**Rule for migrations:** add, don't drop. A rollback runs the previous code on the newer schema, so a column or table may be removed only one release after the code stops using it. Migrations 0001–0007 are never edited.

## Health

| Check | Command |
|---|---|
| Readiness (DB role, Redis, storage) | `curl -s https://pnllens.com/api/v1/ready` |
| Containers | `dc ps` (all `healthy`; `migrate` and `storage-init` exit 0) |
| Logs | `dc logs --tail=200 -f api` (also `worker`, `web`, `caddy`). JSON lines; cookies and auth headers are redacted |
| Queue depth / dead letters | `dc exec redis redis-cli llen bull:analyses:wait`, `dc exec redis redis-cli zcard bull:analyses:failed` |
| Failed analyses (last day) | admin console → errors, or `select error_code, count(*) from analyses where status='failed' and created_at > now()-interval '1 day' group by 1` |
| Disk | `df -h / /var/lib/docker`; `docker system df` |

`healthcheck.sh` runs every 5 minutes. It emails `ALERT_EMAIL` once when the site stops being ready or a disk passes 85%, and once more when everything has recovered.

## Common faults

| Symptom | Likely cause → fix |
|---|---|
| Deploy rolled back, `deploy_failed` in the output | Read the printed logs. Usual causes: a missing `.env` value (compose names it), a failed migration (`dc logs migrate`), an image pull denied (`docker login ghcr.io` again) |
| `ready` fails on `storage` | Garage is unhealthy or a key changed: `dc logs garage storage-init`. Changing an existing S3 secret is refused by design (see "Rotate secrets") |
| Uploads stay "queued" | The worker is down or stuck: `dc logs worker`, `dc restart worker`. Jobs survive restarts (Redis AOF) |
| Analyses fail with `file_too_complex` | The engine child hit `ENGINE_MEMORY_MB` / `ENGINE_TIMEOUT_MS`. Raise them (and `WORKER_MEM_LIMIT` to cover concurrency × engine memory + 300 MB) in `.env`, then redeploy the same version |
| Many 429s for real visitors | All traffic arriving from one IP means Caddy is not seeing Cloudflare's client IP: check that the Cloudflare ranges in `infra/caddy/Caddyfile.prod` are current |
| Sign-in emails don't arrive | `dc logs api | grep -i mail`; check the Resend dashboard and that `MAIL_FROM` is a verified domain |
| Disk filling | `docker system prune -f` (unused images), check the 30-day raw-file purge ran (`dc logs worker | grep purge`); add a Volume and move `DOCKER_DATA_ROOT` |

## Backups and restore

- **Nightly 03:00 IST** (`infra/scripts/backup.sh`, cron): `pg_dump -Fc` of the database plus every object in the `statements` bucket (already encrypted per file) → restic → Spaces, encrypted with `RESTIC_PASSWORD`. Keeps 14 daily, 8 weekly and 12 monthly snapshots. On Sundays it also verifies 5% of the stored data.
- The `exports` bucket (7-day download archives) and Redis (queue) are not backed up: exports can be requested again, and queued jobs must be uploaded again.
- **Restore** (stops the site while it runs):
  ```bash
  docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD ... restic/restic:0.19.1 snapshots   # or: see the backup log
  infra/scripts/restore.sh latest        # or a snapshot id
  ```
  `.env` must contain the **same `FILE_KEK_*` keys** as when the backup was made. Restore with the version that made the backup running (`.deploy/current`), or an older one; the script runs the migrations again afterwards. Rehearsed in `docs/RESTORE_DRILL.md`. Repeat the drill every 3 months on a throwaway VM.
- **Whole server lost:** new Droplet → `docs/DEPLOYMENT_VM.md` steps 5–8 with the saved `.env` → `infra/scripts/restore.sh latest` → point DNS at the new IP.

## Rotate secrets

Edit `.env`, then redeploy the current version: `infra/scripts/deploy.sh "$(cat .deploy/current)"`.

| Secret | Notes |
|---|---|
| `LENS_APP_PASSWORD`, `LENS_WORKER_PASSWORD` | Applied by the migrate job on every deploy |
| `POSTGRES_PASSWORD` | Change it in Postgres first: `dc exec postgres psql -U lens_admin -d lens -c "alter role lens_admin password '<new>'"`, then in `.env` |
| `REDIS_PASSWORD` | Just change it; Redis restarts with it |
| `SESSION_SECRET` | Signs everyone out (they sign in again with an email code) |
| `OTP_PEPPER` | Codes sent in the last 10 minutes stop working |
| `IP_HASH_SECRET` | New consent rows hash IPs with the new key; old rows keep the old hash |
| `S3_*` keys | Garage refuses a new secret for an existing key ID: use a new key ID **and** secret for the api or worker key; `storage-init` creates it on deploy |
| `RESEND_API_KEY`, `GOOGLE_*`, `RAZORPAY_*` | Create the new key with the provider, update `.env`, redeploy, then revoke the old key |
| `RESTIC_PASSWORD` | `restic key add` with the new password, then `restic key remove` the old one (restic image, as in `backup.sh`) |

### File-encryption key (`FILE_KEK_*`)

Never change or delete a key that data still uses. To rotate:

1. Generate a new key (`openssl rand -hex 32`) and add it as `FILE_KEK_K2=...`; set `FILE_KEK_ID=k2`; keep `FILE_KEK_K1`. Save the new `.env` in the password manager.
2. Redeploy the current version. New uploads use k2; old files still decrypt with k1.
3. Re-wrap the stored file keys (the objects themselves are not touched):
   ```bash
   set -a; . <(grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|FILE_KEK_[A-Z0-9]+)=' .env); set +a
   dc run --rm --no-deps -e MIGRATE_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/lens" \
     -e FILE_KEK_ID -e FILE_KEK_K1 -e FILE_KEK_K2 migrate node packages/db/scripts/rewrap-keys.mjs --dry-run
   # same command without --dry-run; repeat until it reports 0 remaining
   ```
4. Wait until the next nightly backup has run, keep one more month of backups that still need k1, then remove `FILE_KEK_K1` from `.env` (keep it in the password manager for old backups) and redeploy.

## Data requests and privacy

- Export my data, delete my account and the research opt-in are self-service on the dashboard (`docs/PRIVACY_NOTES.md`).
- Raw files are deleted 30 days after upload, unfinished analyses after 24 hours, usage logs after 12 months and audit logs after 24 months (nightly job at 02:00 IST; `RETENTION_*` in `.env`).
- Owner-only manual plan grant: admin console → Grant plan (reason required; audited).
- Every file read and decrypt is in `file_access_log`. Admin reads of user data are in `audit_log`.

## Updating the server

Ubuntu security updates install automatically (`unattended-upgrades`). For kernel updates, reboot in a quiet hour: `sudo reboot`. The containers restart by themselves (`restart: unless-stopped`); check with `dc ps` and `curl /api/v1/ready`. Image versions (Postgres, Redis, Garage, Caddy) change only through a commit and a deploy.
