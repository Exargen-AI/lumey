# Enterprise Hardening Audit — 2026-06-01

> **Scope:** A god-level, enterprise-grade audit of the entire Command Center
> application — logging/observability, security (leaked secrets, auth,
> exposure), front-end ↔ back-end wiring gaps, dead code, and operational
> readiness — followed by a fix-everything hardening pass ahead of bringing
> autonomous agents into the platform.
>
> **Branch:** `chore/enterprise-hardening`
> **Method:** four parallel deep-dives (logging, security, FE↔BE/dead-code,
> bugs/enterprise-readiness) synthesized into a single prioritized report,
> then remediated in five reviewable commits.

---

## Executive summary

Going in, the codebase was already in good shape from the multi-phase
baseline-hardening campaign (helmet + HSTS + CSP, CORS fail-closed,
parameterized SQL, tokenVersion revocation, per-account lockout, hashed
device API keys, in-memory access tokens, `.env` gitignored). The audit
**confirmed no leaked secrets or credentials** anywhere in the tree (only
`*.env.example` files are committed).

The gaps were concentrated in **observability** and **operational
readiness** — the things that matter most the moment autonomous agents
start acting on the system and you need a forensic trail and graceful
failure modes.

**Pre-hardening score: ~7.5/10.** This pass closes every CRITICAL and HIGH
finding and most MEDIUMs; the one deferred item (enrollment-token hashing)
is carved into its own PR because it touches the agent-critical enrollment
flow and shouldn't be rushed.

---

## Findings & disposition

Legend: ✅ fixed in this pass · 🟡 deferred (own PR) · 🔵 verified-clean (no action)

### CRITICAL

| # | Finding | Disposition |
|---|---------|-------------|
| C1 | **Security events left zero forensic trace.** Failed logins, account lockouts, authz denials, rate-limit trips, and refresh-token reuse were silent — a brute-force or scraping run left nothing to investigate. | ✅ Structured `securityLogger` channel now records `login_failed`, `account_locked`, `login_success`, `token_reuse_detected`, `authz_denied`, and `rate_limited` with actor/IP/path context. |

### HIGH

| # | Finding | Disposition |
|---|---------|-------------|
| H1 | **No structured logging.** `morgan` text logs + scattered `console.*` — not machine-parseable, no request correlation, no secret redaction. | ✅ Replaced with `pino` + `pino-http`: JSON logs, `x-request-id` correlation, automatic redaction of `authorization`/`cookie`/tokens/secrets. All `console.*` in services/middleware/handlers migrated to the logger. |
| H2 | **Graceful shutdown dropped in-flight requests.** SIGTERM tore the process down without draining. | ✅ `server.close()` drain with a 10s timeout before `prisma.$disconnect()`, guarded against double-shutdown. |
| H3 | **No process-level safety net.** An unhandled rejection or uncaught exception could leave the process in a half-dead state. | ✅ `unhandledRejection` (log, keep alive) + `uncaughtException` (log fatal, graceful shutdown, exit 1) handlers. |
| H4 | **Unbounded `findMany` queries (DoS/OOM).** Several list endpoints materialized whole tables + relations into memory. The worst — the Pulse overview — pulled **every device health snapshot ever recorded** (hourly × fleet × forever) just to reduce to latest-per-device. | ✅ Pulse overview rewritten with Prisma `distinct: ['deviceId']` (DB-side latest-per-device; behaviour-preserving). Public CMS taxonomy scan capped to the most-recent 5000 posts. Org-growth lists (projects, users, deliverables, epics, courses, comments) given conservative `take` ceilings via `constants/listLimits` — array shapes unchanged, zero FE impact. |
| H5 | **No coverage floor.** Global thresholds sat at 0, so a catastrophic coverage collapse wouldn't fail CI. | ✅ Global floor lifted to lines 25 / branches 75 / funcs 45 (a few points below measured) + per-file locks for the entire Pulse scoring spine and the device-auth middleware. |

### MEDIUM

