# Lumey v2.0 — Codebase Lean-Down Plan

**How we strip Command Center v1.0 to a lean, top-notch agentic core.** This is the
execution plan for the tear-down in `ARCHITECTURE.md` Phase 0, grounded in a
file-path-level audit of the actual v1 backend and frontend.

> Source repo audited: `/Users/preetham/Command center deploy`. The numbers below are
> from reading the real files, not guessing from names.

---

## 1. Goal & principles

- **Cut the Exargen-specific bloat**, keep the agentic spine (identity/RBAC, projects,
  kanban/tasks, comments, notifications, GitHub, the agent control plane, project docs).
- **Lift out islands cleanly; do surgery only where features bleed into the spine.**
- **De-instrument before delete** — remove call sites from kept code first, or the build
  breaks.
- **One squash migration at the end**, not per-model drops.
- **Delete dead code regardless of the feature cut** (quick wins, §4).

---

## 2. Headline — weight coming off

| Layer | Files cut (approx) | LOC cut (approx) |
|---|---|---|
| Backend | ~140 | ~35,000+ |
| Frontend | ~80+ | — |
| Windows agent (root `windows-agent/`) | 16 | ~3,070 |
| Prisma schema | — | **~1,500 of 2,751 lines (>half)** |

More than half the schema and tens of thousands of lines disappear. The surviving core
is the lean spine.

---

## 3. Cut inventory (by feature)

### 3a. Pulse — device/MDM + productivity tracker + clock + scoring (heaviest: ~68 backend files + windows-agent, ~15,500 + ~3,070 LOC)
**Backend:** `routes/pulse*.routes.ts` (+ `pulseScore`, `pulseGithubWebhook`),
`handlers/pulse*.handler.ts` + `clock.handler.ts`, all `services/device*.service.ts`,
`clockSession.service.ts`, `pulseEmployee*.service.ts`, `pulseGithubWebhook.service.ts`,
the **entire `src/scoring/` dir** (compositeScorer, computeForUser, recomputeWorker,
scoreCadences, observability + `scorers/` ×7), `lib/productivityOutbox.ts`,
`lib/standupNormalise.ts`, `middleware/deviceAuthenticate.ts`,
`middleware/requireProductivityScoreAccess.ts`, `validators/pulse.schema.ts`,
`seed/seedUniversalWeights.ts`, `scripts/seed|wipeDevProductivityEvents.ts`.
**Frontend:** `pages/admin/PulsePage.tsx`, `PulseReportsPage.tsx`, `components/pulse/`,
`components/productivity/`, `api/pulse.ts`, `api/pulseScore.ts`.
**Root:** delete the whole `windows-agent/` directory.
**Schema:** all `Device*`, `ClockSession`, `ProductivityEvent`,
`EmployeeProductivityScore`, `UniversalWeightSet`, `EmployeeProfile`,
`GithubWebhookEvent` + ~15 enums + ~9 `User` relations.
> The org-level `/api/v1/webhooks/github/pulse` is **separate** from the kept
> per-project GitHub webhook — don't confuse them.

### 3b. Courses / LMS + Signing + onboarding (~22 backend + ~26 frontend files, ~6,800 LOC) — COUPLED to auth
**Backend:** `course.*`, `enrollment*.*`, `courseAdmin.*`, `onboardingMaintenance.service`,
`seed/onboardingCourse.seed.ts`, the whole `services/signing/` dir, `pdfReceipt.service.ts`.
**Frontend:** `pages/admin/compliance/` (4), `pages/onboarding/`, `components/onboarding/`
(8), `components/security/` (2 — acknowledgment gate), `pages/client/sections/CompliancePage.tsx`,
related hooks/api (`useAdminCompliance`, `useOnboarding`, `courses`, `enrollments`,
`signing`, `clientCompliance`, `projectAcknowledgment`).
**Schema:** `Course`, `CourseModule`, `CourseDocument`, `Quiz`, `QuizQuestion`,
`Enrollment`, `ModuleProgress`, `QuizAttempt`, `DocumentSignature` + enums + `User`
onboarding fields.
> ⚠️ This is the one cut that touches the **auth hot path** — see §6.

### 3c. CMS + Content-Engine + Leads (~15 backend + ~28 frontend files, ~5,700 LOC, isolated)
**Backend:** `cms.routes`, `cmsHandlers`, `cmsService`, `cmsPublic.service`,
`cmsSchema.service`, `seed/cms-demo.ts`, `contentEngine.*`, `providers/aiProvider.ts`
(CMS-only), `lead.*`.
**Frontend:** `pages/CmsPage.tsx` + `pages/cms/` (8), `components/cms/` (7),
`components/editor/` (6 — **verify** not reused by comments/task rich text first),
`pages/admin/LeadDetailPage.tsx`, `data/sampleTemplates.ts`, `lib/cmsTemplates.ts`,
related hooks/api.
**Schema:** `CmsContentProject`, `CmsBlog`, `CmsTemplate`, `CmsMediaAsset`, `Lead`,
`ContentEngineSearch`, `AiAnalysisResult`, `GeneratedBlogDraft` + enums.

