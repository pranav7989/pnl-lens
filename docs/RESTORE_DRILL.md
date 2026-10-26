# Deploy, backup and restore drill

A rehearsal of the production scripts with the production compose file, run before the first real deployment. Repeat it every 3 months, and after any change to `infra/scripts/` or `infra/compose.prod.yml` (`docs/RUNBOOK.md`).

## Drill 1 · 2026-10-12 (Docker Desktop, production compose)

**Setup:** a throwaway clone of the branch with each version as a git tag, the real `.env` generator, `TLS_MODE=internal` (Caddy's own certificate), `DOMAIN=drill.pnllens.test`, a local restic repository, compose project `pnl-drill` (so the dev stack was not touched). Every step ran through the real scripts; nothing was done by hand except creating the test data.

| # | Step | Result |
|---|---|---|
| 1 | `deploy.sh v0.0.1-drill`: check out → build → migrate + roles → storage keys → start → ready **through Caddy over HTTPS** | `deploy_ok` in 60 s (cached layers) |
| 2 | Smoke test over HTTPS: sign-in session, upload with consent, analysis, save report (spends 1 of the plan's reports) | analysis `ready`; report with **96 trades**; 1 encrypted statement in Garage; home page 200; HSTS present; `http://` → 301 `https://` |
| 3 | `backup.sh` | restic repository created; database dump + statements bucket in one encrypted snapshot (180 KB); `backup_ok` in 13 s |
| 4 | **Wipe:** `docker compose down -v`: all containers, networks and volumes (database, storage, Redis) deleted | 0 volumes left; site down |
| 5 | `restore.sh latest` | `restore_ok` in 33 s |
| 6 | Data after the restore | same report, 96 trades, 1 user, the statement object present; roles `lens_app`/`lens_worker` can log in, `lens_research` cannot; 18 migrations; **the session issued before the wipe still works** |
| 7 | The restored statement is still decryptable: "+" added a second statement, which re-analyses both | analysis `ready`, report updated; `file_access_log` shows a new `read` + `decrypt` of the restored file |
| 8 | Automatic rollback: `deploy.sh v0.0.5-good`, then `deploy.sh v0.0.6-broken` (Caddy pointed `/api` at a wrong port on purpose) | broken version: `deploy_failed` → `rollback_start` → `rollback_ok` (201 s in total); site ready on v0.0.5 with the right Caddy config; `.deploy/current` = v0.0.5-good |
| 9 | `healthcheck.sh`: healthy, then api stopped, the same problem again, then api started | `ok` → one `alert` → no repeat → `recovered` (mail skipped: no Resend key in the drill, logged as `alert_not_sent`) |

### Bugs the drill found (all fixed before the Phase 8 commit)

| Bug | Effect if it had shipped | Fix |
|---|---|---|
| Caddy's config was mounted as a single file. `git checkout` replaces the file, and the running container kept the old one | A deploy never changed the Caddy config. Step 8 first "succeeded" with a broken config, because the old config stayed loaded | `infra/caddy/` mounted as a folder; `deploy.sh` runs `caddy reload` on every deploy (graceful; an invalid file fails the deploy and triggers rollback) |
| The certificate folder was mounted inside that read-only folder | Caddy could not start | Certificates mounted at `/etc/caddy-certs` |
| `restore.sh` mounted a local restic repository read-only | The restore hung (restic writes a lock even to read) | Mounted read-write |
| `restore.sh` only created the login roles before `pg_restore` | Grants to `lens_research` (created only by migrations) would fail the restore | The full migrate job runs on the empty database first; `pg_restore --clean` then replaces every object |
| Scripts used image tag `local` unless `IMAGE_TAG` was set | `restore.sh` on a server would look for images that don't exist | `lib.sh` defaults `IMAGE_TAG` to the deployed version in `.deploy/current` |
| `backup.sh`/`restore.sh` passed the database password and the storage keys on the command line | Visible in `ps` to other users of the server | Passed through the environment only |
| Empty arrays under `set -u` (bash 3.2 on macOS) | The scripts failed on a Mac (the server's bash 5.2 was fine) | Portable expansion |

### Not covered by this drill

- `provision.sh` on a fresh Ubuntu 24.04 machine (Docker install, users, SSH hardening, firewall, cron). It passes shellcheck. Run it on a Multipass VM (`brew install --cask multipass`, then `multipass launch 24.04 --name pnl --cpus 2 --memory 4G --disk 30G`) or on the real Droplet, then record the result here.
- Cloudflare origin-certificate mode (`TLS_MODE=cloudflare`): the Caddyfile validates with a test certificate; the real certificate is checked on the Droplet.
- An off-site (Spaces) restic repository. The commands are the same as for the local one; check them with the first production backup and a restore on a throwaway Droplet (`docs/GO_LIVE_CHECKLIST.md` A10).
