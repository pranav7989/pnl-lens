# ---- deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime (Next.js standalone server)
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app \
 && wget -qO /app/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ENV DATABASE_CA_PATH=/app/rds-ca.pem
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# migration runner + SQL so the same image can run `node scripts/migrate.mjs` as a one-off ECS task
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db
# (pg and its dependencies are already traced into .next/standalone/node_modules)
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
