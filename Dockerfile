# Web app image (monorepo). Build from the repo root:  docker build -t pnl-lens-web .
# ---- deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/scripts apps/web/scripts
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN mkdir -p apps/web/public && npm ci --no-audit --no-fund

# ---- build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/apps/web/public/pdf.worker.min.mjs ./apps/web/public/pdf.worker.min.mjs
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @pnl-lens/web

# ---- runtime (Next.js standalone server, traced from the repo root)
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app \
 && wget -qO /app/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ENV DATABASE_CA_PATH=/app/rds-ca.pem
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# migration runner + SQL so the same image can run `node packages/db/scripts/migrate.mjs` as a one-off job
COPY --from=build /app/packages/db/scripts ./packages/db/scripts
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
# (pg and its dependencies are already traced into .next/standalone/node_modules)
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
