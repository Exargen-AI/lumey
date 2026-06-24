# Baseline (2026-05-21)

This document declares the test + quality baseline for the Exargen Command
Center as of `main @ 24d4ada`. Anything **below** these numbers should fail
CI; anything **above** can move the baseline up. The bar can only go up.

## Test pyramid

| Tier | Count | Runtime | What it pins |
|------|------:|--------:|--------------|
| **Unit (mocked DB)** | 579 tests across 24 files | ~3.7s | Service logic, validators, middleware, helpers. Every change to `src/services/`, `src/utils/`, `src/validators/`, `src/middleware/` must add or update tests here. |
| **Integration (supertest + mocked DB)** | 19 tests in `ccFeatures.integration.test.ts` | ~50ms | Full Express stack (router → validator → handler → service → notify) for the 4 CC features. Catches route-wiring + middleware-order bugs. |
| **Integration (real Postgres, port 5433)** | 7 tests across 3 files | ~25s in CI | SQL constraint behavior, cascade deletes, unique-index case-sensitivity, migration correctness, real timestamp arithmetic. The class of bugs `prismaMock` cannot detect. |
| **E2E (Playwright + real backend + real DB)** | 6 smoke specs + 3 CC-feature specs | ~3m in CI | Critical happy paths through the browser + API-level coverage of the 4 CC features over the full stack. |

Total automated assertions on every PR: **~620**.

## Coverage ratchets (vitest.config.ts)

Coverage thresholds are **per-file** and can only go up. The current high-water
marks live in `backend/vitest.config.ts` under `coverage.thresholds`. As of
this baseline:

- 7 files are at **100% lines + statements + functions**, including the
  entire auth + authz spine (`auth.service`, `password`, `authenticate`,
  `authorize`, `authorizeAny`, `requireRoles`, `rbac.service`).
- `task.service.ts` (the largest service, 1454 LOC): **92% lines, 100% functions**.
- `notification.service.ts`: **79% lines, 78% functions** — partial; lower
  bar set so new notify helpers don't regress while older ones remain
  uncovered.
- 7 more files at partial coverage with locked-in ratchets.

Adding tests that move any of these numbers up requires bumping the threshold
in the same PR.

## CI gate (every PR)

PR cannot merge until all 8 checks are green:

1. **ESLint** — 0 errors. Pre-existing warnings are tolerated; new errors block.
2. **Typecheck** — `tsc --noEmit` on both packages, no errors.
3. **Unit + component tests** — full Vitest suite, no skips, coverage thresholds enforced.
4. **Integration tests (real Postgres)** — `*.real.test.ts` suite against a fresh service container.
5. **Build (both packages)** — Vite + TS build must succeed.
6. **Playwright smoke tests** — full-stack E2E against real DB.
7. **npm audit (production deps)** — no high/critical vulns in `dependencies` (devDeps tolerated).
8. **Vercel preview deploy** — must complete (catches deploy-time bugs the build job misses).

## Migration discipline

- Every PR that ships a Prisma schema change must include a migration in `backend/prisma/migrations/`.
- Migrations are validated by the **integration-real-db** CI job — a migration that fails to apply against an empty Postgres fails CI.
- Destructive migrations (DROP, NOT NULL on existing column, type narrowing) MUST be paired with a data backfill step in the same migration file.
- The migration name MUST match the format `YYYYMMDDHHmmss_snake_case_summary`.

## Security baseline

- Auth: bcrypt with cost factor 12; JWT HS256 with 32+ char secrets; 15m access / 7d refresh.
- Lockout: 5 wrong attempts → 15min lock; counter resets on expiry (PR #134).
- Email normalization: lowercased at validator + service boundary; canonical in DB via migration `20260521000000_lowercase_user_emails` (PR #134).
- Rate limiting: per-IP, 200/15min for `/auth/login` in prod, 30/15min for `/auth/refresh`.
- CORS: `httpOnly` + `secure` (prod) + `sameSite: none` (prod) / `lax` (dev) refresh cookie.
- No raw passwords or tokens in logs; userAgent and IP truncated to 500 / 64 chars.

## Extending the baseline

When you add a feature, the testing expectation is:

- **All new logic in `services/` or `utils/` → unit tests at >=90% lines.**
- **Any new DB interaction that wasn't possible before → at least one `*.real.test.ts`.**
- **Any new HTTP endpoint → at least one supertest integration test.**
- **Any new user-visible feature → at least one Playwright smoke test (UI or API-level).**
- **Any new migration → must apply cleanly against the real-DB CI job.**

To move the baseline up:

1. Land tests that raise per-file coverage.
2. Bump the threshold in `backend/vitest.config.ts` in the same PR.
3. Update this doc's count line in the test-pyramid table.

## How to run locally

```bash
# Unit (no DB needed)
npm run test --workspace=backend
npm run test --workspace=frontend

# Real-DB integration (needs Docker)
docker compose -f docker-compose.test.yml up -d
npm run test:real-db --workspace=backend

# Playwright (needs backend + frontend running)
npm run dev:backend &
npm run dev:frontend &
npx playwright test --config=frontend/playwright.config.ts

# Full local CI-equivalent
npm run lint && \
  npx tsc --noEmit && \
  npm run test --workspace=backend && \
  npm run test --workspace=frontend && \
  npm run build
```

## Roadmap items NOT covered by this baseline

These are known gaps. Adding coverage for any is a candidate next PR:

- **`comment.service` list / read paths** — partial coverage (66%); visibility filters live there and need real-DB integration tests.
- **`project.service` create / update / delete** — only membership ops covered (48% lines).
- **`sprint.service` burndown / backlog math** — read-heavy; deferred to real-DB.
- **`timesheet.service` bulkLogTime + read endpoints** — deferred to real-DB.
- **Notification preferences (mute by type)** — feature not yet built; will land with its own coverage when it ships.
- **Optimistic locking on Milestone / Sprint / Project / Comment** — pattern proven on Task; copy + tests pending.

— Pankaj + Claude, 2026-05-21
