import { test, expect } from '@playwright/test';
import { login, setupConsoleErrorTracking } from './helpers/auth';

/**
 * Smoke tests covering the critical happy-path for each role + the login flow.
 *
 * Goal: catch any regression that would prevent a user from logging in and
 * seeing their main dashboard. NOT comprehensive — those would belong in a
 * separate spec per workflow.
 */

test.describe('Smoke — Login', () => {
  test('login page renders without console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByPlaceholder('you@exargen.in')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('login submit drives user into the right dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('you@exargen.in').fill('admin@exargen.in');
    await page.getByPlaceholder('Enter your password').fill('Admin@1234');
    await page.getByRole('button', { name: /sign in/i }).click();
    // SUPER_ADMIN lands on the admin /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 8_000 });
  });
});

test.describe('Smoke — Engineer', () => {
  test('dashboard renders with greeting + zero console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);
    await login(page, 'karthik@exargen.in');
    await page.goto('/eng/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Karthik');
    expect(errors).toEqual([]);
  });

  test('EOD Update wizard renders step 1', async ({ page }) => {
    await login(page, 'karthik@exargen.in');
    await page.goto('/eng/eod-update');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('End of Day Update');
    await expect(page.getByText(/what did you work on today/i)).toBeVisible();
  });

  test('Timesheet renders the weekly grid', async ({ page }) => {
    await login(page, 'karthik@exargen.in');
    // `/eng/timesheet` is preserved as a redirect to the unified `/my-time`
    // page (timesheet + leave merged into one screen). The redirect
    // resolves before assertions, so we wait for the canonical URL too.
    await page.goto('/eng/timesheet');
    await page.waitForURL(/\/my-time/);
    await expect(page.getByRole('heading', { level: 1, name: 'My Time' })).toBeVisible();
    // Day headers should render
    await expect(page.getByRole('columnheader', { name: /mon/i })).toBeVisible();
  });

  test('MyTasks renders without errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);
    await login(page, 'karthik@exargen.in');
    await page.goto('/eng/my-tasks');
    await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Smoke — PM', () => {
  test('dashboard renders portfolio greeting', async ({ page }) => {
    await login(page, 'ravi@exargen.in');
    await page.goto('/pm/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/portfolio/i);
  });

  test('project detail tabs (Board/Timeline/Decisions) all switch', async ({ page }) => {
    await login(page, 'ravi@exargen.in');
    // Find any project — the dashboard shows their portfolio
    await page.goto('/pm/dashboard');
    await page.locator('a[href*="/pm/projects/"]').first().click();
    await page.waitForURL(/\/pm\/projects\/[a-f0-9-]+/);

    // If there's an acknowledgment gate, accept it via API to get past
    const projectId = page.url().split('/pm/projects/')[1].split(/[/?]/)[0];
    await page.evaluate(async (id) => {
      const tok = localStorage.getItem('accessToken');
      await fetch(`http://localhost:3002/api/v1/projects/${id}/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }, projectId);
    await page.reload();

    // All three tab buttons present
    await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Decisions' })).toBeVisible();

    // Switch to Timeline — verify aria-selected flips
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');

    // And to Decisions
    await page.getByRole('tab', { name: 'Decisions' }).click();
    await expect(page.getByRole('tab', { name: 'Decisions' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Smoke — Admin', () => {
  test('dashboard renders + zero console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);
    await login(page, 'admin@exargen.in');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Exargen/i);
    expect(errors).toEqual([]);
  });

  test('User Management table renders + Add User modal opens', async ({ page }) => {
    await login(page, 'admin@exargen.in');
    await page.goto('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'User Management' })).toBeVisible();

    // Open the Add User modal — proves Modal primitive works
    await page.getByRole('button', { name: /add user/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Add User')).toBeVisible();

    // Escape closes the modal — proves cleanup wiring
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Standup page renders date nav', async ({ page }) => {
    await login(page, 'admin@exargen.in');
    await page.goto('/standup');
    await expect(page.getByRole('heading', { level: 1, name: 'Team Standup' })).toBeVisible();
    await expect(page.getByText(/today/i).first()).toBeVisible();
  });

  test('User Management deactivate triggers confirm dialog (cancel keeps user active)', async ({ page }) => {
    await login(page, 'admin@exargen.in');
    await page.goto('/users');

    // Find the first active user's deactivate button. Karthik is in the seed
    // and active by default — click his deactivate icon.
    const karthikRow = page.getByRole('row', { name: /Karthik/i }).first();
    await karthikRow.getByRole('button', { name: /Deactivate user/i }).click();

    // useConfirm dialog appears — themed Modal, NOT native window.confirm
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Deactivate Karthik/i)).toBeVisible();
    await expect(dialog.getByText(/lose access to the platform/i)).toBeVisible();

    // Cancel dismisses without firing the mutation
    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible();

    // Karthik should still be Active (Active badge still in his row)
    await expect(karthikRow.getByText(/Active/)).toBeVisible();
  });

  test('Confirm dialog dismisses on Escape', async ({ page }) => {
    await login(page, 'admin@exargen.in');
    await page.goto('/users');

    const karthikRow = page.getByRole('row', { name: /Karthik/i }).first();
    await karthikRow.getByRole('button', { name: /Deactivate user/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Activity Feed renders with filters', async ({ page }) => {
    // PR #111 (2026-05-15) merged the old `/activity` page into the
    // unified `/today` view; `/activity` is preserved as a redirect.
    // The new view renders <ActivityFeedView /> whose default h1 is
    // "What's happening" — the same component used in the client
    // portal scoped to a project.
    const errors = setupConsoleErrorTracking(page);
    await login(page, 'admin@exargen.in');
    await page.goto('/activity');
    await page.waitForURL(/\/today/);
    await expect(page.getByRole('heading', { level: 1, name: "What's happening" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Smoke — Client', () => {
  test('client lands on project status (single-project investor auto-redirects)', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);
    await login(page, 'investor@fund.in');
    await page.goto('/client/dashboard');
    // Single-project clients auto-redirect to /client/projects/<id>
    await page.waitForURL(/\/client\/projects\/[a-f0-9-]+/, { timeout: 8_000 });

    // Past the acknowledgment gate, the project hero card shows the project name
    // (acknowledge via API in case still gated)
    const projectId = page.url().split('/client/projects/')[1].split(/[/?]/)[0];
    await page.evaluate(async (id) => {
      const tok = localStorage.getItem('accessToken');
      await fetch(`http://localhost:3002/api/v1/projects/${id}/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }, projectId);
    await page.reload();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Smoke — Acknowledgment modal', () => {
  test('un-acknowledged engineer sees the violet modal on a project', async ({ page }) => {
    await login(page, 'suresh@exargen.in');

    // Find a project Suresh hasn't acknowledged
    const projectId = await page.evaluate(async () => {
      const tok = localStorage.getItem('accessToken');
      const headers = { Authorization: `Bearer ${tok}` };
      const projs = await fetch('http://localhost:3002/api/v1/projects', { headers }).then((r) => r.json());
      for (const p of projs.data) {
        const ack = await fetch(`http://localhost:3002/api/v1/projects/${p.id}/my-acknowledgment`, { headers }).then((r) => r.json());
        if (!ack?.data?.acknowledged) return p.id;
      }
      return null;
    });

    if (!projectId) {
      test.skip(true, 'No un-acknowledged project for suresh — all already accepted');
      return;
    }

    await page.goto(`/eng/projects/${projectId}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Confidentiality Acknowledgment')).toBeVisible();
    await expect(page.getByPlaceholder(/your full name|suresh/i)).toBeVisible();
  });
});
