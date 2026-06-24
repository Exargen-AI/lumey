# Agent Platform — Implementation Plan (Command Center side)

> **Note (revisions in 03):** Slices 1+2 shipped on this plan; subsequent revisions to skill layout and agent framing are captured in `03-skill-architecture-and-framing.md`. The seed value `agentRole: 'junior-coder'` referenced in this plan has been replaced with `'autonomous-engineer'` (idempotently updated on next deploy). Everything else in this plan remains accurate.

**Companion to:** `01-vision-and-spec.md`. The spec describes what we're building and why; this document describes how Command Center is going to build its piece of it, dimension by dimension.

**Scope of this plan:** the Command Center repo. The Podman container, host runtime, `cc` CLI, and Manjari's `~/exargen/manjari/` context files are separate workstreams in different repos and are not in scope here. They are referenced only to confirm what API surfaces Command Center owes them.

**Author:** the Command Center session that read the spec end-to-end and the codebase.
**Living document.** Update as decisions change.

---

## TL;DR

The spec splits Command Center work into three slices:

- **Slice 1 (this PR's scope):** backend foundation. Five new columns on `User`, one new permission, JWT carries a `userType` claim, super-admin can create + manage agents from the existing user-management UI, agents are blocked from transitioning tasks to Done, agents skip the mandatory onboarding course. Seed Manjari. ~1.5–2 days.
- **Slice 2 (deferred):** `GET /api/v1/agents/me/knowledge-pack/:projectSlug` so skill loading can be Command-Center-driven instead of purely filesystem-driven.
- **Slice 3 (deferred until month-3 reveal):** Agent Roster page, Agent Detail page, Agent Logs view, Role Templates page.

The key insight from the spec is that **agents are not a new concept — they're regular `User` rows with a flag**. Adding 5 columns, 1 permission, ~3 service tweaks, and a small admin UI is enough that every existing endpoint (auth, tasks, comments, activity, RBAC) works for Manjari unchanged the moment she has a row.

---

## Locked decisions

These are committed; revisit only with explicit reason.

### D1 — Manjari's auth model: reuse the human login flow

Spec says "pre-authenticated, token mounted at `/run/secrets/cc-token`." Two options were considered:

- **(A) Long-lived "Agent Access Token" (PAT-style).** New table `AgentAccessToken`, super-admin mints + revokes via UI. ~80 LoC of new auth code.
- **(B) Reuse the existing human login flow.** Manjari has a password (set at user creation, mounted into the container as a secret). Runtime POSTs `/auth/login` on container start, gets a 15-min access token + 7-day refresh token, refreshes as needed.

**Decision: (B) for Slice 1.** Zero new auth code. The runtime is going to handle 401→refresh for any other reason; reusing the existing flow is one fewer system to design. We'll move to (A) in Slice 2 if and only if (B) creates concrete pain.

### D2 — How "only humans can transition to Done" is enforced: two layers

Both belt and suspenders should exist:

1. **Permission row.** New `task.transition.done` permission. Default-granted to every human role (`SUPER_ADMIN`, `ADMIN`, `PRODUCT_MANAGER`, `ENGINEER`). Default-denied to `CLIENT`.
2. **Structural check at the service layer.** In `task.service.ts:moveTask` and `updateTask`, if `newStatus === DONE && req.user.userType === 'agent'`, throw `ForbiddenError("Agents may not transition tasks to Done — request a human reviewer.")`.

Either alone is incomplete:
- The permission row alone trusts that no agent role/user gets the permission accidentally — a single misconfig in the matrix would silently break the invariant.
- The userType check alone bypasses the existing RBAC system, which is the right place for this kind of policy long-term.

Doing both means: the userType check is the structural invariant (cannot be misconfigured), the permission row is the long-term policy expression that admins manage.

### D3 — Manjari's `role` field: keep it on the standard enum

Spec calls her a "junior-coder" but our `UserRole` enum is `SUPER_ADMIN | ADMIN | PRODUCT_MANAGER | ENGINEER | CLIENT`. **Don't add a new enum value.** Manjari's `role` is `ENGINEER` so she gets standard engineer permissions inside ManaCalendar; "junior-coder" goes in the new `agentRole` String field (free-text label, no RBAC consequences). Same pattern for future agents — `pm-agent` is `role: PRODUCT_MANAGER, agentRole: 'pm-agent'`.

### D4 — JWT carries `userType`

Current JWT payload is `{ userId, role, tv }`. Add `ut: 'human' | 'agent'` so middleware can answer "is this caller an agent?" without a DB hit. Update `generateAccessToken`, `verifyAccessToken`, the authenticate middleware, and the `req.user` shape.

### D5 — Email + avatar for Manjari

- Email `manjari@exargen.in` is a placeholder; she doesn't need to receive mail. Notification emails (welcome, password-reset, course reminders) should treat agents as "do not deliver." For Slice 1 the email infrastructure isn't sending anyway, so this is a future concern; flag it when we wire SMTP.
- Avatar: initials only. Per spec's "no-deception-by-photo" principle.

---

## Architecture by dimension

### Database

One new migration: `backend/prisma/migrations/20260509000000_agent_users/migration.sql`.

```prisma
enum UserType {
  HUMAN
  AGENT
}

model User {
  // ...existing fields

  // ─── Agent platform ───
  userType                   UserType @default(HUMAN)
  agentRole                  String?  // "junior-coder", "pm-agent", "senior-coder"
  agentSystemPromptPath      String?  // host-side path; informational only
  agentBudgetMonthlyUsdCents Int?
  agentBudgetUsedUsdCents    Int      @default(0)
  agentActive                Boolean  @default(true)
}
```

Plus one new permission row, seeded by `permissionSync` on boot:

```
key:      task.transition.done
label:    Transition tasks to Done
category: Tasks
defaults: granted=true for SUPER_ADMIN, ADMIN, PRODUCT_MANAGER, ENGINEER. granted=false for CLIENT.
```

`permissionSync.service.ts` already idempotently inserts new permissions on every boot, so once the migration lands we don't need a manual seed run on prod.

### Backend

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | Add `UserType` enum + 5 columns to `User`. |
| `backend/prisma/migrations/20260509000000_agent_users/migration.sql` | The migration SQL. |
| `shared/src/constants/permissions.ts` | Add `TASK_TRANSITION_DONE = 'task.transition.done'`. |
| `shared/src/constants/roles.ts` (or wherever `DEFAULT_ROLE_PERMISSIONS` lives) | Grant the new permission to all human roles. |
| `backend/src/services/permissionSync.service.ts` | Add the new permission to `PERMISSION_DEFINITIONS`. Idempotent — runs on boot, no manual step. |
| `backend/src/utils/jwt.ts` | `generateAccessToken` payload gets `ut`; `verifyAccessToken` returns it. |
| `backend/src/middleware/authenticate.ts` | Surface `userType` on `req.user`. |
| `backend/src/services/auth.service.ts:login` | Read `userType`, put it in JWT payload. |
| `backend/src/services/auth.service.ts:getUserProfile` | Return `userType`, `agentRole`, `agentBudget*`, `agentActive` in the `/auth/me` response. |
| `backend/src/services/user.service.ts:createUser` | Accept `userType` + `agentRole` + `agentBudgetMonthlyUsdCents`. Defaults: `userType=HUMAN`, others null. **Skip auto-enrollment in onboarding course if `userType === 'agent'`**. Force `onboardingRequired=false` for agents. Super-admin-only when `userType=AGENT`. |
| `backend/src/services/user.service.ts:updateUser` | Allow agent fields to be updated **only when caller is `SUPER_ADMIN`**. Mirror the existing super-admin-armor pattern. |
| `backend/src/services/task.service.ts:moveTask` and `updateTask` | If `newStatus === DONE` and caller's `userType === 'agent'`, throw `ForbiddenError(...)`. Permission check (D2 layer 1) in addition. |
| `backend/src/handlers/user.handler.ts` | Pass new fields through. |
| `backend/src/seed/agentUsers.seed.ts` | **New.** Idempotent seed that creates Manjari if absent: `name='Manjari'`, `email='manjari@exargen.in'`, `role=ENGINEER`, `userType=AGENT`, `agentRole='junior-coder'`, `onboardingRequired=false`, password from env (`MANJARI_PASSWORD`, never in source). Project assignment to ManaCalendar via slug; if project doesn't exist, log+skip rather than fail. Wired into `seed/index.ts` after permissions, before regular users. |
| `backend/src/handlers/agent.handler.ts` | **New, small.** `POST /api/v1/agents/me/budget-increment` body `{ usdCents: number }`, validates non-negative, increments `agentBudgetUsedUsdCents`, writes activity row. Used by the runtime to record API cost per task. |
| `backend/src/routes/agent.routes.ts` | **New.** Mounts the budget-increment endpoint. Authenticated, requires `userType==='agent'`. |
| `backend/src/index.ts` | Mount the new route. |

**Activity logging stays unchanged** — every existing `logActivity({ userId, ... })` works for Manjari because she's a regular User row. No special-casing.

**Refresh tokens stay unchanged** — Manjari uses the existing `RefreshToken` rotation system.

**Onboarding course is naturally bypassed** — `OnboardingGate` is already a passthrough, and we set `onboardingRequired=false` for agents at creation, so `/confidentiality` shows the empty state for them.

### Frontend (UI)

The spec puts agent UI surfaces in Slice 3 (post-reveal). For Slice 1 we add only what Super Admin needs to manage agents from the existing user-management page. Other admins/PMs/engineers see Manjari as an ordinary user (ghost-in-team mode).

| File | Change |
|---|---|
| `frontend/src/api/users.ts` | Add `userType`, `agentRole`, `agentBudgetMonthlyUsdCents`, `agentActive` to the User type and create/update payloads. |
| `frontend/src/pages/admin/UserManagementPage.tsx` | **AddUserModal**: new "Agent Configuration" section, **collapsed by default**, visible only when `currentUser.role === 'SUPER_ADMIN'`. Toggle: `User type: Human / Agent`. When Agent: reveal `Agent role` text input, `Monthly budget (USD)` number input, `Active` checkbox. Default closed → form behaves exactly as today for non-super-admins. |
| Same file | **EditUserModal**: same agent section, same gating. |
| Same file | **List filter**: `Show: All / Humans / Agents` segmented control, super-admin only. List rows render a tiny "AGENT" pill next to the name when `user.userType === 'agent'`, super-admin only. Other admins see Manjari as a regular Engineer. |
| `frontend/src/components/onboarding/OnboardingGate.tsx` | No change — already a passthrough after PR #61. |
| `frontend/src/pages/onboarding/MyConfidentialityPage.tsx` | No change — its "no enrollments → empty state" path covers agents naturally. |
| `frontend/src/lib/constants.ts` (sidebar) | No change in Slice 1. Agent-related nav lands in Slice 3. |

Roughly 80–120 lines of TSX + 10 lines of API typing.

### `cc` CLI (out of repo, but defines what we expose)

The CLI ships from a separate workstream. Endpoints it'll consume:

| `cc` command | HTTP | Status |
|---|---|---|
| `cc inbox` | `GET /api/v1/users/me/tasks` | ✅ exists |
| `cc task pick <id>` | `POST /api/v1/tasks/:id/transition` (status=in_progress) | ✅ exists |
| `cc task comment <id> <text>` | `POST /api/v1/tasks/:id/comments` | ✅ exists |
| `cc task transition <id> <status>` | same `/transition` endpoint | ✅ exists; agents blocked from `done` per D2 |
| `cc activity log` | `POST /api/v1/activity` | ✅ exists |
| `cc agent budget increment <usd-cents>` | `POST /api/v1/agents/me/budget-increment` | ✅ added in Slice 1 |
| `cc kp fetch <slug>` | `GET /api/v1/agents/me/knowledge-pack/:slug` | ❌ Slice 2 |

### Out-of-repo workstreams (sketched)

- **Container image** (`exargen/manjari-runtime:v1`) — Ubuntu 24.04, rootless Podman, uid 1000, Node 20, gh, git, `cc` binary, Claude Agent SDK.
- **Host runtime** (~30 lines of bash) — polls `cc inbox`, spawns container per task.
- **`cc` CLI** (single Node binary, ~6 commands).
- **Agent context files** (`~/exargen/manjari/PRIME_DIRECTIVE.md`, `CLAUDE.md`, `skills/...`, plus universal skills at `~/.claude/skills/`).

Only when these four exist + Slice 1 is merged + Manjari is seeded does the first task actually execute. We can build Slice 1 in parallel.

---

## Slice 1 — concrete task list, ordered

Roughly 8 commits in one PR.

1. **Schema + migration.** `User.userType` enum + 5 columns + `UserType` enum + migration SQL. Verify `prisma migrate deploy` on a fresh Postgres + on a Postgres with existing users (column defaults handle the backfill).
2. **Permission.** Add `task.transition.done` to constants, definitions, and `DEFAULT_ROLE_PERMISSIONS`. Confirm `permissionSync` picks it up on boot.
3. **JWT payload.** Add `ut` claim through `generateAccessToken`, `verifyAccessToken`, the authenticate middleware, and `req.user`.
4. **`/auth/me` response.** Surface `userType`, `agentRole`, `agentBudget*`, `agentActive`.
5. **`createUser` + `updateUser`.** Accept agent fields, super-admin-gated mutation when `userType=AGENT`, skip auto-enrollment for agents, force `onboardingRequired=false`.
6. **Done-gate.** userType check + permission check at both `moveTask` and `updateTask`. Friendly 403 message.
7. **Frontend.** AddUserModal + EditUserModal agent section (super-admin only), list filter, AGENT pill in list rows.
8. **Seed Manjari.** Idempotent seed file, password from `MANJARI_PASSWORD` env var, project membership in ManaCalendar (skip if project missing).
9. **Tests.**
   - Unit: a User row with `userType='agent'` round-trips through Prisma.
   - Service: Manjari can authenticate, fetch tasks, comment, log activity. Cannot transition to DONE — gets 403 with the right message.
   - Service: human Engineer can transition to DONE.
   - Service: super-admin can edit agent fields; non-super-admin cannot.
   - Service: creating an agent skips auto-enrollment in the mandatory course.
10. **`POST /api/v1/agents/me/budget-increment`.** Tiny endpoint, +30 LoC, lets the runtime record API cost per task.

Verification: `prisma validate`, `backend tsc`, `frontend tsc` all 0 errors. End-to-end against a Docker Postgres (same pattern used for the onboarding course feature).

## Acceptance criteria (from spec, mapped)

- [ ] User model has the new fields with safe defaults
- [ ] Migration runs cleanly on existing data
- [ ] All existing tests still pass
- [ ] New unit test: a User with `userType='agent'` can be created
- [ ] New integration test: Manjari can authenticate, fetch her empty inbox, and is blocked from `POST /api/tasks/:id/transition` with `status=done`
- [ ] Super Admin can toggle userType in UI; other roles cannot
- [ ] Lint, type-check, build all pass
- [ ] One PR, clean diff
- [ ] Onboarding course is bypassed for agents

---

## Slice 2 (sketch, NOT now)

`GET /api/v1/agents/me/knowledge-pack/:projectSlug` returns:

```json
{
  "project": { "id", "slug", "name", "phase", "healthStatus" },
  "skills": [ { "name", "description" } ],
  "recentActivity": [ /* last 30d, summarized */ ],
  "currentSprintTasks": [ /* in-flight tasks */ ],
  "decisions": [ /* recent decisions log entries */ ]
}
```

This makes skill loading Command-Center-driven (vs purely filesystem-driven). Probably ~150 LoC service + handler + tests.

## Slice 3 (sketch, post-reveal)

- `/agents` Roster page (filtered Team page)
- `/agents/:id` Detail page (current task, recent PRs, budget meter, capability profile, knowledge pack contents)
- `/agents/:id/logs` Logs view
- `/agent-roles` Role Templates page

---

## Risks & gotchas

1. **Auto-enrollment runs on user create.** If we create Manjari and later flip her `userType` to `human`, she won't auto-enroll. For Slice 1 not a real risk; worth a comment in `createUser`.
2. **Existing users have `userType='HUMAN'` after migration.** Default at the column level handles this — no backfill needed.
3. **`TaskStatusHistory` audit trail** records `changedBy`. When Manjari moves a task, the audit shows her — that's desired. Confirm no UI assumes humans-only when rendering the audit trail.
4. **`req.user` typing.** Adding `userType` to the auth middleware's user shape means updating the TS declaration and every `req.user` consumer's expectations. tsc will surface them.
5. **Email uniqueness.** `manjari@exargen.in` must be unique like any user. The seed must `findUnique` first, only insert if absent — never error if she already exists.
6. **CORS / rate-limiter.** Manjari's container hits the API from a different origin/IP. The existing rate-limiter is per-IP → may bite agents that burst (~50 requests in 10 minutes during a single task). Worth a slightly higher cap for tokens with `ut === 'agent'`. Add as a small follow-up if not in Slice 1.
7. **Compliance / onboarding stat queries.** Filter agents out of admin dashboards so they don't dilute the human team's "% completed" metric.
8. **GitHub identity.** Outside this repo's scope — when Manjari pushes commits, git config in the container needs `user.email = manjari@exargen.in` so commits are attributed to her CC user (lets PR-auto-link work).
9. **`agentBudgetUsedUsdCents` overflow.** Int (Postgres `INTEGER`, max ~2.1B = $21M). Plenty for any realistic budget; if we ever care about higher, switch to BigInt. Not a concern in Slice 1.

---

## Sequencing

1. **PR A (this one):** docs only. The spec + this implementation plan. Quick to merge so the docs are reviewable + version-controlled before code lands. Lives at `docs/agent-platform/`.
2. **PR B:** Slice 1 implementation, following the 10-step list above. ~1.5–2 days of focused work including tests + DB smoke against a clean Postgres.
3. **In parallel (separate repos):** the `cc` CLI, the Podman container, the host runtime, Manjari's context files. The Command Center side is the smallest piece of the overall platform; the agent-side context (CLAUDE.md, skills) is where most of the leverage is per the spec.
4. **Day of first task:** one well-scoped ManaCalendar task, assigned to Manjari, watched live. If it produces a passable PR we have v1; if not, iterate on context not capability.
