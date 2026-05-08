import { defineConfig, devices } from '@playwright/test';

const port = 3925;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: [
      'rm -f /tmp/naviproxy-e2e.sqlite /tmp/naviproxy-e2e.sqlite-*',
      'npm run build',
      `ADMIN_TOKEN= DASHBOARD_AUTH_REQUIRED=false PORT=${port} DATABASE_PATH=/tmp/naviproxy-e2e.sqlite CADDY_SYNC_ENABLED=false WEB_DIST_PATH=$PWD/apps/web/dist npm run start -w @naviproxy/api`
    ].join(' && '),
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
