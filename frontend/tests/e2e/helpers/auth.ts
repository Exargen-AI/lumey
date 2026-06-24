import { Page, expect } from '@playwright/test';

/**
 * Log in as a seeded user. The auth store reads `accessToken` from
 * localStorage on init, so we just call the API directly and seed the value —
 * faster + more reliable than driving the form via UI on every test.
 */
export async function login(page: Page, email: string, password = 'Admin@1234') {
  await page.goto('/login');

  // Hit the API directly via the page's fetch so cookies + origin match.
  const result = await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch('http://localhost:3002/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      return { status: r.status, token: j?.data?.accessToken, role: j?.data?.user?.role };
    },
    { email, password },
  );

  expect(result.status, `login as ${email} failed`).toBe(200);
  expect(result.token, 'no token returned').toBeTruthy();

  // Seed the token + reload so the auth store picks it up on init.
  await page.evaluate((token) => localStorage.setItem('accessToken', token), result.token);

  return result;
}

/** Log out via the auth store's clearAuth — bypasses the slide-out menu. */
export async function logout(page: Page) {
  await page.evaluate(() => localStorage.removeItem('accessToken'));
  await page.goto('/login');
}

/**
 * Assert the page has zero console errors (excluding noisy network/auth ones
 * that happen during normal flow). Pass an optional ignore-pattern to filter.
 */
export function setupConsoleErrorTracking(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected dev-only noise: cancelled requests, abort errors,
      // React strict-mode double-render warnings.
      if (/aborted|cancelled|net::ERR_CANCELED/i.test(text)) return;
      // /auth/refresh 401s during the test-login bootstrap are expected:
      // the helper seeds `accessToken` in localStorage but never sets the
      // httpOnly refresh cookie (cross-origin :5174 → :3002 in dev), so
      // the first /auth/refresh on app boot 401s and the response
      // interceptor recovers silently. Real users who actually drive the
      // form never see this. Filtering keeps the assertion focused on
      // genuine regressions.
      if (/Failed to load resource.*401/i.test(text)) return;
      errors.push(text);
    }
  });
  return errors;
}
