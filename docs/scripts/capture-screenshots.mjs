/**
 * Reproducible documentation screenshots. Drives the running local app with
 * Playwright (chromium) and saves real PNGs into docs/modules/images/, so the
 * module docs show the actual UI — not prose descriptions of it.
 *
 * Prereqs (the local-demo loop): backend on :3000, Lumey frontend on :5180
 * (`preview_start lumey`), and the demo fixtures seeded AFTER the backend boots
 * (see backend/_demo/seed-*.ts). Then, from the frontend workspace:
 *
 *   node ../docs/scripts/capture-screenshots.mjs
 *
 * Login uses the seed admin (admin@exargen.in / Admin@1234). Re-run any time the
 * UI changes to refresh the doc images.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.LUMEY_WEB ?? 'http://localhost:5180';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules/images');

// The BountiPOS "Sales analytics dashboard" task the demo fixtures hang off.
const DEMO_TASK = '/projects/940702ce-8ecd-4c06-a6cc-e9d5e45a3481/tasks/5e06b6b2-f05c-4d17-b164-42004369abed';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 940, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // ── sign in ──
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', 'admin@exargen.in');
  await page.fill('input[type="password"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // ── full-page standalone views ──
  for (const [name, url] of [['fleet', '/fleet'], ['models', '/models']]) {
    await page.goto(`${BASE}${url}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`saved ${name}.png`);
  }

  // ── activity feed (agent attribution badge) ──
  await page.goto(`${BASE}/today`);
  await page.waitForTimeout(1500);
  const agentRow = page.locator('p', { hasText: 'commented on' }).first();
  if (await agentRow.count()) {
    await agentRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/activity-actor-type.png` });
    console.log('saved activity-actor-type.png');
  }

  // ── run card states: expand each run, detect its panels, save accordingly.
  // RunsSection keeps only one run open at a time, so the page reflects the
  // expanded run's panels (clarification / approval / SDLC+receipt / policy).
  await page.goto(`${BASE}${DEMO_TASK}`);
  await page.waitForTimeout(1500);
  const runRows = page.getByRole('button').filter({ hasText: /Needs input|Awaiting review/i });
  const total = await runRows.count();
  const want = [
    { key: 'run-clarification', marker: /Agent needs your input/i },
    { key: 'run-approval', marker: /Approval needed/i },
    { key: 'run-sdlc-receipt', marker: /Delivery pipeline/i },
    { key: 'run-policy', marker: /Governed by policy/i },
  ];
  const done = new Set();
  for (let i = 0; i < total && done.size < want.length; i++) {
    await runRows.nth(i).scrollIntoViewIfNeeded();
    await runRows.nth(i).click();
    await page.waitForTimeout(1100);
    const body = await page.locator('body').innerText();
    for (const w of want) {
      if (done.has(w.key) || !w.marker.test(body)) continue;
      const anchor = page.locator('p').filter({ hasText: w.marker }).last();
      if (await anchor.count()) await anchor.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${w.key}.png` });
      console.log(`saved ${w.key}.png`);
      done.add(w.key);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
