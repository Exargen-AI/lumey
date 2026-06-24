# Pulse — Multi-Signal Productivity Score

> **What this is, who it's for, and how it works.**
> Read this first if you're new to the Pulse module.

The Pulse Multi-Signal Productivity Score is an enterprise-grade productivity
measurement system for the Exargen Command Center. It turns seven independent
signals — from standups, tasks, code, comments, presence, deep work, and
device hygiene — into a single 0–100 composite for every active employee,
across three cadences (daily / weekly / monthly), with full audit-trail
drill-down.

It is **SUPER_ADMIN-only by contract** (founder directive — see "Access
policy" below). No employee self-view. The entire surface exists for the
founder + admin team to spot trends, calibrate weights, and run
performance reviews with data instead of vibes.

---

## What's been shipped (the 8 waves)

| # | Wave | What landed | PR |
|---|---|---|---|
| 1 | Foundation + STANDUP | Schema, outbox, feature flag, R5 shared types, STANDUP scorer | [#172](https://github.com/Exargen-AI/exargen-command-center/pull/172) |
| 2 | EXECUTION + PRESENCE + DEEP_WORK + DEVICE_HYGIENE | Four more scorers, agent state-time accounting | [#173](https://github.com/Exargen-AI/exargen-command-center/pull/173) |
| — | R6 access lockdown | `requireProductivityScoreAccess` middleware, distinct 403 code | [#174](https://github.com/Exargen-AI/exargen-command-center/pull/174) |
| — | Lint cleanup | Zero-warning baseline | [#175](https://github.com/Exargen-AI/exargen-command-center/pull/175) |
| 3 | CODE | GitHub org webhook + HMAC + ingestion | [#176](https://github.com/Exargen-AI/exargen-command-center/pull/176) |
| 4 | COMMUNICATION | Comments + mentions ingestion + gaming guards | [#177](https://github.com/Exargen-AI/exargen-command-center/pull/177) |
| 5 | `scoreRecomputeWorker` + 6 SUPER_ADMIN endpoints + observability metrics | [#178](https://github.com/Exargen-AI/exargen-command-center/pull/178) |
| 6 | Frontend `/pulse/reports` page + breakdown drawer + worker-health tab | [#179](https://github.com/Exargen-AI/exargen-command-center/pull/179) |
| 7 | UI polish — status strip, summary hero, search, CSV export, recompute-all, skeletons + summary endpoint | [#180](https://github.com/Exargen-AI/exargen-command-center/pull/180) |
| 8 | Agent signal quality — classifier audit, proportional tamper penalty, `productiveRatio` + `tamperRatio` fields, dev-seed alignment + comprehensive overview docs (this file) | [#181](https://github.com/Exargen-AI/exargen-command-center/pull/181) |
| 9 | Agent resilience — **remote kill switch** (revoked devices exit cleanly instead of looping on 401s), **background tamper-process scan** (catches mouse-jigglers running outside the foreground), **agent self-health telemetry** (CPU / memory / errorCount on every heartbeat), **battery + disk + network collectors**, **Go-compiled watchdog** (no console flash), **employee onboarding guide** | [#182](https://github.com/Exargen-AI/exargen-command-center/pull/182) |

Backend tests: **1,266**.
Frontend tests: **114**.
Agent tests: **104**.
**Total: 1,484 tests, all green.** Pre-push checks (prisma validate / shared
build / tsc / ESLint zero-warning / vitest / vite build) run on every wave.

---

## The big picture (one diagram)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Where the signals come from                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TodayPage standup  ─────►  dailyUpdate.service                     │
│  Task close          ─────►  task.service                           │
│  PR / push / review  ─────►  pulseGithubWebhook.service             │
│  Comment / mention   ─────►  comment.service                        │
│  Clock in / clock out ────►  clockSession.service                   │
│  Windows agent       ─────►  pulse.handler → deviceTelemetry.service│
│                                                                     │
│       (each writes ONE row to `productivity_events` in the SAME     │
│        Prisma transaction as its source mutation — outbox pattern)  │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 ▼
                  ┌─────────────────────────────┐
                  │   productivity_events       │
                  │   (event log, outbox)       │
                  └──────────────┬──────────────┘
                                 │  (5s poll, 60s per-user debounce)
                                 ▼
                  ┌──────────────────────────────────┐
                  │   scoreRecomputeWorker           │
                  │   ├─ 7 pure per-signal scorers   │
                  │   ├─ compositeScorer (R5 weights)│
                  │   └─ upsert score rows + mark    │
                  │       events processed           │
                  └──────────────┬───────────────────┘
                                 ▼
                  ┌─────────────────────────────────┐
                  │   employee_productivity_scores  │
                  │   (DAILY / WEEKLY / MONTHLY)    │
                  └──────────────┬──────────────────┘
                                 │  (6 SUPER_ADMIN endpoints)
                                 ▼
                  ┌─────────────────────────────────┐
                  │   /pulse/reports                │
                  │   ├─ Scores tab + drawer        │
                  │   ├─ Weights tab                │
                  │   └─ Worker health tab          │
                  └─────────────────────────────────┘
```

---

## The 7 signals

Each signal is a pure function from event log to a 0–100 sub-score.
Every scorer lives in `backend/src/scoring/scorers/<name>.scorer.ts`,
returns `SignalScore`, and is unit-tested in the same directory.

| Signal | Weight | Source | Event type(s) read by the scorer |
|---|---:|---|---|
| **STANDUP** | 13% | TodayPage daily-update form | `standup.submitted` |
| **EXECUTION** | 22% | Task close events | `task.closed` |
| **CODE** | 10% | GitHub org webhook | `github.commit` / `github.pr_opened` / `github.pr_merged` / `github.pr_review` |
| **COMMUNICATION** | 10% | Comments + mentions | `comment.created` / `mention.sent` / `mention.received` |
| **PRESENCE** | 18% | Clock + Windows agent | `clock.session_closed` + `pulse.daily_presence` |
| **DEEP_WORK** | 22% | Windows agent snapshot | `pulse.daily_focus` |
| **DEVICE_HYGIENE** | 5% | Windows agent snapshot | `pulse.daily_hygiene` |

**Weights sum to 1.00** (R5 universal weights, founder R3 directive — no
role bundles, one weight set applied equally to every employee).
**Bands**: HIGH ≥ 75, MEDIUM 40–74, LOW < 40 (thresholds editable via
`universal_weight_sets`).

### Signal deep dives

- **STANDUP** — Did a substantive standup land on each working day?
  Gaming guards: body <50 chars dropped; duplicate-body hash >=3 prior
  days dropped.
- **EXECUTION** — Tasks closed at a healthy weekly rate per role/level.
  Gaming guards: task closed <60 min after creation dropped; created +
  closed by same user with no comments dropped.
- **CODE** — Commits, PRs opened, PRs merged, reviews given on the
  default branch. Gaming guards: empty-description PRs dropped;
  self-approved PRs excluded from reviews; dependabot auto-merges dropped.
- **COMMUNICATION** — Comments and @-mentions, weighted by substance
  (length, replies). Gaming guards: <20 chars dropped; spam rate >30/hr
  capped.
- **PRESENCE** — Hours present per working day, with consistency bonus
  and ghost-clock detection. **Dedupe**: when both clock data and agent
  data exist for a day, the scorer takes `min(clocked, agent-active)`
  so you can't game by clocking in and walking away.
- **DEEP_WORK** — Productive-app time, focus-block count (≥25 min same
  app), context-switching rate, distraction bursts. Tamper penalty is
  now **proportional** (Wave 8) — `tamperRatio` × 30 capped — so a
  short keep-awake spike during a long meeting doesn't trash the
  whole window.
- **DEVICE_HYGIENE** — Defender + Firewall + BitLocker + reboot
  pending + unsupported OS + missing patch count. Aggregated across
  daily snapshots so a one-off bad day doesn't dominate.

---

## How the Windows agent feeds the scorers

The .exe (Inno Setup installer) packages a headless Node service that
sends:

| Cadence | Payload |
|---|---|
| Heartbeat ~5 min | Lightweight ping (proves agent alive, drives "online" status) |
| Snapshot ~60 min | State-time bucket (active/idle/locked seconds) · per-app foreground time + category · power state + uptime + login session start · security posture (Defender / Firewall / BitLocker / reboot / unsupported OS) · installed software + missing patches · agent version |

`ingestSnapshot` runs in a Prisma transaction and writes three
`productivity_events` rows per snapshot:

| Event | Signal | Key fields |
|---|---|---|
| `pulse.daily_presence` | **PRESENCE** | activeSeconds, idleSeconds, lockedSeconds, hasTamper, loginSessionStartHour |
| `pulse.daily_focus` | **DEEP_WORK** | productiveSeconds, activeSeconds, focusBlocks, contextSwitches, **productiveRatio (W8)**, **tamperRatio (W8)**, distractionBurstMinutes, tamperMinutes |
| `pulse.daily_hygiene` | **DEVICE_HYGIENE** | defenderEnabledRatio, firewallEnabledRatio, bitlockerEnabled, rebootPendingDays, unsupportedOs, criticalPatchCount, importantPatchCount |

### App classifier (Wave 8 audit)

The agent classifies each foreground-app bucket as one of
`PRODUCTIVE / COMMUNICATION / ENTERTAINMENT / PERSONAL / TAMPER /
UNKNOWN`. The DEEP_WORK scorer's `productiveSeconds` is the sum of
foreground time on `PRODUCTIVE` apps — so a wrong category silently
inverts an employee's score. Wave 8 expanded the rule set and added
**104 unit tests** in `windows-agent/src/classifier.test.ts` pinning
the categories.

Coverage:

- **IDEs + editors**: VS Code, Cursor, Windsurf, Zed, JetBrains (Idea,
  PyCharm, WebStorm, GoLand, Rider, CLion, PhpStorm, RubyMine, AppCode,
  DataGrip), Visual Studio, Sublime, neovim, emacs, Xcode, Android
  Studio.
- **Terminals**: Windows Terminal, PowerShell, pwsh, cmd, bash (Git
  Bash, WSL Ubuntu/Debian/Kali), Alacritty, WezTerm, Hyper, Tabby,
  ConEmu, Warp, Kitty.
- **API + DB**: Postman, Insomnia, Bruno, DBeaver, DataGrip, TablePlus,
  HeidiSQL, pgAdmin, Navicat, MongoDB Compass, Redis Insight.
- **Office + creative**: Word, Excel, PowerPoint, OneNote, Visio,
  Figma, Photoshop, Illustrator, Premiere, After Effects, InDesign,
  Lightroom, Blender, AutoCAD, Fusion 360.
- **Notes + PM**: Obsidian, Notion, Linear, Asana, Trello, Monday.
- **Source control + containers**: GitHub Desktop, GitKraken,
  Sourcetree, Fork, SmartGit, Docker Desktop, Rancher Desktop, Podman,
  Lens.
- **AI / LLM**: ChatGPT, Claude, Copilot, Gemini, Perplexity, Ollama
  (desktop) — plus web variants (`chat.openai.com`, `claude.ai`,
  `gemini.google.com`, `perplexity.ai`, `v0.dev`, `bolt.new`,
  `lovable.dev`, `cursor.com`, `replit.com`, `codesandbox.io`,
  `stackblitz.com`).
- **Cloud + deploy**: vercel.com, netlify.com, render.com,
  railway.app, heroku.com, fly.io, cloudflare.com, console.aws, Azure
  portal, console.cloud.google. Plus observability: Sentry, Datadog,
  New Relic, Honeycomb.
- **Indian streaming distractions** (since the team is in India):
  jiocinema, sonyliv, zee5, voot, mxplayer, sunnxt, altbalaji,
  erosnow, jiosaavn, gaana, wynk.
- **Tamper tools**: caffeine, mousejiggler, moveit, keepalive,
  awakemate, kshutdown, autohotkey, jiggler, amphetamine,
  insomniaapp, stayawake, nosleep, wigglemymouse, automousemover.
  Tamper rule wins **every other rule** (highest precedence).

LinkedIn is intentionally `PERSONAL` (social scroll). If a role
genuinely uses LinkedIn for recruiting, the SUPER_ADMIN can see the
breakdown drawer and adjust.

---

## R5 universal weights + thresholds

These are the production-default values. Seeded into
`universal_weight_sets` on first boot (idempotent — only inserts when
the table is empty and a SUPER_ADMIN exists).

```
STANDUP        13%
EXECUTION      22%
CODE           10%
COMMUNICATION  10%
PRESENCE       18%
DEEP_WORK      22%
DEVICE_HYGIENE  5%
                = 100%

Band thresholds (composite 0-100):
  HIGH   ≥ 75
  MEDIUM 40-74
  LOW    <40

Composite formula:
  composite = Σ over active signals: applied_weight[s] × signal_score[s]
              − 5 × cross_signal_gaming_flags_count
              clamped to [0, 100]
```

Renormalisation kicks in when a signal isn't yet ingested for a
window — the worker drops its weight from the denominator so the
composite stays interpretable as 0–100.

---

## Access policy (R5 lockdown)

> **Founder directive 2026-05-29:** "remember only super admin has
> access to all these metrics right?, make sure only super admin is
> allowed"

This **overrides design Premise P6** (employees seeing their own
composite on TodayPage). The new policy: composite scores, per-signal
sub-scores, raw `productivity_events`, weight sets, dispute records
— **none** of these are visible to any user other than SUPER_ADMIN.
No `/me/productivity` endpoint. No employee self-view.

### Defensive layers

1. **`requireProductivityScoreAccess`** middleware on every productivity
   route. Returns 403 with a distinct code `PRODUCTIVITY_SCORE_FORBIDDEN`
   so attempted cross-employee score peeks show up clearly in log
   search (vs. generic role-check 403s).
2. **`requireRoles('SUPER_ADMIN')`** AND **`authenticate`** before
   the named gate — triple-gated, belt-and-braces. A future refactor
   that drops one layer doesn't open the data.
3. **`assertProductivityScoreAccess`** service-layer guard for
   non-Express contexts (background workers, MCP tools, test
   harnesses). Throws `ProductivityScoreAccessError` with the same
   code and status.
4. **Tripwire tests** in `requireProductivityScoreAccess.test.ts` pin
   the gate to SUPER_ADMIN across every other role enum value.
   Loosening the gate later is a deliberate code change, not a silent
   drift.
5. **Comments** at the top of `compositeScorer.ts`,
   `productivityOutbox.ts`, and `scorers/types.ts` reference the
   policy. Any future engineer adding a read path sees the directive.

---

## API surface — all SUPER_ADMIN-only

```
GET    /api/v1/admin/pulse/scores                              wave 5 ✅
GET    /api/v1/admin/pulse/scores/summary                      wave 7 ✅
GET    /api/v1/admin/pulse/scores/:userId                      wave 5 ✅
GET    /api/v1/admin/pulse/scores/:userId/breakdown            wave 5 ✅
GET    /api/v1/admin/pulse/weights                             wave 5 ✅
GET    /api/v1/admin/pulse/observability                       wave 5 ✅
POST   /api/v1/admin/pulse/scores/:userId/recompute            wave 5 ✅
POST   /api/v1/admin/pulse/scores/recompute-all                wave 7 ✅

PATCH  /api/v1/admin/pulse/weights                             deferred (DB seed for v1)
POST   /api/v1/admin/pulse/time-off                            deferred
GET    /api/v1/admin/pulse/disputes                            deferred
PATCH  /api/v1/admin/pulse/disputes/:id                        deferred
DELETE /api/v1/admin/users/:id/productivity-data               deferred (GDPR right-to-be-forgotten)
```

---

## The Reports page (the only UI surface)

Route: **`/pulse/reports`** (sidebar entry "Reports" in the
SUPER_ADMIN-only group).

Three tabs:

1. **Scores** — sortable list of every active employee at one cadence
   (Daily / Weekly / Monthly). Per row: avatar, name, email, composite
   meter (colour-coded by band), band badge, window, event count,
   flags. Includes: search by name/email, sort by composite/name,
   **Export CSV**, **Recompute all** team button. Click any row →
   audit drawer.
2. **Breakdown drawer** — per-employee deep dive. Composite + the 7
   sub-scores (each with applied weight + raw breakdown grid + gaming
   flags) + up to 500 contributing `productivity_events`. Per-employee
   **Recompute now** button skips the 60s debounce.
3. **Weights** — R5 percentages in a 4-column grid, HIGH/LOW threshold
   pills, change-note history (last 20 changes).
4. **Worker health** — outbox depth, worker lag, compute p95, malformed
   weights — each card with a green/amber status icon. Plus a
   compute-duration histogram (samples / mean / p95 / max) and the
   last-cycle timestamp.

Above every tab: a **persistent system-status strip** that shows
"Pipeline healthy / Outbox X / Lag Ys / Last cycle Z" so a stuck
worker is visible without having to switch tabs.

---

## Observability — the metrics the worker emits

The recompute worker exposes a snapshot via
`GET /admin/pulse/observability`:

| Metric | Alert threshold |
|---|---|
| `scoreRecomputeWorker.lag_seconds` | > 5 min for > 10 min |
| `productivityEvents.outbox_depth` | > 1,000 unprocessed rows |
| `productivityEvents.reconciliation_inserts` (GitHub) | > 10 / day |
| `compositeRecompute.duration_p95_ms` | > 2,000 ms for > 30 min |
| `compositeScore.malformed_weights` | > 0 (weights row failed validation) |

The Reports page → Worker health tab surfaces all of these with
status icons. No need to SSH into Railway logs.

---

## Production rollout (5 steps)

1. **Railway → backend service → Variables**: add
   `FEATURE_PULSE_COMPOSITE_SCORE_BETA=true` and redeploy.
2. **Verify the worker booted**: hit
   `GET /api/v1/admin/pulse/observability` (SUPER_ADMIN session) or
   open Reports → Worker health. `workerEnabled` should read `true`
   and `lastCycleAt` should advance every 5 seconds.
3. **Trigger the first backfill**: Reports → Scores → "Recompute all".
   Reads the last 30 days of `productivity_events` (already emitting
   since Waves 1–4) and produces one DAILY + WEEKLY + MONTHLY row per
   active employee. Idempotent.
4. **Calibration pass** (founder): walk through the team's
   sealed-envelope predictions vs. actual composites (see Calibration
   section below). Adjust weights via DB seed if needed.
5. **Kill it fast** if something goes wrong: set the env var to
   `false` and redeploy. Worker stops, score rows stay in the DB for
   audit, Reports tab shows the "Productivity scoring is off" empty
   state.

### Dev seed for local testing

```bash
bun run backend/scripts/seedDevProductivityEvents.ts
```

Refuses to run with `NODE_ENV=production`. Emits 30 days × 7 signals
× 10 EMPLOYEE-role users (Wave 13 filtered out CLIENTs) so the
Reports page renders end-to-end on a fresh local DB. After running
it, hit "Recompute all" in the UI to backfill scores.

### Wiping the dev seed (before flipping the prod flag)

If synthetic events ever ended up in production — e.g. someone ran
the dev seed during a staging-to-prod migration, or you used the
seed to dry-run the system before going live — clean them up with:

```bash
# Dry-run first (no DB changes)
bun run backend/scripts/wipeDevProductivityEvents.ts

# Apply locally
bun run backend/scripts/wipeDevProductivityEvents.ts --apply

# Apply on production (three flags required — intentional friction)
NODE_ENV=production bun run backend/scripts/wipeDevProductivityEvents.ts \
  --apply --allow-production
```

The script identifies synthetic events by `sourceId LIKE 'dev-seed-%'`
(the seed marks every event with that prefix; real events from
GitHub webhooks, clock sessions, daily updates etc. have legitimate
UUID / delivery-id source IDs that cannot collide with this
pattern). It runs inside one transaction so a mid-delete crash
leaves the DB consistent. After the wipe, the worker repopulates
scores from the real event stream on the next recompute cycle.

---

## Calibration (founder pre-launch task)

Before turning the flag on in production:

1. **Sealed envelope**: pick 3 employees you have strong opinions
   about. Write down what their monthly composite score *should* be
   in your gut. Compare to what the system produces. If wildly off →
   the **weights or guards are wrong**, not the framework.
2. **Look at the breakdown drawer** for those 3 people. Which sub-
   score is dominating? Is that the right one? Is a gaming guard
   misfiring (low STANDUP because the body-too-short threshold is
   wrong)?
3. **Tune via DB seed**, not via UI. Wave 8 keeps the PATCH endpoint
   deferred deliberately — changing weights is a deliberate act that
   should leave a SQL migration trail, not a click trail.

---

## Known limitations (honest list)

For an Exargen-AI-sized team on a single Railway service today, this
is appropriate. For a 100+ person company, these are the next rings
to close:

| Gap | Why it matters | Status |
|---|---|---|
| **No leader election on the worker** | Single process. If you scale past 1 backend instance, two workers race for events (idempotent upserts mean no double-writes, but wasted compute). | Documented in `recomputeWorker.ts` |
| **No audit log of who VIEWED scores** | SUPER_ADMIN can peek silently. HR-grade systems need immutable "X viewed Y's breakdown at T" trail. | Not built |
| **No dispute / appeal workflow** | If an employee challenges their score, no place to record/override. | Deferred in design |
| **No GDPR right-to-be-forgotten endpoint** | `DELETE /admin/users/:id/productivity-data` listed in design, not yet built. | Deferred |
| **UTC only, no per-user TZ** | India team's "today" is bucketed against UTC midnight → ~5.5h shift. | Documented limitation |
| **Working days = Mon–Fri, no holiday calendar** | No PTO subtraction, no Indian public holidays. Employee on Diwali looks like they "missed standup". | Documented |
| **In-memory observability** | `productivityMetrics` is process-local. Resets on every deploy. Two instances → Health tab only shows one. | Documented "no Prometheus dependency yet" |
| **No structured logging / alerting integration** | `console.error` to Railway logs. No PagerDuty/OpsGenie hook for the alert thresholds the doc lists. | Not built |
| **No data retention enforcement** | Doc says "13 months raw, then null rawPayload." No cron does that. | Not built |
| **No backfill / score replay tool** | If you change a weight, you have to manually trigger recompute-all. | "Recompute all" button covers this for one weight set; replaying historic windows still manual |
| **No multi-tenancy** | Single-tenant assumption. Doc says "+1 week to backfill `tenantId` later." | Documented |
| **Weight editing is DB-only** | No PATCH endpoint, no UI. | Deferred deliberately — calibration is a SQL-trail act |
| **Tamper detection is binary at the agent** | Wave 8 made the *penalty* proportional, but the *detection* (`isTamperTool` pattern match) is still all-or-nothing. A real anti-cheat would also look at input distribution + window-title volatility. | Documented |

---

## File map

```
backend/
  prisma/
    schema.prisma                                 # ProductivityEvent, EmployeeProductivityScore, UniversalWeightSet, EmployeeProfile
    migrations/20260529160000_pulse_composite_score_foundation/
    migrations/20260529170000_pulse_code_signal/
  src/
    handlers/pulseScore.handler.ts                # 8 SUPER_ADMIN endpoints
    routes/pulseScore.routes.ts                   # triple-gated routes
    middleware/requireProductivityScoreAccess.ts  # R5 lockdown gate
    lib/productivityOutbox.ts                     # `emitProductivityEvent(s)` writers
    services/
      dailyUpdate.service.ts                      # STANDUP emit
      task.service.ts                             # EXECUTION emit
      pulseGithubWebhook.service.ts               # CODE emit
      comment.service.ts                          # COMMUNICATION emit
      clockSession.service.ts                     # PRESENCE (clock) emit
      deviceTelemetry.service.ts                  # PRESENCE + DEEP_WORK + DEVICE_HYGIENE emit
    scoring/
      scoreCadences.ts                            # DAILY/WEEKLY/MONTHLY window helpers
      computeForUser.ts                           # per-user orchestrator
      compositeScorer.ts                          # R5 weighted dot product
      observability.ts                            # in-memory metrics
      recomputeWorker.ts                          # 5s poll, 60s debounce, idempotent upsert
      scorers/
        standup.scorer.ts
        execution.scorer.ts
        code.scorer.ts
        communication.scorer.ts
        presence.scorer.ts
        deepWork.scorer.ts
        deviceHygiene.scorer.ts
    seed/seedUniversalWeights.ts                  # idempotent R5 seed
  scripts/seedDevProductivityEvents.ts            # dev-only synthetic events
  scripts/wipeDevProductivityEvents.ts            # production-safe cleanup of dev-seed events

frontend/
  src/
    api/pulseScore.ts                             # SUPER_ADMIN-only API client
    pages/admin/PulseReportsPage.tsx              # Scores / Weights / Worker health
    components/pulse/ScoreBreakdownDrawer.tsx     # audit-trail drill-down

windows-agent/
  src/
    classifier.ts                                 # appName + windowTitle → category
    tamperPatterns.ts                             # tamper-tool regex list (Wave 8 split-out)
    collectors.ts                                 # PowerShell shellouts for posture / patches / etc
    api.ts                                        # snapshot + heartbeat client
    index.ts                                      # StateTimeAccumulator + loop()

shared/src/types/productivityScore.ts             # PRODUCTIVITY_SIGNALS, UNIVERSAL_WEIGHTS_R5,
                                                  # CompositeScoreDTO, ScoreBreakdownDTO, etc

docs/pulse/
  00-OVERVIEW.md                                  # this file
  01-architecture.md                              # device-side architecture (pre-scoring)
  02-installation-and-operator-guide.md           # agent install + operator playbook
  04-productivity-scoring.md                      # canonical design doc + wave log
```

---

## Quick links

- **Design doc**: `docs/pulse/04-productivity-scoring.md`
- **Agent architecture**: `docs/pulse/01-architecture.md`
- **Operator install guide**: `docs/pulse/02-installation-and-operator-guide.md`
- **Employee onboarding guide** (the file your team installs from): `docs/pulse/06-employee-onboarding-guide.md`
- **Employee rollout kit** (email templates + printable summary + admin checklist for the deployment day): `docs/pulse/07-employee-rollout-kit.md`
- **Production rollout**: see "Production rollout" section above
- **Calibration**: see "Calibration" section above
