import { defineConfig } from 'vitest/config';

// Server timezone is pinned (backend-v2 plan D9). Database tests (test/db) skip themselves when the
// throwaway test Postgres is not running: npm run db:test:up && npm run test:db
process.env.TZ = 'Asia/Kolkata';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
