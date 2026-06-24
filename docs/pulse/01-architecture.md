# Pulse — Architecture (2026-05-28)

> **Status:** v1 foundation shipped (PR — feat/pulse-module-foundation).
> **Scope:** SUPER_ADMIN-only Employee Productivity Tracker + Device Health.
> **Owner:** Platform.

## Why

Pankaj asked for a way to see, at-a-glance:

- Which employee laptops are healthy / at-risk / critical.
- Which laptops are missing critical Windows patches.
- Which have antivirus / firewall / BitLocker disabled, or are running an unsupported OS.
- Which agents have gone offline.
- A funnel for clock-in/out + standup (deferred to PR 2).

This becomes the founder's "fleet of the company" view — without leaning on a paid MDM, and without granting access to anyone except the SUPER_ADMIN.

## Big picture

```
┌────────────────────────┐         ┌─────────────────────────────────┐
│ Employee laptop        │         │ Command Center backend          │
│                        │         │                                  │
│  PulseAgent.exe        │         │  /api/v1/devices/enroll          │
│  (Windows Service)     │ HTTPS   │  /api/v1/devices/me/heartbeat    │
│      │                 │ ──────▶ │  /api/v1/devices/me/snapshot     │
│      ├─heartbeat 5min  │         │      ↑ deviceAuthenticate        │
│      └─snapshot  60min │         │                                  │
└────────────────────────┘         │  /api/v1/admin/pulse/*           │
                                   │      ↑ authenticate              │
                                   │      ↑ requireRoles(SUPER_ADMIN) │
                                   └──────────────┬──────────────────┘
                                                  │
                                                  ▼
                                          PostgreSQL
                                          (devices, snapshots,
                                          software, patches,
                                          risk_alerts)
                                                  │
                                                  ▼
                                         Frontend /pulse page
                                         (SUPER_ADMIN only)
```

## Privilege boundaries

Three boundaries enforce SUPER_ADMIN-only access:

1. **Route layer.** Every admin endpoint sits behind `authenticate` + `requireRoles('SUPER_ADMIN')`. Forgetting either is a single-line route bug rather than a silent leak.
2. **Service layer.** `assertSuperAdmin(callerRole)` runs as the first line of every read service. Refuses BEFORE any DB query so an accidentally-unprotected route still 403s instead of leaking data.
3. **Frontend.** The `/pulse` route lives under `<ProtectedRoute roles={['SUPER_ADMIN']} />`, and the sidebar entry only renders inside `SIDEBAR_NAV.superAdmin`.

A non-SUPER_ADMIN cannot reach the data through any of: navigating to `/pulse`, calling `/api/v1/admin/pulse/*` with a stolen Bearer token (still wrong role), or registering a fake middleware.

## Agent-to-backend boundary

**The agent never writes the DB directly.** It POSTs JSON to backend endpoints behind a different middleware (`deviceAuthenticate`) which:

