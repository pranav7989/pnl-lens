# @file  infra/docker/api.Dockerfile
# @area  Ops
# @what  Fastify API image. Build context = repo root. Debian slim: official Node binary with full ICU. Bundled with esbuild (workspace packages inlined).
FROM node:22.23.2-bookworm-slim AS base
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

# ---- build (all deps incl. TypeScript)
FROM base AS build
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY packages/db/src packages/db/src
COPY packages/engine/src packages/engine/src
COPY apps/api apps/api
RUN npm run build -w @pnl-lens/api

# ---- production deps only for this workspace
FROM base AS prod-deps
RUN npm ci --no-audit --no-fund --ignore-scripts --omit=dev -w @pnl-lens/api

# ---- runtime
FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=4000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
# fonts embedded in the 30-day plan PDF (Manrope, OFL; the ₹ glyph from DejaVu)
COPY apps/api/assets apps/api/assets
# MAIL_DRIVER=console writes .data/dev-mail.log (dev stack); the rest of the filesystem stays root-owned
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
