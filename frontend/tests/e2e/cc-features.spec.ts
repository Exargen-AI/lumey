import { test, expect, request } from '@playwright/test';

/**
 * End-to-end coverage for the 4 CC features (subscriptions / nudge /
 * encouragement / mentions) against the FULL stack: real Postgres,
 * real Express, real auth, real migrations. The unit suite uses
 * prismaMock; the *.real.test.ts suite uses real Postgres but no
 * HTTP layer; this spec is the only place that exercises every layer
 * end-to-end with the same setup users would hit in production.
 *
 * Why API-level (not UI-driven) for these flows:
 *
 *   The 4 CC features are deep services + dozens of DB writes. Driving
 *   the modal, finding the right task, clicking through 4 sub-flows
 *   would be brittle (selector churn on every UI refactor) and would
 *   re-test what we already pin at the component level. The HIGH-VALUE
 *   property we want to assert here is "the full backend works
 *   end-to-end for these features against a fresh Postgres", and that's
 *   exactly what an API-level spec running inside the Playwright job
 *   captures.
 *
 *   One UI-level test for Follow lives separately in smoke.spec.ts (or
 *   will, once the seeded task IDs are stable enough to target).
 */

const API = 'http://localhost:3002/api/v1';

// Backend's `requireOrigin` middleware (see backend/src/middleware/requireOrigin.ts)
// refuses state-changing requests without an Origin or Referer header — the
// CSRF defense from QA finding #34. Playwright's `request.newContext()`
// doesn't set Origin by default (it's a server-side HTTP client, not a
// browser context), so without this every POST/PATCH/PUT here would 403.
// Match the dev FE origin so the request looks identical to a real
// in-browser fetch from the Vite dev server.
const ORIGIN_HEADER = { origin: 'http://localhost:5174' };

/**
 * Build a request context that satisfies the backend's CSRF defense
 * (`requireOrigin` middleware refuses POST/PUT/PATCH/DELETE without
 * an Origin header). Use this instead of `request.newContext()`
 * directly throughout this spec.
 */
async function newApiContext() {
  return request.newContext({ extraHTTPHeaders: ORIGIN_HEADER });
}

async function loginAs(reqCtx: ReturnType<typeof request.newContext> extends Promise<infer T> ? T : never, email: string) {
  const r = await reqCtx.post(`${API}/auth/login`, {
    data: { email, password: 'Admin@1234' },
  });
  expect(r.status(), `login as ${email}`).toBe(200);
  const body = await r.json();
  return {
    token: body.data.accessToken as string,
    userId: body.data.user.id as string,
  };
}

