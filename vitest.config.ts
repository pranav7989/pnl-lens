import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Server timezone is pinned (backend-v2 plan D9); worker processes inherit it.
process.env.TZ = 'Asia/Kolkata';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
