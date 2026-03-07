import { defineConfig, devices } from '@playwright/test'

const port = 4321
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      `npx cross-env PUBLIC_SUPABASE_URL=http://example.com ` +
      `PUBLIC_SUPABASE_ANON_KEY=public-anon-key ` +
      `PUBLIC_SUPABASE_ASSETS_BUCKET=site-assets ` +
      `PUBLIC_SUPABASE_FETCH_DISABLED=1 ` +
      `SUPABASE_FETCH_DISABLED=1 ` +
      `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
