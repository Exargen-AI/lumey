# Pulse — Multi-Signal Productivity Score (v1)

**Audience:** SUPER_ADMIN, engineers extending the scoring system, employees who want to understand how their score is computed.
**Status:** v1 wave-1 foundation (PR #33). Not yet GA — see rollout in the design doc.
**Design doc:** `~/.gstack/projects/saipreethamvudutha-Exargen_Command_Center/preetham-*design-*.md` (full architecture, premises, revision history through R5).

---

## What it is

A monthly composite 0–100 score per employee, derived from up to **7 distinct signals** across the Command Center:

| Signal | Weight (R5) | What it measures |
|---|---|---|
| STANDUP | 0.13 | Daily standup discipline (substantive entries on working days) |
| EXECUTION | 0.22 | Tasks closed (story-point weighted) |
| CODE | 0.10 | GitHub commits, PRs opened, PRs merged, code reviews |
| COMMUNICATION | 0.10 | Comments authored, mentions, thread participation, response latency |
| PRESENCE | 0.18 | Clock hours, Pulse active hours, login-time consistency, attendance |
| DEEP_WORK | 0.22 | Sustained focus blocks, productive-app ratio, low context-switching |
| DEVICE_HYGIENE | 0.05 | Defender / Firewall / BitLocker / patches / supported OS / agent uptime |

**Universal weights.** Per founder R3 correction (2026-05-29), every employee is scored against the same formula — no role-based weighting. A PM who doesn't push code receives 0 from CODE; that 10% just isn't coming from there. To stay competitive they must be exceptional in the other 90%. The score measures what each person actually did, not what their job title says they should have done.

**3-layer audit trail.** Every composite score is fully explainable:

1. Composite (one 0–100 number)
2. Per-signal sub-scores (7 numbers)
3. Raw inputs per signal (counts, timestamps, gaming flags)

Click any score in the dashboard → see all three layers.

## Wave-1 scope (this PR)

PR #33 ships the foundation infrastructure + the **STANDUP scorer**. Subsequent PRs add:

| Wave | Signals | Branch / PR |
|---|---|---|
| **1 ✅** | Foundation + STANDUP | PR #172 (merged) |
| **2 ✅** | EXECUTION + PRESENCE + DEEP_WORK + DEVICE_HYGIENE | PR #173 (merged) |
| **3 ✅** | CODE (GitHub webhook + ingestion) | PR #176 (merged) |
| **4 ✅** | COMMUNICATION (comments + mentions) | PR #177 (merged) |
| **5 ✅** | scoreRecomputeWorker + SUPER_ADMIN API endpoints + observability | PR #178 (merged) |
| **6 ✅** | Frontend Reports tab + breakdown drawer + worker health (SUPER_ADMIN-only per R5 lockdown) | PR #179 (merged) |
| **7 ✅** | UI polish — status strip, team summary hero, search, CSV export, recompute-all, skeletons | PR #180 |
| **8 ✅** | Agent signal quality — classifier audit (104 tests), proportional tamper penalty, `productiveRatio` + `tamperRatio` fields, dev-seed alignment + comprehensive overview docs | PR #181 |
| **9 ✅ (this PR)** | Agent resilience — remote kill switch, background tamper-process scan, agent self-health telemetry, battery/disk/network collectors, Go-compiled watchdog (no console flash), employee onboarding guide | `feat/pulse-wave-9-agent-resilience-and-onboarding` |

🚀 **All 9 waves shipped.** Pulse Multi-Signal Productivity Score is feature-complete and browser-tested behind `FEATURE_PULSE_COMPOSITE_SCORE_BETA`. Flag stays off in production until the founder calibration pass is done — see "Production rollout" below.

📖 **New to Pulse?** Start with [00-OVERVIEW.md](./00-OVERVIEW.md) for the one-page introduction + architecture diagram.

## Wave 6 surface — the SUPER_ADMIN Reports page

Route: `/pulse/reports` (sidebar entry "Reports" under the SUPER_ADMIN-only group).

Three tabs in one page:

1. **Scores** — list of every employee at the chosen cadence
   (DAILY / WEEKLY / MONTHLY), sortable by composite, with a
   click-through drawer that shows the full audit-trail breakdown:
   composite + 7 sub-scores + applied weight per signal + gaming
   flags + the up-to-500 contributing `productivity_events`. The
   drawer also exposes a "Recompute now" button that calls
   `POST /admin/pulse/scores/:userId/recompute` and skips the 60s
   debounce.

2. **Weights** — currently-active universal weights, displayed as
   percentages, plus the last 20 history rows. Read-only in v1
   (founder edits weights via DB seed). The PATCH endpoint stays
   deferred until the calibration pass identifies a need.

3. **Worker health** — observability snapshot of `productivityMetrics`:
   outbox depth, worker lag, compute-duration p95 + mean + max, and
   the malformed-weights counter. Each card has a status icon (green
   ✓ when within alert thresholds, amber ⚠ otherwise). A banner
   appears when the worker is disabled via feature flag.

The page is route-gated to `roles={['SUPER_ADMIN']}` (App.tsx) and
every underlying endpoint is triple-gated in
`pulseScore.routes.ts`. A UI bypass hits a 403 with code
`PRODUCTIVITY_SCORE_FORBIDDEN`.

## Wave 7 polish — what changed (2026-05-29)

Wave 6 shipped a working page. Wave 7 made it feel like an enterprise
reports surface:

- **System status strip** at the top of every tab — worker enabled,
  outbox depth, lag, last-cycle freshness. A SUPER_ADMIN can spot a
  stuck pipeline in one glance instead of debugging "no data" by
  digging into Railway logs.
- **Team summary hero** — total scored, average composite, gaming-flag
  count, last refresh, plus a stacked HIGH/MEDIUM/LOW distribution
  bar. Backed by a single `GET /admin/pulse/scores/summary` rollup
  endpoint so the FE doesn't reduce over a 200-row payload.
- **Search + skeleton loaders + actionable empty state** — the empty
  state tells you exactly which env var to set on Railway, not just
  "no data yet."
- **Recompute-all team button** — `POST /admin/pulse/scores/recompute-all`
  kicks off a fire-and-forget recompute for every `isActive` user
  (capped at 500). Used after enabling the feature flag for the first
  time so you don't have to click each employee one-by-one.
- **CSV export** — client-side blob download of the current cadence
  rows. No server round-trip, no temp files, no log leaks. Useful for
  monthly performance-review packets.
- **Avatars + colour-coded meters** — composite meter fills match the
  band (green/amber/red), avatars use gradient initials. Reads at a
  glance even on a 27-inch monitor.

## Production rollout

The whole system is gated by `FEATURE_PULSE_COMPOSITE_SCORE_BETA`.
Flag stays off until the founder is ready to calibrate.

**To flip on in production:**

1. **Railway → backend service → Variables**: add
   `FEATURE_PULSE_COMPOSITE_SCORE_BETA=true` and redeploy.
2. **Verify the worker booted**: hit
   `GET /api/v1/admin/pulse/observability` (SUPER_ADMIN session) or
   open the Reports page → Worker health tab. `workerEnabled` should
   read `true` and `lastCycleAt` should advance every 5 seconds.
3. **Trigger the first backfill**: Reports → Scores tab → "Recompute
   all". This reads the last 30 days of `productivity_events` (already
   emitting since Waves 1-4) and produces one DAILY + WEEKLY + MONTHLY
   row per active employee.

   > **Cadence normalization (2026-06-01).** The rate-based signals
   > (PRESENCE, STANDUP) divide accumulated activity by **elapsed
   > working days** in the window — days from the period start through
   > today — NOT the full period's working days. Without this, a
   > weekly/monthly score read systematically low for every day except
   > the last of the period (on the 1st of a month, everyone landed in
   > the LOW band). With it, weekly/monthly scores mean "per working
   > day so far this period" and are stable + comparable from day one.
   > `EmployeeProductivityScore.rawBreakdown` carries both
   > `working_days` (full period) and `elapsed_working_days` for
   > transparency.
