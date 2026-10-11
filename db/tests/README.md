Validate the schema on any Postgres 14+ (local, Docker, or an RDS dev instance):

    npm run db:migrate            # uses DATABASE_URL (admin/master credentials)
    psql "$DATABASE_URL" -f db/seed.sql
    psql "$DATABASE_URL" -f db/tests/01_functions.sql

Expected: credit decrements, `no_credits` at zero, 4-file insert rejected, delete idempotent,
app role denied DELETE and DDL, purge nulls payloads, audit rows written.