### 3d. Timesheets / MyTime (~5 backend + ~11 frontend files, ~1,014 LOC)
**Backend:** `timesheet.routes/handler/service` (+test), `validators/timesheet.schema.ts`.
**Frontend:** `pages/MyTimePage.tsx`, `engineer/TimesheetPage.tsx`,
`admin/TimesheetApprovalPage.tsx`, `admin/ApprovalsPage.tsx`, `hooks/useTimesheet.ts`,
`api/timesheet.ts`, `api/clock.ts`.
**Schema:** `TimesheetWeek`, `TimeEntry`, `TimesheetStatus`.
> ⚠️ `analytics.service.ts` reads `TimeEntry` — de-instrument before dropping (§6).

### 3e. Leave / HR (~4 backend + ~4 frontend files, ~667 LOC, fully isolated)
`leave.routes/handler/service`, `validators/leave.schema.ts`; `pages/LeavesPage.tsx`,
`admin/LeaveApprovalsPage.tsx`, `hooks/useLeaves.ts`, `api/leaves.ts`; `LeaveRequest`
+ enums.

### 3f. DevelopmentOps (~10 backend + ~5 frontend files, ~2,574 LOC) — appears DEAD
`devops.routes/handler` + 6 `devops.*.service.ts`, `validators/devops.schema.ts`;
`components/devops/`, `hooks/useDevOps.ts`. Schema: `Repository`, `RepositoryActivity`,
`LinkedTask`, `Environment`, `Pipeline`, `PipelineRun`, `Deployment`, `Release`.
> No frontend callers, no kept-service importers, no tests — a poll-based CI/repo audit
> module that was never wired into use. **See the judgment call in §7** (it's the one
> the architecture flagged as possible agent-observability fuel).

---

## 4. Dead-code quick wins (do these regardless of the feature cut)

Pure dead code — safe to delete now, independent of any decision:

**Backend**
- `providers/planParser.ts` (753 LOC) — only consumer is `scripts/smoke-smart-parse.ts`;
  the real ingestion path reimplements parsing. Orphaned.
- `scripts/smoke-smart-parse.ts`
- `services/cmsSchema.service.ts` — runtime `CREATE TABLE` shim, redundant with Prisma
  migrations (dies with CMS anyway).
- `services/auditBugs.test.ts` — stale QA-bug regression suite (verify, then prune).

**Frontend**
- `components/productivity/` — orphaned; dashboard uses `components/engineer/StreakHeatmap.tsx`.
- `pages/admin/ActivityFeedPage.tsx` — not routed; `/activity` redirects to `/today`.
- `pages/admin/DashboardPage.tsx` + the `/dashboard/legacy` route — self-labelled "safe
  to remove later"; redundant with `StudioPortfolioPage`.
- `components/onboarding/OnboardingGate.tsx` — a no-op `<Outlet/>` passthrough; unwrap its
  route group.
- `EngTaskCreateForward` + the `/eng/projects/:projectId/tasks/new` forward — vestigial.

---

## 5. Refactor / surgery — shared files that mix kept + cut

These are not deletions; they're edits to **kept** files.

**Backend**
| File | Surgery |
|---|---|
| `services/analytics.service.ts` | Drop the `TimeEntry` weekly-hours block (~line 346). |
| `services/admin.service.ts` | Remove `deleteMany` of `timeEntry`/`timesheetWeek`/`cmsBlog` in seed purge. |
| `services/project.service.ts` | Remove the project-delete `TimeEntry` safety gate. |
| `services/task.service.ts` | Remove `productivityOutbox` import + EXECUTION emit. |
| `services/comment.service.ts` | Remove `productivityOutbox` import + COMMUNICATION/mention emits. |
| `services/dailyUpdate.service.ts` | Remove `productivityOutbox` + `standupNormalise` imports/calls. |
| `services/auth.service.ts` | Remove `pendingMandatoryEnrollments` / `onboardingCompletedAt` logic from `getUserProfile` (auth hot path). |
| `services/user.service.ts` | Remove course/enrollment imports + auto-enroll block in `createUser`. |
| `seed/index.ts` | Remove the unconditional `seedOnboardingCourse()` call. |
| `services/permissionSync.service.ts` + `seed/permissions.seed.ts` | Prune cut permission keys — **but the keys live in the `shared/` workspace package (`@exargen/shared`)**, so prune there too. |