4. **Calibration pass** (founder): walk through the team's sealed-
   envelope predictions vs. actual composites (see Calibration
   section). If the composite is wildly off, adjust the weights via
   DB seed and recompute-all.

**To kill it fast** (e.g. dispute, false alarm): set
`FEATURE_PULSE_COMPOSITE_SCORE_BETA=false` and redeploy. The worker
stops on next boot; existing score rows stay in the DB but the
Reports tab shows the "Productivity scoring is off" empty state.

**Dev seed for synthetic events**: see
`backend/scripts/seedDevProductivityEvents.ts`. Refuses to run with
`NODE_ENV=production`. Emits 30 days × 7 signals per user so the
Reports page renders end-to-end on a fresh local DB. Run with
`bun run backend/scripts/seedDevProductivityEvents.ts`.

🎉 **All 7 signals now active.** Composite is fully populated behind `FEATURE_PULSE_COMPOSITE_SCORE_BETA`.

## Wave 3 setup — GitHub App (one-time, SUPER_ADMIN)

The CODE signal needs the Exargen-AI org's Git activity. To enable in production:

1. **Create a GitHub App** at `https://github.com/settings/apps/new` (org-owned):
   - **Webhook URL**: `https://exargencommandcenter-production.up.railway.app/api/v1/webhooks/github/pulse`
   - **Webhook secret**: generate a 64+ char hex string (e.g. `openssl rand -hex 32`)
   - **Repository permissions**: Pull requests = Read, Issues = Read, Contents = Read, Metadata = Read
   - **Subscribe to events**: ✅ Pull request, ✅ Pull request review, ✅ Push
