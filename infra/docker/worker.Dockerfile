# @file  infra/docker/worker.Dockerfile
# @area  Ops
# @what  Worker image. Build context = repo root. Debian slim: official Node binary with full ICU (engine formatting).
FROM node:22.23.2-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

# ---- build (all deps incl. TypeScript)
FROM base AS build
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
RUN npm run build -w @pnl-lens/worker

# ---- production deps only for this workspace
FROM base AS prod-deps
RUN npm ci --no-audit --no-fund --ignore-scripts --omit=dev -w @pnl-lens/worker

# ---- runtime
FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
# Pinned server timezone (plan D9): the engine's date fallback depends on it.
ENV NODE_ENV=production TZ=Asia/Kolkata
COPY --from=prod-deps /app/node_modules ./node_modules
COPY apps/worker/package.json apps/worker/package.json
COPY --from=build /app/apps/worker/dist apps/worker/dist
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/worker/dist/main.js"]