- Reads `Authorization: Device <key>`.
- Hashes the cleartext with sha-256 and looks up `devices.apiKeyHash` (so the cleartext never reaches Postgres in any context — not even a query log).
- Refuses any device whose `status !== ACTIVE`.
- Sets `req.device` (distinct from `req.user` so a future code path can't confuse the two).

Revocation: a SUPER_ADMIN clicks "Revoke" → `Device.status = REVOKED` → next agent call returns 401. The agent retries with exponential backoff; the device row stays for audit.

## Data model

Six tables, all in `backend/prisma/schema.prisma`:

| Table | Rows | Owner | Notes |
|---|---|---|---|
| `devices` | 1 per laptop | SUPER_ADMIN (lifecycle) / agent (telemetry refresh) | Holds the per-device `apiKeyHash`. Cleartext is shown once at enrollment. |
| `device_enrollment_tokens` | 1 per bootstrap | SUPER_ADMIN | Single-use, 7d default TTL, returns cleartext token ONCE. |
| `device_health_snapshots` | 1 per ~60 min | agent | Frozen risk score + posture flags. Drives trend lines. |
| `device_installed_software` | many per device | agent (upsert+prune) | Risk flag set at ingestion time against a small block list. |
| `device_missing_patches` | many per device | agent (upsert+prune) | Windows Update KB IDs. |
| `device_risk_alerts` | open + resolved | agent (auto-open/resolve) + SUPER_ADMIN (manual resolve) | One open alert per (device, type) at most. |

Cascade strategy:
- `Device → snapshots / software / patches / alerts` = `CASCADE`. Deleting a device drops its telemetry trail (intentional — re-enroll creates a fresh device row).
- `User → device.ownerUserId` = `SET NULL`. Owner offboards; device remains for reassignment.
- `User → device_enrollment_tokens.issuedByUserId` = `NO ACTION`. Issuer must remain for audit trail.

## Telemetry rhythm

| Call | Cadence | Cost | What it writes |
|---|---|---|---|
| `POST /devices/enroll` | once per device | new row | `devices.create`, marks token consumed |
| `POST /devices/me/heartbeat` | ~5 min | cheap | `Device.lastSeenAt`, `currentPowerState` |
| `POST /devices/me/snapshot` | ~60 min | heavy | `DeviceHealthSnapshot.create`, upsert+prune software + patches, risk scorer, alert reconciliation |

The snapshot path carries an `Idempotency-Key` header so a retry-after-timeout doesn't create a duplicate snapshot row. The key is `sha256(body).slice(0, 32)` — deterministic for the same body, distinct as state evolves.

## Risk scoring

Pure-function in `backend/src/services/deviceRisk.service.ts`. Score = `max(0, 100 - Σ penalties)`; bands:

- `HEALTHY` ≥ 80
- `AT_RISK` 50–79
- `CRITICAL` < 50

| Penalty | Trigger | Weight |
|---|---|---|
| `AGENT_OFFLINE` | `secondsSinceLastSeen` > 24h or null | -30 |
| `ANTIVIRUS_DISABLED` | `defenderEnabled === false` | -20 |
| `FIREWALL_DISABLED` | `firewallEnabled === false` | -15 |
| `BITLOCKER_DISABLED` | `bitlockerEnabled === false` | -15 |
| `UNSUPPORTED_OS` | `unsupportedOs === true` | -20 |
| `REBOOT_REQUIRED` | `rebootRequired === true` | -10 (warn) / -20 (>30d overdue) |
| `MISSING_CRITICAL_PATCHES` | `criticalPatchCount > 0` | -5 each, capped at -30 |
| `RISKY_SOFTWARE_INSTALLED` | `riskySoftwareCount > 0` | -10 each, capped at -30 |

`SCORING_VERSION = 1`. Bump the version (and the test suite) when changing weights; historical `DeviceHealthSnapshot` rows keep their frozen score so old data stays interpretable.

Risky-software list is a tiny built-in `RISKY_SOFTWARE_PATTERNS` (BitTorrent clients, remote-access tools, crypto miners). A future SUPER_ADMIN UI will let the list be edited and back-applied.

## Alert lifecycle

`DeviceRiskAlert` rows are open/resolved.

- Auto-open: the snapshot ingest runs the scorer; each active penalty maps 1:1 to an alert type. If the alert isn't already open, we open it.
- Auto-resolve: any open alert whose trigger is no longer firing gets `resolvedAt = now` with `resolutionNote = 'Auto-resolved: condition no longer firing'`.
- Manual resolve: SUPER_ADMIN clicks "Resolve" on the dashboard → `resolveAlert` → row gets resolved with the admin's note.

At-most-one open alert per `(deviceId, type)` is enforced in the service layer via an existence check before insert (Prisma doesn't support partial unique indexes cleanly; the check + `@@index([deviceId, type, resolvedAt])` keeps the hot path fast).

## Privacy posture

What the agent collects:

- Power state (`ON`/`IDLE`/`LOCKED`/`OFF`)
- Uptime + boot time
- Logged-in username (cross-checked against device owner)
- Defender / Firewall / BitLocker / reboot / OS-version flags
- Installed software list
- Missing Windows Update KBs

What the agent does NOT collect (and we explicitly call this out so it stays gone):

- Keyboard / mouse input contents
- Window titles or process command lines
- Browser history
- Email / messaging contents
- Screenshots
- Camera / microphone

Each future expansion to this list goes through a `docs/pulse/` design review documenting why it's needed, what the privacy posture is, and how the SUPER_ADMIN-only boundary keeps it from leaking elsewhere.

## OpenAPI

Both surfaces (agent + admin) register with `backend/src/openapi/pulse.paths.ts`. Visible at:

- `GET /api/v1/openapi.json` (machine-readable)
- `GET /api/v1/docs` (Swagger UI)

The agent's `DeviceAuth` scheme is a registered `securitySchemes` so external integrations know not to send a Bearer JWT to the agent endpoints.

## Productivity rollup (per-device usage chart)

Each `DeviceHealthSnapshot` carries `activeSecondsBucket`, `idleSecondsBucket`, `lockedSecondsBucket` — seconds accumulated agent-side since the previous snapshot via a 30-second tick loop. `GET /admin/pulse/devices/:id/productivity?days=7` sums these into per-day buckets, then derives `offSeconds = max(0, 86400 - active - idle - locked)` so a missing-hour gap (agent not running) is visible.

The agent's accumulator drains + resets at snapshot time. Cap at 7,200 seconds per bucket per snapshot serves as a sanity guard.

## Clock In / Clock Out

Distinct from automatic device telemetry. The user declares when they start and stop working — a meeting / phone call / off-laptop task is still "clocked in"; an unlocked-but-unused laptop is not.

Model: `clock_sessions` (userId, clockedInAt, clockedOutAt, autoClosedAt, noteIn, noteOut). Invariants:
- At most one OPEN session per user (refuses double-clock-in with 422).
- Clock-out with no open session is a `ValidationError` (not a silent no-op — we want the missed-hours surface to be visible).
- Sessions still open after 12h are auto-closed via `autoCloseStaleSessions()` (intended to run as a daily sweep). `autoClosedAt` is distinct from `clockedOutAt` so the team view can flag the row as "auto-closed — confirm hours".

Endpoints:

| Method | Path | Who |
|---|---|---|
| `POST /clock/in` | start a session | any authenticated user |
| `POST /clock/out` | close the open session | any authenticated user |
| `GET /clock/me/today` | current status + today's sessions + total seconds | any authenticated user |
| `GET /admin/pulse/clock/team?date=YYYY-MM-DD` | team rollup | SUPER_ADMIN only |

UI:
- **TodayPage** gets a Clock card (in / out button + today's total + per-session breakdown).
- **PulsePage** gets a Clock log tab (team-wide, per-day).

## Daily Standup submission

The `DailyUpdate` model + `POST /daily-updates` submission endpoint + `GET /daily-updates/mine/today` status endpoint pre-date this PR (they powered the existing admin StandupViewPage). The missing piece was the employee-facing entry point.

**TodayPage** now hosts a Standup card with a daily prompt — summary (required) + mood (one-tap chip) + blockers + tomorrow's plan. Once submitted, the card flips to a "Submitted at X" confirmation that stays until the next calendar day.

## Future PRs (not in this one)

| PR | Scope |
|---|---|
| PR 2 | Risky-software block list editor (SUPER_ADMIN UI) |
| PR 3 | `.msi` installer build + signing |
| PR 4 | Device timeline page (snapshot history graph, alert audit trail) |
| PR 5 | Webhook export (`device.critical`, `agent.offline`) — design doc deferred |
| PR 6 | macOS / Linux collectors |
| PR 7 | Scheduled cron for `autoCloseStaleSessions` (currently called on-demand) |

## What's verified

| Surface | Verification |
|---|---|
| Prisma schema | `prisma format` + `prisma validate` clean |
| Backend TypeScript | `tsc --noEmit` clean |
| Backend tests | 65 new tests in 4 files, full suite 948 passing |
| Frontend TypeScript | `tsc --noEmit` clean |
| Risk scorer rubric | 21 tests pin each penalty + band boundary |
| Device-auth boundary | 12 tests pin missing-header / wrong-scheme / unknown-key / inactive-status |
| SUPER_ADMIN gate | 12 tests pin the defence-in-depth refusal |
| Frontend Pulse page | renders without console errors; route guard redirects to /login for unauthenticated users |
| End-to-end with agent | not verified — requires Windows host + running DB; deferred to dev rollout |