2. **Install on the Exargen-AI org** with "All repositories" access.
3. **Set the env var on Railway**:
   ```bash
   PULSE_GITHUB_WEBHOOK_SECRET=<the secret from step 1>
   ```
4. **Populate `users.githubLogin`** for each employee (lowercased GitHub login). Without this the webhook will write audit rows but emit zero CODE events for that person.
5. **Enable the beta flag** when ready: `FEATURE_PULSE_COMPOSITE_SCORE_BETA=true`.

When the env var is unset, the endpoint always returns 401 — no accidental data ingestion before everything is wired.

Everything ships behind the `pulseCompositeScore.beta` feature flag (`FEATURE_PULSE_COMPOSITE_SCORE_BETA=true` env var). Flag stays off in prod until wave 6 GA.

## Architecture

### Event-sourced via outbox pattern

Every emitting service writes a `productivity_events` row **inside the same Prisma transaction** as its source mutation. This guarantees the event log is exactly synchronised with reality — no events on rollback, no after-commit hooks.

```
+-----------------------------+        +---------------------------+
| dailyUpdate.service          |        | tasks.service              |
| └─ tx.dailyUpdate.upsert     |        | └─ tx.task.update          |
| └─ emitProductivityEvent     |        | └─ emitProductivityEvent   |
+-----------------------------+        +---------------------------+
              │                                  │
              ▼                                  ▼
         ┌────────────────────────────────────────────┐
         │  productivity_events  (outbox / event log) │
         └────────────────────────────────────────────┘
                              │
                              ▼ (5s poll, 60s per-user debounce)
            ┌─────────────────────────────────────────┐
            │  scoreRecomputeWorker (wave 5)          │
            │  - per-signal Scorer functions          │
            │  - composite calculation                │
            │  - upsert employee_productivity_scores  │
            └─────────────────────────────────────────┘
                              │
                              ▼ (30s React Query refetch)
                       Dashboard / TodayPage
```

### Pure scorer functions

Each signal has a single `Scorer` function:

```ts
type Scorer = (input: ScorerInput) => SignalScore;
```

Pure → unit-testable, replayable (change a weight, re-run scorers over the event log, done), trivially parallelisable. Adding a new signal = adding one file + one entry to the `Record<ProductivitySignal, Scorer>` map.

### Composite calculation

```ts
composite =
  Σ over active signals: applied_weight[signal] × signal_score[signal]
  – 5 × cross_signal_gaming_flags_count
  clamped to [0, 100]
```

