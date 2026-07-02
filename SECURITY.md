# Security

Lumey runs autonomous agents that write and execute code and open pull requests.
That makes security a first-class concern, not an afterthought — this document is
the single reference for the security model, the guarantees, and how to report a
problem.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Email
**exargenai@gmail.com** with a description, reproduction steps, and impact. We aim
to acknowledge within 3 business days and to agree a disclosure timeline with you.
Supported branch: `main`.

## Security model

### Authentication & authorization
- **JWT with a pinned algorithm** (no `alg: none` / confusion attacks) and a
  per-user `tokenVersion` embedded in every token — bumped on logout-everywhere,
  password change, or role change, so a stolen token is revoked server-side
  without waiting for expiry.
- **Brute-force lockout** — `failedLoginCount` + `lockedUntil` short-circuit bcrypt
  after repeated failures.
- **RBAC** — a role ladder (`SUPER_ADMIN → ADMIN → PRODUCT_MANAGER → ENGINEER →
  CLIENT`) with permission checks in middleware; super-admin "armor" invariants
  prevent privilege-escalation edits.

### Transport & headers
helmet with **HSTS, CSP, and a strict CORS allowlist**; an `Origin` check on
state-changing routes; rate limiting on the API.

### Agent sandbox
Agent tools act **only through a sandbox**: a per-run git worktree that is
**path-contained** (no access outside the workspace), executes commands
**shell-free and bounded** (allow-listed binaries, timeouts, output caps), and
turns tool errors into data rather than crashes. See
[docs/modules/AGENT-RUNTIME.md](docs/modules/AGENT-RUNTIME.md).

### Agent governance (least privilege + human control)
- **AgentPolicy** — per-agent least privilege: a tool allowlist (enforced both by
  filtering the advertised toolset *and* refusing denied calls at the loop), per-run
  token/step budgets (the circuit breaker), and a kill-switch that stops a disabled
  agent from starting runs.
- **Human-in-the-loop** — a run can be paused/resumed, and high-risk actions (e.g.
  opening a PR) can be gated behind a human **approval** before they execute.
- Details: [docs/modules/GOVERNANCE.md](docs/modules/GOVERNANCE.md) ·
  [docs/modules/HUMAN-IN-THE-LOOP.md](docs/modules/HUMAN-IN-THE-LOOP.md).

### Provenance & audit
- **Tamper-evident run receipts** — every run's record is hashed
  (HMAC-SHA256 when `LUMEY_RECEIPT_SECRET` is set, else SHA-256) over a canonical
  serialization; the digest is recomputed on read, so any post-hoc edit to the
  stored snapshot is detectable.
- **Immutable audit attribution** — every activity records whether a HUMAN or an
  AGENT performed it, captured at write time and independent of the (mutable) user
  row.
- **Audit export** — a scoped, date-windowed CSV of the activity log, with
  **spreadsheet formula-injection neutralized** (`=,+,-,@`-leading fields are
  quote-prefixed) so an exported row can't execute on open.
- **Agent-visibility allowlist** — agent work is hidden from unauthorised viewers
  **server-side**, not just in the UI; the audit export upholds this too.

### GitHub integration
Inbound webhooks are **HMAC-verified** against a per-project secret with a
constant-time path for the "no integration" case (no timing side-channel); the
agent authenticates to GitHub with **short-lived GitHub App installation tokens**
(preferred over a long-lived PAT), and PR write scope is per-repository.

### Model providers
Provider API keys are read from server env and **never returned to the client** —
the `/models/providers` endpoint emits redacted descriptors only (model + a
credential-stripped endpoint). Lumey is **local-first**: with the local or
self-hosted tiers, prompts and code never leave your infrastructure. See
[docs/modules/MODEL-ROUTING.md](docs/modules/MODEL-ROUTING.md).

### Secrets & logging
- **gitleaks** scans the full git history in CI and fails the build on any
  committed secret.
- Structured logging (pino) with **redaction** of sensitive fields; a dedicated
  security-event log.
- `.env` is never committed; `backend/.env.example` documents every variable.

## CI security gates

Every pull request runs ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Gate | What it enforces |
|---|---|
| **gitleaks** | no secrets committed to history (fails the build) |
| **npm audit** (prod deps) | no high/critical vulnerability in production dependencies |
| **CycloneDX SBOM** | a Software Bill of Materials is generated + published as an artifact |
| **ESLint** (incl. `security`, `no-secrets`) | static-analysis lint |
| **typecheck / unit / integration / build / Docker-parity** | correctness gates |

## Hardening baseline

The broader hardening work (secret rotation, super-admin armor, timing-safe paths,
etc.) is tracked in [docs/HARDENING_PROGRESS.md](docs/HARDENING_PROGRESS.md) and the
[audits](docs/audits/) folder.
