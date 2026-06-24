# Commit & PR Conventions

> Why: a commit history that future-you (or a code archaeologist after an
> incident) can navigate. Every message should answer **what changed**,
> **why now**, **what was checked**, and **what's deliberately not in this
> change**. No marketing copy. No "fix bug" one-liners.

## Commit message format

```
<type>(<scope>): <one-line summary, imperative, ≤72 chars>

<Detailed body — what changed and why now. Wrap at 80 cols.>

## What was fixed (or what landed)

* Concrete bullet per change, with file paths.
* Include numbers where available — N tests added, K endpoints
  covered, the exact error count that went 0.

## What was checked

* The literal commands and their results.
* Local: `npm run lint` → 0 errors.
* Local: `npx playwright test` → 16/16 passing.
* CI: pending until parent merges (for stacked PRs).

## What's intentionally NOT in this change

| Deferred to | What |
|---|---|
| Phase N | thing 1 |
| Phase M | thing 2 |

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Allowed types

| Type | When to use |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Bug fix users would notice |
| `chore` | Test infra, lint, deps, tooling, CI |
| `refactor` | Code reshape with no behavior change |
| `perf` | Measurable performance improvement |
| `docs` | Docs-only changes |
| `ci` | CI-only changes (workflow YAML) |
| `revert` | Pure revert |

### Scope conventions

Common scopes: `tasks`, `milestones`, `auth`, `rbac`, `client`, `cms`,
`routes`, `test`, `lint`, `e2e`, `db`. Use the most specific that applies.

### Summary line rules

- Imperative mood: "add", "fix", "remove" — not "added", "fixes", "removed".
- Lowercase after the type/scope.
- No trailing period.
- Under 72 characters total.

## PR description format

PRs get the same body as the merge commit, plus a Markdown header and a
test plan checklist. Template:

```markdown
## Summary

One-paragraph hook on what shipped and why. Mention the plan phase
if applicable.

**Verified locally:**
- Concrete numbers from the same commands listed in the commit body.

## What lands

### <Subsection per logical cluster>
- File-level bullets with paths.

## What's intentionally NOT in this PR

| Deferred to | What |
|---|---|

## Test plan

- [x] `npm run typecheck` clean
- [x] `npm run lint` 0 errors
- [x] `npm test` N/N passing
- [x] `npx playwright test` M/M passing
- [ ] CI green on all jobs once parent merges (for stacked PRs)

## The plan

`.gstack/qa-reports/BASELINE_HARDENING_PLAN.md` — Phase X of 10.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Examples

### A good commit (recent real one)

```
chore(lint): Phase 1 — ESLint + Prettier + npm audit gate

Adds static-analysis CI gates from scratch (the repo had zero linting
before), fixes every error that surfaced, and tightens production-dep
security.

## What was fixed

* 27 React Hooks rules-of-hooks violations in CreateTaskPage,
  TaskDetailPage, ProjectIngestPage. Hooks were called after an
  early-return on missing URL params, which means React could see a
  different hook order between renders. Refactored to call hooks
  unconditionally with empty-string fallback; early-return now after
  the hook block.

* 6 unsafe-regex findings reviewed — all anchored, length-bounded
  inputs (slugs ≤50 chars, single markdown lines, fixed-length dates)
  with no nested or ambiguous quantifiers. Disabled per-line with
  justifying comment; Phase 7 security audit revisits.

* 3 high-severity production vulnerabilities resolved by bumping
  bcrypt 5.1.1 → 6.0.0 (drops the @mapbox/node-pre-gyp → tar chain).
  npm audit reports 0 vulns after.

## What was checked

* `npm run lint` → 0 errors, 663 warnings (Phase 1.5 cleanup target)
* `npm run audit:strict` → 0 vulnerabilities
* `npm run typecheck` → clean both packages
* `npm test` → 20/20 unit + component tests still passing
* `npx playwright test` → 16/16 smoke specs still passing
* CI: pending until PR #99 merges (stacked-PR base = Phase 0)

## What's intentionally NOT in this PR

| Deferred to | What |
|---|---|
| 1.1 | `prettier --write .` across tree (huge format diff) |
| 1.5 | Strict TS flags (~400 errors), warning paydown |
| 2 | Service unit tests |

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### A bad commit (don't do this)

```
chore: fix lint
```

No reader gets value from this. What lint? Why? What changed? What
was checked? Re-write it.

## Stacked PRs

When PR B is stacked on PR A (`B`'s base branch is `A`'s feature branch):
- Mention the stack in B's description: "Stacked on PR #A".
- Note that CI won't fire on B until A merges (`pull_request` only
  triggers on PRs to main).
- Verify B's CI gates **locally** before pushing — list the green
  results in the commit body.
- Once A merges, GitHub auto-retargets B to main and CI fires.

## After a commit lands

1. Update `docs/HARDENING_PROGRESS.md` if a phase moved forward.
2. Cross off the corresponding row in the plan's "Definition of done" table.
3. Open the next phase's tracking PR (or pause for review).

## Fix-as-we-test convention (Phase 2 onward)

When a test you're writing surfaces a real bug in the code under test:

1. **Write the failing test first.** Commit it on the same branch, watch
   it fail. The test asserts the *correct* behavior, not the current
   broken behavior.
2. **Land the fix in the same PR.** Don't open a follow-up bug. Don't
   add to a backlog. The test that proved the bug existed should be
   the same test that proves the fix works.
3. **Document both in the commit body** under "What was fixed". A short
   line per bug — what was wrong, what changed, file:line if useful.
4. **One PR = 1–2 services.** Sizing limits keep the diff reviewable
   even when test additions and bug fixes pile up. A 47-service phase
   ships as ~25 small PRs, not one mega-PR.
5. **Ratchet coverage after the PR lands.** Bump the per-file threshold
   in `vitest.config.ts` so the gain can't regress on a future change.

### Categories of bug a service-test typically surfaces

- **Permission leaks** — service returns data the caller's role shouldn't see.
- **Cross-tenant leaks** — service returns data from another project.
- **Off-by-one rollups** — completion percentages drift when story
  points are mixed with task counts.
- **Idempotency violations** — calling the same mutation twice
  produces different state.
- **Stale cache writes** — service mutates a record but doesn't
  invalidate the cache key derived from its old shape.
- **Error swallowing** — `try { ... } catch { return null }` hides
  failures that should surface.
- **N+1 queries** — service runs the same query inside a loop.

### Categories of bug you DON'T fix in the same PR

- **Architectural rewrites.** If the right fix needs a different
  module structure, open a follow-up issue with a repro test and
  scope the original PR to documenting the limitation.
- **Cross-cutting concerns** (e.g. adding `requestId` to every log
  line). Get them their own focused PR.
- **Performance optimizations** that aren't correctness fixes —
  characterize first (Phase 6), tune later.
- **Anything that needs schema change or migration.** Schema diffs
  deserve their own review attention.

## When to break these rules

- **Hotfix commit during an incident.** Ship the fix with a short message
  ("fix: stop 5xx on /api/v1/auth/login — null token"), then follow up
  with a postmortem commit that adds context.
- **Auto-generated commits** (Renovate, Dependabot). Their format is
  fine; don't rewrite.
