# @file  infra/docker/web.Dockerfile
# @area  Ops
# @what  Next.js web app image (standalone server). Build context = repo root.
# ---- deps
FROM node:22.23.2-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/scripts apps/web/scripts
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN mkdir -p apps/web/public && npm ci --no-audit --no-fund

# ---- build
FROM node:22.23.2-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/apps/web/public/pdf.worker.min.mjs ./apps/web/public/pdf.worker.min.mjs
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @pnl-lens/web

# ---- runtime (Next.js standalone server, traced from the repo root)
FROM node:22.23.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Kolkata
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