**Frontend**
| File | Surgery |
|---|---|
| `App.tsx` | Remove cut-page imports (16–88) + their `<Route>` blocks; **unwrap** the `OnboardingGate` route group (it wraps ALL authed routes). |
| `lib/constants.ts` | Strip cut entries from `SIDEBAR_NAV`; fix `getDefaultRoute` fallbacks that point at `/cms`/`/activity`/`/my-time`; drop `CMS_PERMISSIONS`/`canAccessSharedCms`. |
| `components/layout/MobileBottomNav.tsx` | Strip cut `moreItems.push(...)` rows. |
| `components/CommandPalette.tsx` | Remove EOD/Timesheet/Leave/Approvals commands. |
| `components/layout/Sidebar.tsx` | Rebrand (drop `/logo.jpeg` + "Exargen"); drop the confidentiality pending-dot. |
| `components/layout/ClientSidebar.tsx` | Drop the `compliance` row. |
| `pages/admin/ProjectDetailPage.tsx` + `pages/pm/ProjectDetailPage.tsx` | Remove the DevOps tab + the security/acknowledgment panels; keep the rest. |
| `stores/authStore.ts` | Strip the `pendingMandatoryEnrollments` slice + `setPendingEnrollments`. |

---

## 6. Coupling map & safe removal order

The cut features are mostly self-contained islands. Three places genuinely bleed into the
spine — handle these **first**, in this order:

1. **Productivity outbox in kept transactions (highest risk).** `comment.service`,
   `task.service`, `dailyUpdate.service` call `emitProductivityEvent(s)` *inside* their
   Prisma transactions. De-instrument all three **before** deleting
   `lib/productivityOutbox.ts` and `src/scoring/`.
2. **`analytics.service` → `TimeEntry`** and **`admin.service` seed purge** → edit before
   dropping those models.
3. **Courses ↔ auth/user/seed (touches every login + every user-create).** Edit
   `auth.service`, `user.service`, `seed/index.ts` and drop the `User` onboarding columns
   before removing courses. **Signing dies with courses** — remove together.
4. **Permission keys in `@exargen/shared`** — prune the shared package, not just backend.
5. **Frontend build coupling** — `App.tsx` static imports + the `OnboardingGate` wrapper +
   `ProjectDetailPage` tab imports + `authStore` slice + nav configs all reference cut code
   by import or path; edit alongside the deletions.

**Recommended sequence:** (1) de-instrument the spine call sites · (2) lift out the
isolated islands (CMS/leads, timesheets, leave, devops, pulse + windows-agent) · (3) do
the courses/auth/user/seed surgery last · (4) prune `shared/` permission keys · (5) drop
schema models + one squash migration · (6) frontend: quick-win dead code → nav/layout
surgery → page/feature deletions → `App.tsx` route cleanup.

---

## 7. Judgment calls for you (decisions needed before we cut)

| # | Call | Recommendation |
|---|---|---|
| J1 | **DevelopmentOps** (CI/repo/deploy). `ARCHITECTURE.md` flagged it as possible *agent-observability* fuel, but the audit found the v1 implementation is **dead** (unused, untested, poll-based). | **Cut the dead v1 code now.** If we want CI/deploy observability in v2, rebuild it lean, fed by the event stream — don't resurrect this. |
| J2 | **`clientCompliance`** (project-scoped "who signed which NDA"). Reads `Course`/`DocumentSignature`. | Cut with courses **unless** you want a slim project-compliance view — then keep a minimal `DocumentSignature` and rebuild the view. Lean default: **cut**. |
| J3 | **Standup / EOD / `recentProgress`** — Exargen daily ritual, or a generic agentic standup worth keeping? | Likely cut the EOD ritual; **keep** a generic recent-progress feed if it's useful for the board. Confirm. |
| J4 | **`components/editor/`** (rich text) — CMS-only, or reused by comments/task descriptions? | **Grep before cutting.** If comments use it, keep; else cut with CMS. |
| J5 | **Client portal scope** — keep `decisions`/`deliverables`/`documents` sections (generic) or trim the portal to the agentic core? | Keep generic sections; cut only `compliance`. |

---

## 8. Definition of done (Phase 0 lean-down)

- Backend builds and the test suite passes with all cut modules removed.
- Frontend builds; no dead routes, no broken nav rows, no 404 fallbacks.
- `schema.prisma` contains only spine + agent-control-plane + project-docs models; one
  squash migration applied.
- `@exargen/shared` permission keys pruned to the kept set.
- No `productivityOutbox` / `TimeEntry` / course references remain in kept services.
- Rebrand done (no "Exargen" strings / logo in the shell).
- Size check: backend down ~35K LOC, schema down >half, ~80+ frontend files gone.
