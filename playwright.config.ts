import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for distributionMapApp.
 *
 * Renders the real Jinja template with validated limits using a frontend-only
 * Flask server. API calls return 503 unless mocked by a browser test.
 * BASE_URL + SKIP_WEB_SERVER=1 target an explicitly selected external server.
 * PLAYWRIGHT_EXECUTABLE_PATH optionally selects a portable Chromium binary.
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
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : undefined,
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
        command: '.venv/bin/python tests/e2e/server.py --port 8080',
        url: 'http://127.0.0.1:8080/templates/index.html',
        reuseExistingServer: false,
        timeout: 10_000,
      },
});
