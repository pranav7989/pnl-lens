import { defineConfig } from '@playwright/test';

// Browser end-to-end tests against the running stack in jwt mode (infra/compose.e2e.yml). See docs/TESTING.md.
export default defineConfig({
  testDir: 'tests/e2e-web',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
});