- **Renormalisation during waves**: if a signal is not yet ingested (e.g. CODE during wave-2), its weight is dropped from the denominator. The composite is always interpretable as 0–100, never capped because one signal is missing.
- **Partial scoring for not-yet-onboarded employees (2026-06-01)**: the report works *before* an employee installs the Pulse agent. Only `DEEP_WORK` (foreground focus) and `DEVICE_HYGIENE` (device health) require the agent; the other five signals come from the Command Center / GitHub. For a user with **no enrolled ACTIVE device**, the worker marks `DEEP_WORK` + `DEVICE_HYGIENE` as inactive (and `PRESENCE` too if they have no clock-in events), so their composite renormalises over the signals we can actually observe — standups, tasks, code, comments (+ presence if they clock in). Without this, a productive employee who hadn't installed the agent scored 0 on ~27% of the weight and looked mediocre. The Scores UI shows a **"N of 7 signals active"** chip (from `flags.inactiveSignals`) so you always know whose score is full (7/7, onboarded) vs. partial (5/7, output-only). A signal we *can* observe but that came back empty (e.g. didn't submit standups) still scores 0 — that's a real zero, not a measurement gap.
- **Cross-signal gaming penalty**: only fires when 2+ distinct signals show gaming-guard hits in the same window. Per-signal flags already zero out their contributions inside the scorers; this composite-level term catches the rare "broadly gaming everything at once" pattern. Capped at -30.
- **TAMPER is NOT double-counted**: the agent's anti-tamper detection reduces the DEEP_WORK sub-score directly; the composite formula doesn't re-penalise.

## Gaming guards (v1)

| Signal | Guard | What it catches |
|---|---|---|
| STANDUP | `standup_too_short` | Body <50 chars → ignored |
| STANDUP | `standup_duplicate_count` | Same body hash posted >=3 prior days → ignored |
| EXECUTION (wave 2) | `task_closed_too_fast` | Task closed <60 min after creation → ignored |
| EXECUTION (wave 2) | `task_self_resolve_no_comments` | Created + closed by same user with no comments → ignored |
| CODE (wave 3) | `pr_no_description` | PR with empty description → ignored |
| CODE (wave 3) | `pr_self_approved` | Self-approved → excluded from reviews count |
| CODE (wave 3) | `dependabot_auto_merge` | Auto-merged dependabot PRs → ignored |
| COMMUNICATION (wave 4) | `comment_too_short` | <20 chars → ignored |
| COMMUNICATION (wave 4) | `comment_spam_rate` | >30 comments/hr → capped |
| PRESENCE (wave 2) | `ghost_clock` | Clock-in without device activity → flagged |
| DEEP_WORK (wave 2) | `mouse_jiggler` | Constant input, no app switches → TAMPER |
| DEEP_WORK (wave 2) | `foreground_stale` | foreground.json >5min stale → ignored |
| DEVICE_HYGIENE (wave 2) | `agent_offline` | No heartbeat >24h → -25 |

## Access policy (R5 lockdown — 2026-05-29)

**Productivity-score data is SUPER_ADMIN-only.** Founder directive:

> "remember only super admin has access to all these metrics right?, make sure only super admin is allowed"

This **overrides design Premise P6** which originally allowed employees to see their own composite on TodayPage. The new policy: composite scores, per-signal sub-scores, raw `productivity_events`, weight sets, dispute records — none of these are visible to any user other than SUPER_ADMIN. No employee self-view. No `/me/productivity` endpoint.

**Defensive layers:**
1. **`requireProductivityScoreAccess`** middleware on every productivity-score Express route (Wave 5+). Returns 403 with code `PRODUCTIVITY_SCORE_FORBIDDEN` for any non-SUPER_ADMIN. Distinct code from the generic 403 so audit-log search can flag attempted score peeks as security events.
2. **`assertProductivityScoreAccess`** service-layer guard for non-Express contexts (background workers, MCP tools, test harnesses). Throws `ProductivityScoreAccessError` — same code, same status.
3. **Tripwire tests** in `requireProductivityScoreAccess.test.ts` pin SUPER_ADMIN-only across every non-SUPER_ADMIN role enum value. Loosening the gate later is a deliberate code change, not a silent drift.
4. **Comments** at the top of `compositeScorer.ts`, `productivityOutbox.ts`, and `scorers/types.ts` reference this policy. Any future engineer adding a read path sees the directive.

## API surface (wave 5) — all SUPER_ADMIN-only