| # | Finding | Disposition |
|---|---------|-------------|
| M1 | No `/ready` liveness/readiness probe. | ✅ `GET /api/v1/ready` runs `SELECT 1`, returns 503 on DB failure; `/health` + `/ready` excluded from request logging. |
| M2 | JWT verify didn't pin the algorithm (latent RS/HS confusion risk if an asymmetric key is ever added). | ✅ `HS256` pinned on both sign and verify. |
| M3 | No per-device telemetry rate limit — one compromised/buggy agent could flood ingest. | ✅ `deviceTelemetryLimiter` keyed on `req.device.id` (120/5min prod) on heartbeat + snapshot. |
| M4 | No CI secret scanning. | ✅ `gitleaks` job scans the diff (and full history on push to main). |
| M5 | `npm audit` moderates in production deps. | ✅ `npm audit fix` (express bump); production audit now reports **0 vulnerabilities**. |
| M6 | No front-end error reporting. | ✅ Env-gated, dependency-free, Sentry-ready reporter (`lib/errorReporter.ts`) wired into the ErrorBoundary, global handlers, and the API client. No-op without `VITE_ERROR_REPORTING_DSN`. |
| M7 | Enrollment tokens stored in cleartext at rest. | 🟡 **Deferred** to its own PR — touches the agent-critical enrollment flow + admin UI (schema `tokenHash` + migration backfill + show-once API + show-once modal). |

### LOW

| # | Finding | Disposition |
|---|---------|-------------|
| L1 | Dead component `ClientSectionPlaceholder.tsx` (zero imports). | ✅ Removed. |
| L2 | Dead "Soon" pill plumbing in `ClientSidebar` (no section used it). | ✅ Removed (plus a stale `useParams` import). |
| L3 | Orphan endpoint `POST /rbac/check` (no caller). | ✅ Removed route + handler + schema (core `rbacService.checkPermission` retained). |
| L4 | Orphan vertical `GET /projects/:id/time-report` (FE fn had no callers). | ✅ Removed the FE api fn, route, handler, service fn, and schema. |

### Verified-clean (no action needed) 🔵

- **No leaked secrets / API keys / connection strings** anywhere in the tree.
- `.env` gitignored; only `*.env.example` committed.
- Access tokens in-memory (not `localStorage`); refresh token in an httpOnly cookie.
- Device API keys hashed at rest; auth via constant-time compare.
- `helmet` + HSTS + CSP; CORS fail-closed; SQL parameterized via Prisma.
- `tokenVersion` invalidation on logout-everywhere / password-change / role-change.

---

## What shipped (this branch)

| Commit | Summary |
|--------|---------|
| `89aec72` | Structured logging (pino) + security event logging + ops hardening (shutdown, process handlers, `/ready`). |
| `4b701b0` | JWT alg pinning, per-device telemetry limiter, gitleaks CI job, coverage floor + scoring/device-auth per-file locks, npm audit fix. |
| `f71991e` | Bound unbounded list queries against DoS/OOM (`distinct` + `take` ceilings). |
| `1736bd6` | Env-gated, Sentry-ready frontend error reporter. |
| `65461f7` | Remove dead code (placeholder, Soon pill, `/rbac/check`, time-report orphan). |

---

## Verification

All checks green at the close of this pass:

- **Backend unit + component:** 1358 tests pass; coverage gate (global floor
  + all per-file locks) green.
- **Frontend unit + component:** 137 tests pass (incl. 9 new error-reporter tests).
- **Typecheck:** both packages clean.
- **Lint:** `eslint .` — 0 errors.
- **Build:** both packages build.
- **Production audit:** 0 vulnerabilities.
- **Agent surfaces intact:** agent-visibility, device-auth, Pulse ingest +
  scoring suites all pass — the lockdown filters and enrollment/heartbeat/
  snapshot flows are unaffected by the hardening changes.

---

## Operator notes — new env vars

| Var | Where | Effect when unset |
|-----|-------|-------------------|
| `LOG_LEVEL` | backend | defaults to `info` (prod) / `debug` (dev) |
| `VITE_ERROR_REPORTING_DSN` | frontend | error reporting is a complete no-op (nothing transmitted) |
| `VITE_APP_RELEASE` | frontend | reported errors tagged `release: "unknown"` |

---

## Follow-ups

1. 🟡 **Enrollment-token hashing** — dedicated PR (schema + migration backfill +
   show-once API + show-once modal).
2. Ratchet the global coverage floor upward as more services land tests
   (per-file locks remain the precise guards).
3. When an env-gated error collector is provisioned, set
   `VITE_ERROR_REPORTING_DSN` (or load an `@sentry/react` SDK — the reporter
   delegates to `window.Sentry` automatically).
