# @file  infra/docker/tools.Dockerfile
# @area  Ops
# @what  One-off jobs image: DB migrations + role passwords + dev seed, and Garage storage setup. Build context = repo root.
FROM node:22.23.2-bookworm-slim
# npm downloads retry with backoff, so a short network drop on the build machine doesn't fail the image (CI run 38575945565)
ENV npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=120000
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci --no-audit --no-fund --ignore-scripts --omit=dev -w @pnl-lens/db
COPY packages/db/migrations packages/db/migrations
COPY packages/db/scripts packages/db/scripts
COPY packages/db/seed.sql packages/db/seed.sql
COPY infra/scripts/storage-init.mjs infra/scripts/storage-init.mjs
ENV NODE_ENV=production
USER node
