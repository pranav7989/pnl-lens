# Infrastructure (Docker Compose)

The backend-v2 stack: one machine, Docker Compose, two private networks, and **only Caddy reachable from outside**.
Dev stack: `infra/compose.dev.yml` (Phase 2). Production compose, TLS, backups and deploys arrive in Phase 8.

```
host :8080 (127.0.0.1 only) ──► caddy ──┬── /api/v1/*  ──► api     (Fastify)
                                         └── everything ──► web     (Next.js)
  network edge      : caddy · web · api                       (has internet: email, Google, Razorpay)
  network internal  : web* · api · worker · postgres · redis · garage · migrate · storage-init
                      (Docker "internal: true" — no route to the internet)
  * web is on internal only until the Phase 6 cutover (it still holds today's API routes + DB access)
```

## Services

| Service | Image | Networks | Purpose |
|---|---|---|---|
| caddy | `caddy:2.11.4-alpine` | edge | Reverse proxy; the only published port. 35 MB body limit, no `Server` header, JSON access logs |
| web | `infra/docker/web.Dockerfile` (node 22.23.2 alpine) | edge, internal | Next.js app (unchanged UI) |
| api | `infra/docker/api.Dockerfile` (node 22.23.2 bookworm-slim) | edge, internal | Fastify API (`/api/v1`, see `docs/API.md`), bundled with esbuild |
| worker | `infra/docker/worker.Dockerfile` (node 22.23.2 bookworm-slim) | internal | Job worker. Phase 2: dependency checks only. `TZ=Asia/Kolkata` (plan D9) |
| postgres | `postgres:16.14-bookworm` | internal | Database `lens`. Apps log in as `lens_app` / `lens_worker`, never the superuser |
| redis | `redis:7.4.11-alpine` | internal | Queue store. Password required, AOF on, `noeviction` |
| garage | `dxflrs/garage:v2.4.1` | internal | S3-compatible file storage (replaces MinIO, plan D14). Bucket `statements` |
| migrate | `infra/docker/tools.Dockerfile` | internal | One-off: migrations → role passwords (`setup-roles.mjs`) → dev seed |
| storage-init | `infra/docker/tools.Dockerfile` | internal | One-off: Garage layout, private bucket, least-privilege keys (`infra/scripts/storage-init.mjs`) |

## Least privilege

| Who | Postgres | Redis | Storage (bucket `statements`) |
|---|---|---|---|
| api | `lens_app`: no DDL, no DELETE; since 0012 no direct writes to credits, subscriptions or report contents (only `title`); plans and reports change through SECURITY DEFINER functions | password | **write only**: can upload, cannot read back or list |
| worker | `lens_worker` (0008–0013): reads jobs and file metadata, writes engine results, runs purge jobs; nothing on users, payments, credits, subscriptions, consents or reports | password | read + write (S3 needs write to delete for purge) |
| web (until Phase 6) | `lens_app` | — | — |
| research (future) | `lens_research`: NOLOGIN; SELECT on the pseudonymised `research.*` views only (0014) | — | — |
| anyone else | `PUBLIC` has no CONNECT on the database | refused | anonymous refused; bucket has no website/public access |

## Commands (repo root)

| Task | Command |
|---|---|
| Create secrets (first time; safe to re-run) | `npm run stack:env` → fills `.env` with random values for anything missing |
| Build + start, wait until healthy | `npm run stack:up` → http://localhost:8080 |
| Prove the rules above | `npm run test:stack` |
| Logs | `npm run stack:logs` |
| Stop (keeps data) | `npm run stack:down` |
| Stop and **delete all data** | `docker compose --env-file .env -f infra/compose.dev.yml down -v` |
| Rebuild api/worker on code change | `docker compose --env-file .env -f infra/compose.dev.yml watch` |
| Database tests (separate throwaway Postgres on 127.0.0.1:55432) | `npm run db:test:up` → `npm run test:db` → `npm run db:test:down` |
| Debug ports on 127.0.0.1 (Postgres 5432, Redis 6379, S3 3900) | add `-f infra/compose.dev.ports.yml` to the compose command |

Windows: Docker Desktop must show **Engine running**. Compose reads `.env` from the repo root because the scripts pass `--env-file .env`.

## Secrets

All in `.env` (git-ignored, created by `npm run stack:env`): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `LENS_APP_PASSWORD`, `LENS_WORKER_PASSWORD`, `REDIS_PASSWORD`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, `S3_API_ACCESS_KEY_ID`, `S3_API_SECRET_ACCESS_KEY`, `S3_WORKER_ACCESS_KEY_ID`, `S3_WORKER_SECRET_ACCESS_KEY`, plus `TEST_POSTGRES_PASSWORD` for the throwaway test database (`infra/compose.test.yml`) and, for the API, `SESSION_SECRET`, `OTP_PEPPER`, `IP_HASH_SECRET`, `FILE_KEK_ID`, `FILE_KEK_K1`. Nothing secret is in compose files, Dockerfiles, `garage.toml` or images (`.dockerignore` excludes `.env*`).

**Rotating secrets:**
- Postgres app roles: change the value in `.env`, then run `npm run stack:up` again. The `migrate` job re-applies role passwords on every run.
- Redis: change the value in `.env`, then run `npm run stack:up`.
- File encryption key (`FILE_KEK_K1`): never change it while files encrypted with it exist. Add `FILE_KEK_K2`, set `FILE_KEK_ID=k2`, and keep K1 until every file is re-wrapped or purged.
- S3 keys: Garage keeps imported keys, so `storage-init` refuses a changed secret for an existing key ID. Either use a new key ID, or reset storage with `down -v`, which deletes the stored files.

Dev convenience settings that must never reach production: `ALLOW_DEV_AUTH_IN_PROD=true` and `SEED_DEV_DATA=true` (`compose.dev.yml` only), plus Caddy on plain HTTP.
