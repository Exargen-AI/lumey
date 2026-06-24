import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-test config for the Exargen Command Center frontend.
 *
 * Assumes:
 *   - Frontend dev server running at http://localhost:5174 (Vite default in
 *     this repo). Boot via `npm run dev:frontend` from the monorepo root.
 *   - Backend running at http://localhost:3002 with seed data loaded.
 *     Tests log in with `<seedEmail>@exargen.in` / `Admin@1234`.
 *
 * Run with: `npx playwright test`
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Tests share the same dev DB; serial keeps state predictable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Some flows take a sec to render after auth — give them headroom.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Don't auto-start the dev server here — assume it's already running, since
  // the same server is what the engineer uses for local dev. Avoids port wars.
});
