import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for distributionMapApp.
 *
 * Serves static files + templates via a simple Python HTTP server.
 * Set BASE_URL to point at the running Flask app for full-stack testing.
 * Set SKIP_WEB_SERVER=1 and ensure BASE_URL points at a running server.
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'python3 -m http.server 8080',
        port: 8080,
        reuseExistingServer: true,
        timeout: 10_000,
      },
});
