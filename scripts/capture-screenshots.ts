/**
 * Doc-screenshot capture script.
 *
 * Walks a logged-in admin session through every major surface and saves
 * a labelled PNG into docs/screenshots/. Re-run any time the UI changes
 * to refresh the product guide.
 *
 * Usage (from repo root):
 *   npx tsx scripts/capture-screenshots.ts
 *
 * Pre-reqs:
 *   - Frontend dev server on http://localhost:5174 (default Vite port)
 *   - Backend on http://localhost:3002 with seed data + custom-fields seed
 *   - Admin login `admin@exargen.in` / `Admin@1234`
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.PW_BASE_URL  || 'http://localhost:5174';
const API  = process.env.PW_API_URL   || 'http://localhost:3002';
const OUT  = path.join(process.cwd(), 'docs/screenshots');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    deviceScaleFactor: 2, // crisp on Retina
  });
  const page = await ctx.newPage();

  // ─── Login as admin via API, then visit pages with token in localStorage ───
  const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
    data: { email: 'admin@exargen.in', password: 'Admin@1234' },
  });
  const login = await loginRes.json();
  const { accessToken, refreshToken, user } = login.data;

  // Seed localStorage on the BASE origin so the SPA picks up the session.
  await page.goto(BASE);
  await page.evaluate(([a, r, u]) => {
    localStorage.setItem('accessToken', a);
    localStorage.setItem('refreshToken', r);
    localStorage.setItem('user', JSON.stringify(u));
  }, [accessToken, refreshToken, user]);

  // Get a Furix project + a Furix task id for deep-link screenshots.
  const projectsRes = await page.request.get(`${API}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const projects = (await projectsRes.json()).data;
  const furix = projects.find((p: any) => p.slug === 'furix-ai') ?? projects[0];

  const tasksRes = await page.request.get(`${API}/api/v1/projects/${furix.id}/tasks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const tasks = (await tasksRes.json()).data;
  const sampleTask = tasks.find((t: any) => t.status === 'IN_PROGRESS') ?? tasks[0];

  type Shot = { label: string; visit: string; setup?: () => Promise<void> };
  const shots: Shot[] = [
    { label: '01-login',                   visit: `/login` },
    { label: '02-studio-portfolio',        visit: `/dashboard` },
    { label: '03-triage-inbox',            visit: `/inbox` },
    { label: '04-project-detail-board',    visit: `/projects/${furix.id}`,
      setup: async () => {
        await page.locator('button', { hasText: /^Board$/ }).first().click({ trial: false }).catch(() => {});
      },
    },
    { label: '05-project-detail-sprints',  visit: `/projects/${furix.id}`,
      setup: async () => {
        await page.locator('button', { hasText: /^Sprints$/ }).first().click().catch(() => {});
        await page.waitForTimeout(800);
      },
    },
    { label: '06-project-detail-epics',    visit: `/projects/${furix.id}`,
      setup: async () => {
        await page.locator('button', { hasText: /^Epics$/ }).first().click().catch(() => {});
        await page.waitForTimeout(600);
      },
    },
    { label: '07-project-detail-settings', visit: `/projects/${furix.id}`,
      setup: async () => {
        await page.locator('button', { hasText: /^Settings$/ }).first().click().catch(() => {});
        await page.waitForTimeout(600);
      },
    },
    { label: '08-task-detail',             visit: `/projects/${furix.id}/tasks/${sampleTask.id}` },
    { label: '09-keyboard-shortcuts',      visit: `/projects/${furix.id}`,
      setup: async () => {
        await page.locator('button', { hasText: /^Board$/ }).first().click().catch(() => {});
        await page.waitForTimeout(500);
        await page.keyboard.press('?');
        await page.waitForTimeout(500);
      },
    },
  ];

  for (const s of shots) {
    process.stdout.write(`📸 ${s.label}…`);
    await page.goto(BASE + s.visit, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    if (s.setup) await s.setup();
    await page.waitForTimeout(800);
    const file = path.join(OUT, `${s.label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    process.stdout.write(` saved\n`);
  }

  await browser.close();
  console.log(`\n✅ Done. ${shots.length} screenshots in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
