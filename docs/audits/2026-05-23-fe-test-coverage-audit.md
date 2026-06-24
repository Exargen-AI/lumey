# FE Test Coverage Audit — 2026-05-23

**Context:** Pankaj asked, after PR #147 shipped a UX fix without a test:
> "Why are bugs creeping in after the baseline?"

This audit documents the gap, names the pattern, and proposes a path forward.

---

## 1. The Numbers

| Layer | Files | Tests | Health |
|---|---|---|---|
| Backend services | 16 | ~640 | ✅ Solid |
| Backend middleware | 4 | ~30 | ✅ Solid |
| Backend integration (real HTTP stack, mocked Prisma) | 1 | ~30 | 🟡 Covers CC features only |
| Backend real-DB tests | 4 | ~30 | 🟡 Sparse but high-value |
| **FE unit / component / hook** | **6** | **54** | ❌ **Almost nothing** (post-PR #147) |
| E2E Playwright | 2 | ~15 | 🟡 Smoke + CC features only |

The FE has **vitest + jest-dom + react-testing-library all wired up and ready**
(see `frontend/vitest.config.ts` Phase 0 comment), but only six tests use the
runner. The infrastructure isn't the bottleneck; the habit is.

---

## 2. The pattern of bugs slipping through

Reviewing recent merged PRs:

| PR | Bug it shipped | Caught by | Could have been caught by |
|---|---|---|---|
| #143 | Dense rows overflowed narrow columns | User report | A snapshot or width-driven FE component test |
| #144 | Enrollments stuck in_progress (quiz-last bug) | User report | A backend integration test for `submitQuizAttempt` + completion gate |
| #146 | (No bugs — but no FE tests either) | — | — |
| **#147** | **Kanban silent rollback on move failure** | **User report** | **The two tests I just added in this PR** |

**The pattern:** every regression hits the FE interaction layer. Every regression
ships because:
1. Backend tests pass — they don't render anything.
2. FE has no tests of the mutating surfaces (kanban, task detail, modals).
3. E2E smoke tests render pages but don't exercise click→mutation→rollback flows.
4. Users find the bug in production.

**What this audit changes nothing about:** backend regressions are well-caught.
The 647-test backend suite is doing its job. The hole is one layer up.

---

## 3. Why the silent-rollback in PR #147 was un-catchable

Concretely, the bug was: `useMoveTask`'s `onError` rolled back the optimistic
update but emitted no user signal. The kanban's `handleDragEnd` called
`moveTask.mutate(...)` (fire-and-forget), so even if it wanted to surface the
error, it had nowhere to catch it.

The only way to catch this in tests would have been:

1. A unit test for `useMoveTask` that asserts `mutateAsync` rejects on server
   error → catches that the contract exists. **Did not exist.** (Now does:
   `frontend/src/hooks/useTasks.test.ts`.)
2. A component test that renders `KanbanBoard` with a mock that rejects on
   move → asserts a toast appears. **Did not exist.** (Component-test
   harness for KanbanBoard is still missing — see Phase 2 below.)
3. An E2E test that drags a card with unchecked AC to Done → asserts the
   toast. **Did not exist.** (Could add but slow + brittle.)

PR #147 ships #1 (the hook contract test) and the underlying error extractor
test (`apiErrorMessage.test.ts`). #2 and #3 are recommended next steps below.

---

## 4. What this PR locks down

Two new test files, 15 new tests:

### `frontend/src/lib/apiErrorMessage.test.ts` — 11 tests
The pure extractor that turns a thrown axios/Error/object into a user-facing
string. **Critical because every mutation's `onError` toast depends on it.**
If this function drifts, every consumer drifts silently. Tests cover:

- Axios `error.message` shape (the common case)
- Legacy `data.message` shape
- Plain `Error` (network failures)
- Plain object thrown with `.message`
- Null / undefined / empty shapes → fallback
- Caller-supplied fallback
- Empty / non-string contract drift defense
- Two verbatim backend messages (illegal transition, agent-Done-gate) for
  regression protection if backend messages change.

### `frontend/src/hooks/useTasks.test.ts` — 4 tests
The contract PR #147 relies on:

- `mutateAsync` REJECTS on server error (axios shape) → caller's catch fires.
- `mutateAsync` REJECTS on network error (Error subclass) → caller's catch fires.
- Optimistic-cache patch is ROLLED BACK on rejection → card returns to source.
- `mutateAsync` RESOLVES on success → no false positives.

If react-query's behavior changes (retries swallowing rejections, throwOnError
behavior, mutation API drift), at least one of these will fail loudly.

---

## 5. Recommended next steps (NOT in this PR)

These are the gaps the audit surfaces. None are in PR #147; each is its own
focused PR.

### Phase 2 (next): component-level test for KanbanBoard
A vitest + React Testing Library test that:
1. Mounts `KanbanBoard` with a mock QueryClient + mock `useTasks` data.
2. Mocks `taskApi.moveTask` to reject.
3. Programmatically fires a `dragEnd` event with the right shape.
4. Asserts the toast `Move failed: <message>` appears.

Effort: ~2 hours. Catches: the exact bug from PR #147, plus any future
move-rejection regression.

### Phase 3: E2E Playwright "drag fails visibly" test
One Playwright test, logged in as an engineer, creates a task with an
unchecked AC, drags it to Done, asserts the toast.

Effort: ~3 hours including seed-data scaffolding. Catches: regressions
across the FULL stack (FE + BE + DB).

### Phase 4: coverage thresholds
`vitest.config.ts` currently has `thresholds: { lines: 0, ... }` — coverage
is reported but not enforced. Raise per-file:
- `lib/apiErrorMessage.ts` → 100%
- `hooks/useTasks.ts` → 80%
- `components/kanban/KanbanBoard.tsx` → 60% (it's complex; partial coverage is fine)

This creates a ratchet: coverage cannot drop below a known-good baseline.

### Phase 5: a "did you ship a test?" PR check
A CI check that warns when a PR touches `src/components/**` or `src/hooks/**`
WITHOUT touching any `*.test.{ts,tsx}` file. Not a hard block (sometimes a
refactor genuinely needs no new tests), but a visible nudge in the PR template
that you're shipping behavior changes without verification.

---

## 6. The honest summary

The backend has been over-engineered for testing (647 tests across services,
middleware, real-DB, integration). The frontend has been treated as
"smoke-test it via Playwright and hope." That's the gap. The frontend now
has 15 new tests pinning the specific contract that broke. The gap isn't
closed — it's narrowed by the surface area of PR #147.

If we want to stop shipping FE interaction bugs, we need:
1. Component-level tests for the mutating surfaces (kanban, task detail, modals).
2. A coverage ratchet so the gap can't grow.
3. A reviewer habit: "you changed a hook / interaction — where's the test?"

PR #147 demonstrates the pattern. The next PRs need to follow it.
