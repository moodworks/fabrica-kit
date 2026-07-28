import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3102';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    acceptDownloads: true,
    baseURL,
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3102',
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/banner-ai/editor`,
  },
});
