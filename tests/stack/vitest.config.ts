import { defineConfig } from 'vitest/config';

// Stack tests run against the live dev stack (npm run stack:up). They are not part of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/stack/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
