# Client Access — Consolidation Follow-up (✅ DONE)

> **Status:** ✅ **Executed** in PR #195 (same branch as the per-project work).
> **What was done:** the global `User.extendedClientAccess` flag was retired
> and its column dropped; client full access is now exclusively per-project
> via `ProjectMember.fullAccess`. There is **one** mechanism and **one**
> admin surface (Project → Settings → "Client full access"), and clients
> **always** use the portal (no more routing flip).
> **This doc is kept as the record** of why the consolidation was needed and
> exactly what changed; the checklist below is now a "what we did" log.

---

## TL;DR

We now have **two** ways to give a client extra visibility, and they
disagree on where the client lands:

| Mechanism | Scope | Where the client works | Admin UI |
|---|---|---|---|
| **OLD** — `User.extendedClientAccess` (PR #187) | ALL the client's projects | the **internal team UI** (`/projects`) | checkbox in **Edit User** modal |
| **NEW** — `ProjectMember.fullAccess` (PR #195) | ONE project | the **client portal** (`/client/...`) | toggle in **Project → Settings** |

Same intent ("client sees the full internal picture"), **two destinations
and two switches.** A SUPER_ADMIN granting via the old checkbox gets a
different experience than granting via the new toggle. That inconsistency
is the thing to fix.

## What is solid right now (do NOT redo)

PR #195 already:
- Added the per-project `ProjectMember.fullAccess` grant (the intended
  mechanism — SUPER_ADMIN-only, client stays in portal, scoped to one
  project).
- **Fixed the real bug** the audit found: `listTasks`/`getTask` gated on
  the *role* and silently ignored the per-user grant, so the old global
  flag never actually revealed internal tasks. Both mechanisms now route
  through `rbac.service.canViewProjectInternal(user, projectId)`.
- **Backfilled** existing global-flag clients into per-project grants (the
  `20260602120000_project_member_full_access` migration sets
  `ProjectMember.fullAccess = true` for every project a flagged CLIENT is
  a member of). **So the data is already migrated — retiring the flag will
  not strip access from anyone who has it today.**

> Net: the client experience **works today**. This follow-up is about
> removing the *redundant, inconsistent* second mechanism — not about
> making client access function.

## The decision

**Retire the global flag entirely and drop the column.** After that there
is exactly one model: per-project `fullAccess`, client always in the
portal, one admin surface (Project → Settings).

## Execution checklist (every surface, already mapped)

### Backend
- [x] `rbac.service.checkPermissionForUser` — remove the
      `EXTENDED_CLIENT_ADDITIONAL_PERMISSIONS` per-user branch; it becomes a
      thin `return checkPermission(user.role, key)` (keep the wrapper — it's
      used by `authorize`/`authorizeAny`, which are 100%-coverage-locked).
- [x] `rbac.service.canViewProjectInternal` — remove the
      `user.extendedClientAccess === true` legacy branch (keep role +
      per-project membership).
- [x] `auth.service` (`getMe`) — delete the block that unions
      `EXTENDED_CLIENT_ADDITIONAL_PERMISSIONS` into `/auth/me` permissions +
      the import.
- [x] `today.service.computeVisibility` — drop the `extendedClientAccess`
      param; gate `canViewInternal`/`canViewDecisions` on
      `canViewProjectInternal(user, projectId)` when the feed is scoped to a
      project (the client portal Activity page passes `projectId`), role-
      level otherwise. Update `getActivityFeed` + `today.handler` to pass the
      user id + projectId instead of `extendedClientAccess`.
- [x] Drop `extendedClientAccess` from the `listTasks` / `getTask` /
      `listProjectComments` viewer types and from the `task` / `comment` /
      `today` handlers.
- [x] `user.service.updateUser` — remove the `extendedClientAccess` SUPER_
      ADMIN armor block; remove `extendedClientAccess` from the `listUsers`
      `select`.
- [x] `user.schema` — remove the `extendedClientAccess` validator field.

### Shared
- [x] `shared/src/constants/roles.ts` — delete
      `EXTENDED_CLIENT_ADDITIONAL_PERMISSIONS`; remove its re-export from
      `shared/src/constants/index.ts`.
- [x] `shared/src/types/user.ts` — remove `extendedClientAccess` from the
      `User` + `UpdateUser` types (and the doc comments).

### Frontend
- [x] `lib/constants.ts` — delete `isExtendedClient` and every routing
      branch that uses it (`getDefaultRoute`, `getProjectWorkspaceRoute`,
      task/detail route helpers). CLIENT always routes to `/client/...`.
- [x] `pages/admin/UserManagementPage.tsx` — remove the
      `extendedClientAccess` checkbox + the form field (lines ~606, 631,
      700–701 at time of writing).
- [x] `components/activity/ActivityFeedView.tsx` — remove the
      `isExtendedClient` branch (treat CLIENT uniformly).
- [x] `App.tsx` — clean the comments / any route that lets an extended
      client render the internal TodayPage.

### Schema
- [x] `schema.prisma` — remove `User.extendedClientAccess`.
- [x] New migration: `ALTER TABLE "users" DROP COLUMN "extendedClientAccess";`
      (the per-project backfill already ran, so no data is lost).

### Tests
- [x] Update everything referencing the removed surfaces: `rbac.service`,
      `auth.service` (`getMe`), `today.service`, `user.service`,
      `comment.service`, and any frontend tests touching the checkbox /
      routing. Re-pin coverage where it shifts.

## Risk notes
- **Behavior change for any current global-flag client:** they move from the
  internal team UI to the client portal. That is the *intended* end state
  ("client stays in portal"), and their data access is preserved via the
  backfilled per-project grants — but it is a visible UX change, so worth a
  heads-up to whoever manages those clients before shipping.
- **Cross-project activity feed:** the only non-mechanical step. Today the
  feed treats a global-flag client as internal everywhere; after retire it
  must check `fullAccess` per the feed's `projectId`. The client portal
  Activity page is already per-project (`GET /today?projectId=`), so this is
  tractable.
- Do this as its **own PR** for a clean, reviewable diff — it touches auth,
  rbac, routing, and the schema.

## Pointers
- New mechanism: `backend/src/services/rbac.service.ts` →
  `canViewProjectInternal`; `ProjectMember.fullAccess`.
- Admin UI: `frontend/src/components/projects/ClientAccessPanel.tsx`
  (Project → Settings).
- Original audit that surfaced the bug: see the conversation that produced
  PR #195.
