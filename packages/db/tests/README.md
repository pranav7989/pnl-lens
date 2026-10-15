Database tests.

**Main suite (backend v2):** `packages/db/test/` (vitest). From the repo root:

    npm run db:test:up     # throwaway Postgres on 127.0.0.1:55432 (infra/compose.test.yml)
    npm run test:db        # fresh databases, every migration from 0001, role-scoped clients

**Legacy SQL check (this folder):** exercises the old 0003 functions that apps/web uses until the Phase 6 cutover.
Run on any migrated Postgres 16:

    npm run db:migrate            # uses MIGRATE_DATABASE_URL / DATABASE_URL (admin credentials)
    psql "$ADMIN_URL" -f packages/db/seed.sql
    psql "$ADMIN_URL" -f packages/db/tests/01_functions.sql

Expected: credit decrements, `no_credits` at zero, the app role cannot insert reports directly (0012), 4-file insert
rejected, delete idempotent, app role denied DELETE and DDL, purge nulls payloads, audit rows written.
