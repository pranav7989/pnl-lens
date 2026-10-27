import { defineConfig } from 'vitest/config';

// Server timezone pinned (plan D9). globalSetup builds dist/ so tests fork the same engine-child.js the image runs.
// DB/queue suites need the throwaway services (npm run db:test:up) and skip without them.
process.env.TZ = 'Asia/Kolkata';
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    environment: 'node', include: ['test/**/*.test.ts'], globalSetup: ['test/global-setup.ts'],
    testTimeout: 120_000, hookTimeout: 180_000, fileParallelism: false,
  },
});