```
GET    /api/v1/admin/pulse/scores                              shipped wave 5 ✅
GET    /api/v1/admin/pulse/scores/summary                      shipped wave 7 ✅
GET    /api/v1/admin/pulse/scores/:userId                      shipped wave 5 ✅
GET    /api/v1/admin/pulse/scores/:userId/breakdown            shipped wave 5 ✅
GET    /api/v1/admin/pulse/weights                             shipped wave 5 ✅
GET    /api/v1/admin/pulse/observability                       shipped wave 5 ✅
POST   /api/v1/admin/pulse/scores/:userId/recompute            shipped wave 5 ✅
POST   /api/v1/admin/pulse/scores/recompute-all                shipped wave 7 ✅
PATCH  /api/v1/admin/pulse/weights                             deferred (DB seed for v1)
POST   /api/v1/admin/pulse/time-off                            deferred
GET    /api/v1/admin/pulse/disputes                            deferred
PATCH  /api/v1/admin/pulse/disputes/:id                        deferred
DELETE /api/v1/admin/users/:id/productivity-data               deferred (right-to-be-forgotten)
```

Each shipped route is **triple-gated** in `pulseScore.routes.ts`:
`authenticate` → `requireRoles('SUPER_ADMIN')` → `requireProductivityScoreAccess`. The named gate is belt-and-braces: even if a future refactor drops one layer, the other two still hold and the tripwire tests will fail loudly.

**No `/me/productivity` endpoint.** Employees don't see their own score under the R5 lockdown. (If the policy is ever relaxed, that endpoint is the natural place to add — but its handler MUST go through `requireProductivityScoreAccess` AND a separate "is this requesting their own data" check.)

### Recompute behaviour

`POST /admin/pulse/scores/:userId/recompute` skips the 60s debounce and fires `scoreRecomputeWorker.recomputeForUser(userId)` in the background. The handler responds immediately with `{ triggered: true }`; the upsert is idempotent (`UNIQUE` on `(userId, windowStart, windowEnd, cadence)`) so repeated triggers don't double-write. Useful after editing a standup body, retroactively marking PTO, or any other "I changed an input — refresh this person's score now" workflow.

## Data retention

- `productivity_events.rawPayload`: **13 months** raw, then rolled up to per-week aggregates, raw payload nulled.
- `employee_productivity_scores`: **indefinite** (audit-trail for past performance reviews).
- `github_webhook_events` (wave 3): **90 days** raw, derived events persist.
- **Leaver semantics**: when `users.deactivatedAt` is set, scoring stops. Score rows kept 13 months.
- **Right-to-be-forgotten**: `DELETE /admin/users/:id/productivity-data` hard-deletes all related rows. Audit-logged separately.

## Observability (wave 5)

The recompute worker emits 5 named metrics with alert thresholds:

| Metric | Alert |
|---|---|
| `scoreRecomputeWorker.lag_seconds` | >5 min for >10 min |
| `productivityEvents.outbox_depth` | >1000 unprocessed rows |
| `productivityEvents.reconciliation_inserts` (GitHub) | >10 / day |
| `compositeRecompute.duration_p95_ms` | >2000ms for >30 min |
| `compositeScore.malformed_weights` | >0 (weights set failed validation) |

## Multi-tenancy

v1 assumes single-tenant. When multi-tenancy lands platform-wide, the four new tables (`productivity_events`, `employee_productivity_scores`, `universal_weight_sets`, `employee_profiles`) will each gain a `tenantId` column with FK + indices. Estimated +1 week to backfill.

## Calibration

**Week 0 task (founder, before any production code):**

1. Run the existing Pulse foreground-app score against Preetham's actual data for the past 7 days. Write down 3-5 things you wish the score told you that it doesn't. Those become the v1 test cases.
2. Pick 3 employees you have strong opinions about. Sealed envelope: write down what their monthly composite score should be in your gut. When wave-5 ships, compare. If the composite is wildly off, the WEIGHTS or GUARDS are wrong, not the framework.
3. Decide whether you do the GitHub App install yourself this week (so CODE signal lands on time in wave 3) or whether the eng team owns it.

## Revision history

R0 → R1 → R2 → R3 → R4 → R5: see the design doc for full provenance (5 rounds of revisions including 2 adversarial reviews + 3 founder corrections). R5 is the final weight set and is what this PR seeds.
