import { defineConfig } from 'vitest/config';

// Server timezone is pinned (backend-v2 plan D9). The goldens were generated with it; worker processes inherit it.
process.env.TZ = 'Asia/Kolkata';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
