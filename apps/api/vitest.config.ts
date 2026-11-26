import { defineConfig } from 'vitest/config';

// Server timezone pinned (plan D9). API tests need the throwaway test Postgres (npm run db:test:up) and skip without it.
process.env.TZ = 'Asia/Kolkata';
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false },
});