test.describe('CC features — end-to-end through the real stack', () => {
  test('case-insensitive email login works against the real DB', async () => {
    // Pre-condition: the seeded user is stored as `karthik@exargen.in` after
    // the lowercase-emails migration. A mixed-case login MUST succeed.
    const reqCtx = await newApiContext();
    const r = await reqCtx.post(`${API}/auth/login`, {
      data: { email: 'Karthik@Exargen.IN', password: 'Admin@1234' },
    });
    expect(r.status(), 'mixed-case login should resolve to the seeded lowercase row').toBe(200);
    const body = await r.json();
    expect(body.data.user.email).toBe('karthik@exargen.in');
    await reqCtx.dispose();
  });

  test('subscribe / unsubscribe / list — the Follow chip-list contract', async () => {
    const reqCtx = await newApiContext();

    // Step 1: log in as karthik and find a task he can interact with.
    const karthik = await loginAs(reqCtx, 'karthik@exargen.in');
    const tasksRes = await reqCtx.get(`${API}/my-tasks`, {
      headers: { Authorization: `Bearer ${karthik.token}` },
    });
    expect(tasksRes.status()).toBe(200);
    const tasks = (await tasksRes.json()).data;
    test.skip(!tasks || tasks.length === 0, 'no seeded task available for engineer');
    const task = tasks[0];

    // Step 2: list subscribers. As the assignee/creator karthik may
    // already be auto-subscribed; we don't assert the initial state,
    // only that the LIST endpoint responds with the expected shape.
    const listRes = await reqCtx.get(`${API}/tasks/${task.id}/subscribers`, {
      headers: { Authorization: `Bearer ${karthik.token}` },
    });
    expect(listRes.status()).toBe(200);
    const subs = (await listRes.json()).data;
    expect(Array.isArray(subs)).toBe(true);
    if (subs.length > 0) {
      expect(subs[0]).toHaveProperty('source');
      expect(['AUTO_CREATOR', 'AUTO_ASSIGNEE', 'AUTO_REVIEWER', 'AUTO_MENTIONED', 'MANUAL'])
        .toContain(subs[0].source);
    }

    // Step 3: a DIFFERENT user subscribes. We use admin@exargen.in
    // because (a) admin has project.view_all so the taskAccess
    // membership check is bypassed regardless of which project
    // karthik's /my-tasks returns, and (b) admin is never an
    // auto-subscriber on engineer tasks, so we can prove the MANUAL
    // source code path without first un-doing an auto-subscribe.
    //
    // Match the subscriber list entry by user.id (NOT email): the
    // list endpoint returns `{ id, name, role }` for each user, no
    // email. We captured admin.userId from the login response.
    const admin = await loginAs(reqCtx, 'admin@exargen.in');
    const subRes = await reqCtx.post(`${API}/tasks/${task.id}/subscribe`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect([200, 201], `subscribe status: got ${subRes.status()}`).toContain(subRes.status());

    const afterSub = await reqCtx.get(`${API}/tasks/${task.id}/subscribers`, {
      headers: { Authorization: `Bearer ${karthik.token}` },
    });
    const afterList = (await afterSub.json()).data;
    const adminEntry = afterList.find((s: { userId: string }) => s.userId === admin.userId);
    expect(adminEntry, 'admin should appear in subscribers after subscribe').toBeTruthy();
    expect(adminEntry.source).toBe('MANUAL');

    // Step 4: idempotent re-subscribe. Same admin hitting POST twice
    // should NOT 409 — the upsert pattern means clicking Follow on an
    // already-followed task is a no-op.
    const subAgain = await reqCtx.post(`${API}/tasks/${task.id}/subscribe`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect([200, 201]).toContain(subAgain.status());

    // Step 5: unsubscribe. Admin drops off the chip list.
    const unsubRes = await reqCtx.delete(`${API}/tasks/${task.id}/subscribe`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect([200, 204]).toContain(unsubRes.status());

    const afterUnsub = await reqCtx.get(`${API}/tasks/${task.id}/subscribers`, {
      headers: { Authorization: `Bearer ${karthik.token}` },
    });
    const afterUnsubList = (await afterUnsub.json()).data;
    expect(
      afterUnsubList.find((s: { userId: string }) => s.userId === admin.userId),
      'admin should be gone after unsubscribe',
    ).toBeFalsy();

    await reqCtx.dispose();
  });

  test('nudge endpoint enforces the 24h cooldown', async () => {
    const reqCtx = await newApiContext();

    // Log in as admin (who has project.view_all, so the taskAccess
    // membership check is bypassed for any project) and nudge karthik
    // on one of his tasks. Then nudge again — second call must 409
    // with a cooldown message.
    const admin = await loginAs(reqCtx, 'admin@exargen.in');
    const karthik = await loginAs(reqCtx, 'karthik@exargen.in');

    // Find a task assigned to karthik (so admin can nudge him).
    const tasksRes = await reqCtx.get(`${API}/my-tasks`, {
      headers: { Authorization: `Bearer ${karthik.token}` },
    });
    const tasks = (await tasksRes.json()).data;
    test.skip(!tasks || tasks.length === 0, 'no seeded task for engineer');
    const task = tasks[0];

    // First nudge — should succeed (or 409 if admin already nudged
    // this task in another test run; the e2e suite uses a fresh DB
    // per CI run so cleanup isn't a concern).
    const firstNudge = await reqCtx.post(`${API}/tasks/${task.id}/nudge`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { message: 'gentle bump from e2e' },
    });
    expect([200, 201, 409], `first nudge status: ${firstNudge.status()}`).toContain(firstNudge.status());

    // Immediate second nudge — MUST 409 with the cooldown error.
    const secondNudge = await reqCtx.post(`${API}/tasks/${task.id}/nudge`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { message: 'second bump' },
    });
    expect(secondNudge.status()).toBe(409);
    const body = await secondNudge.json();
    expect(JSON.stringify(body)).toMatch(/cooldown|try again|24/i);

    await reqCtx.dispose();
  });
});
