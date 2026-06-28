# Lumey — Enterprise-Grade Plan (internal-useful → externally-sellable)

> Principal-engineer plan, **verified against the repo** (not assumed). Three
> model options are first-class throughout: **(1) local Ollama/llama.cpp**,
> **(2) open-source LLM self-hosted on your server (vLLM/TGI)**, **(3) frontier
> API plug-in** — all behind the one `ModelClient` seam. Local/self-hosted is the
> default; frontier is a controlled, optional route.

---

## 1. Current State Assessment

### Genuinely strong (preserve)
- **Agent runtime, in-house, behind two seams.** `RuntimeAdapter` (`reference`
  simulator + `native`) and `ModelClient` (OpenAI-compatible, local/self-hosted/
  frontier). The `native` loop is **capability-complete**: ToolRunner+Sandbox
  (git worktree, path-contained, shell-free bounded exec, guardrails),
  ContextEngine (prefix-stable + compaction + **semantic memory/RAG** via local
  embeddings), Outcomes (self-grade→revise), multi-agent `delegate`. Files:
  `backend/src/modules/agent-runtime/`.
- **Run model + lifecycle.** `AgentRun`/`RunStep`/`RunEvent`, 8-state machine
  incl. `AWAITING_INPUT`/`BLOCKED` (defined), token/cost capture, **background
  execution** + adapter-aware cancel + restart reaper (`runExecutor.ts`).
- **GitHub:** real `open_pr` (push + REST), GitHub **App installation-token**
  auth, PR↔task linking on the existing `TaskExternalLink` (kind `GITHUB_PR`) via
  webhooks (`githubIntegration.service.ts`, `taskPullRequestLink.service.ts`).
- **SDK:** schema-first TS + generated Python, drift-guarded, idempotent,
  `runs.events` (cursor-resumable).
- **Enterprise hygiene already done** (2026-06-01 audit): pino structured logging
  + redaction, security-event logging, `/ready`, graceful shutdown, JWT alg pin,
  rate limiting (`middleware/rateLimiter.ts`), **gitleaks CI** (`.github/workflows/ci.yml`),
  helmet/HSTS/CSP/CORS, hashed device keys, no leaked secrets.
- **Kanban + RBAC + Activity audit log** (`Activity` model, `activity.service.ts`),
  role-based UI (admin/pm/engineer/client), an **admin attention inbox**
  (`pages/admin/TriageInboxPage.tsx`) — a reusable inbox pattern.

### Exists but thin / partially productized
- **Run UI = `components/tasks/RunsSection.tsx`** — start a run + see the step
  trace, **but polled** (no live stream) and **per-task only** (no console).
- **Run controls = cancel only.** Start + cancel exist (`agentRun.routes.ts`); no
  pause/resume/redirect.
- **`AWAITING_INPUT`/`BLOCKED` states exist but are dead ends** — no entity,
  endpoint, or UI to *raise* a clarification or *answer* it. The state is defined;
  the workflow is not.
- **PR linkage exists but is flat** — `TaskExternalLink`, not a run-scoped
  `run→commit→PR→checks→merge` graph. **No CI check ingestion.**
- **Audit log lacks actor type** — `Activity` has `userId`/`action` but no
  `actorType`, so "what did the *agents* do this week" isn't directly answerable.

### Missing (confirmed by code search)
- **No SSE/WebSocket streaming** (`sseHub`/`EventSource`/`/events/` → 0 hits). The
  v1 board-SSE did **not** survive the lean-down. The trace is polled.
- **No HITL inbox** (clarifications/approvals), **no run pause/resume/redirect**,
  **no model routing policy**, **no per-agent/per-project policy engine**, **no
  persistent budget/circuit-breaker** (the loop has only in-memory step/token
  caps), **no provenance/audit receipts**, **no fleet dashboard**, **no run-scoped
  SDLC graph entities** (`RunCommit`/`RunPullRequest`/`RunCheck` → 0 hits).
- **README is stale** — still "Exargen Command Center… internal PM platform" with
  leave/CMS; references removed services. It **undersells the agentic product
  entirely** and must be rewritten.

### Differentiators to preserve at all costs
1. **Kanban-native agent execution** (agents and humans on one board; the
   done-gate keeps a human accountable).
2. **Sovereign / self-hosted model strategy** behind the `ModelClient` seam (the
   3-option router).
3. **The in-house runtime + immutable trace** (no vendor agent SDK).

---

## 2. Product Gap Map (current → required)

| Area | Current | Required (enterprise) |
|---|---|---|
| **Agent runtime** | capability-complete native loop | + per-run policy injection (budgets/tools/model from `AgentPolicy`); pause/resume hooks |
| **Agent ops visibility** | polled per-task step list | **live SSE trace + searchable replay**; an **Agent Ops Console** across runs |
| **Human-in-the-loop** | review gate at end (AWAITING_REVIEW) | **mid-run clarifications + approval gates** + a **HITL Inbox**; `AWAITING_INPUT` actionable |
| **GitHub / SDLC** | flat PR↔task link | **run→artifact→commit→PR→check→review→merge graph**; `check_run` webhook ingestion |
| **Observability** | pino + Activity log | + **run-scoped event store with replay/search**, cost/latency/turn metrics, per-agent rollups |
| **Governance/safety** | guardrails + in-loop budgets | **AgentPolicy** (tools/model/approval) + **Budget + circuit breaker** + **audit receipts** + `actorType` |
| **Model routing** | env picks one model | **RoutingPolicy**: local → self-hosted → frontier (controlled fallback), per-project/per-task-type |
| **Fleet/orchestration** | single run, in-process | **Fleet dashboard** (live runs, queue, agents) + (later) a durable job queue |
| **Client transparency** | partial token redaction | **client-safe serialization + redaction rules** (`serializeForViewer`), per-deliverable masking |
| **Enterprise readiness** | strong hygiene + CI | + **audit export**, provenance, SSO/SCIM (later), security posture doc, SBOM/dep-scan |

---

## 3. Target Product Shape (concrete workflows)

- **PM sees:** the board, plus on a task — "Run with agent (local model)", a live
  run card (status, current step, tokens/cost, the open PR + check status), and a
  **HITL Inbox badge** when an agent needs a decision. They approve scope, not code.
- **Engineer sees:** the run trace **streaming live** (plan → edit `auth.ts` →
  `npm test` ✅ → opened PR #123 → checks running). They can **pause**, **redirect**
  ("don't touch the migration"), or **answer a clarification** inline. The PR lands
  in their normal GitHub review flow with a **provenance receipt** ("authored by
  agent *lumey-coder* on *qwen2.5-coder:7b*, run `r_…`, policy `default`").
- **Reviewer sees:** a PR with the **run→commit→check graph** attached, the
  acceptance-criteria self-grade, and a one-click "view full replay." Merge stays
  human.
- **Admin sees:** the **Agent Ops Console** (all runs, filter/search, drill into
  replay), the **Fleet dashboard** (live runs, queue depth, per-agent cost/error
  rate), the **Policy screen** (per-agent/project: allowed tools, model route,
  budget, approval-required actions), and **audit export**.
- **Client sees:** only client-visible, **redacted** progress — a human-owned
  deliverable card; agents render as "Internal team", no model/run internals.

---

## 4. Phased Implementation Plan (6 phases)

### Phase 1 — Glass Cockpit (live trace + run controls)
- **Goal:** make a run observable and controllable *while it runs*.
- **Why:** today a run is a mid-flight black box (polled, cancel-only) — the #1
  gap for both internal use and the "human stays in control" promise.
- **User outcome:** watch a run stream live; pause/resume/cancel from the task card.
- **Backend:** an in-process **run event hub** + `GET /tasks/:id/runs/:runId/stream`
  (SSE, cookie-auth + Origin + `taskAccess`, **signal-only**, reuse the
  `run.*` bus facts already emitted by `agentRun.service`). `pauseRun`/`resumeRun`
  in `runOrchestrator` (cooperative: the `LoopController` checks a pause flag at
  turn boundaries — same mechanism as the existing abort signal).
- **Schema:** add `PAUSED` to `RunStatus` (+ lifecycle edges RUNNING↔PAUSED).
- **API/events:** SSE stream; `POST .../pause`, `POST .../resume`. Internal:
  reuse `run.step.recorded` / `run.transitioned`.
- **Frontend:** upgrade `RunsSection` to subscribe via `EventSource`; add
  pause/resume/cancel buttons; a live "current step" + token/cost meter.
- **Runtime:** `LoopController` honors a `shouldPause()` check between turns.
- **Tests:** SSE auth/gating, pause→resume resumes from transcript, lifecycle edges.
- **Rollout:** behind `agent-runtime` entitlement; ship to the team first.
- **Done:** an engineer watches a live run and pauses/resumes it from the board.

### Phase 2 — Human-in-the-Loop (clarifications + approvals + Inbox)
- **Goal:** make `AWAITING_INPUT` and risky actions a two-way human gate.
- **Why:** agents must ask, not guess; risky actions must be approved. Core to
  governance and trust.
- **User outcome:** an agent asks a question / requests approval; a human answers
  from the **HITL Inbox**; the run resumes.
- **Backend:** `RunClarificationRequest` + `RunApprovalRequest` entities + service;
  a `request_clarification` / `request_approval` tool (and a guardrail that routes
  *approval-required* actions — e.g. `open_pr`, destructive `bash` — through an
  approval gate). Resolving an item transitions the run RUNNING and injects the
  answer into the transcript.
- **Schema:** the two entities (below, §6); link to `AgentRun`.
- **API/events:** `GET /inbox` (open items for me/my projects), `POST
  .../clarifications/:id/answer`, `POST .../approvals/:id/(approve|reject)`;
  events `clarification.requested`, `approval.requested`, `…resolved`.
- **Frontend:** **HITL Inbox** page (extend the `TriageInboxPage` pattern) + a
  task-card "Needs your input" affordance + the answer/approve modals.
- **Runtime:** new tools; the loop parks at `AWAITING_INPUT`/approval and resumes
  on resolution.
- **Tests:** clarify round-trip, approval gate blocks `open_pr` until approved,
  inbox scoping (RBAC + project).
- **Done:** an agent asks "which auth lib?", a human answers, the run continues.

### Phase 3 — SDLC Graph & GitHub Transparency
- **Goal:** first-class **run → artifact → commit → PR → check → review → merge**.
- **Why:** this is the GitHub-native delivery visibility that beats monday/Asana
  and matches Copilot — and it's the auditable spine of "what did the agent ship."
- **User outcome:** a run card shows the diff stat, the commit sha, the PR, **live
  check status**, and review state — one chain.
- **Backend:** populate `RunArtifact`/`RunCommit`/`RunPullRequest`/`RunCheck` from
  the runtime's `git_commit`/`open_pr` tools; ingest **`check_run`/`check_suite`/
  `pull_request` webhooks** in `githubIntegration.service.ts` and attach to the run
  (extend `processPullRequestEvent`).
- **Schema:** the four entities (§6), linked `AgentRun → RunPullRequest → RunCheck`;
  keep `TaskExternalLink` as the task-facing projection.
- **API/events:** `GET /tasks/:id/runs/:runId/graph`; inbound `check_run` webhook;
  events `run.commit.recorded`, `run.pr.linked`, `run.check.updated`.
- **Frontend:** a **PR/check panel** on the run view + the task card; a small
  pipeline widget (commit → PR → checks → review).
- **Tests:** webhook → RunCheck attach; graph assembly; idempotent on replay.
- **Done:** the run card shows the PR with green/red checks, updating live.

### Phase 4 — Governance, Safety & Provenance
- **Goal:** policy-driven, budgeted, attributable agents.
- **Why:** the enterprise sell. No enterprise adopts ungoverned autonomous agents.
- **User outcome:** admins set per-agent/project policy (tools, model route, budget,
  approval-required); every run carries a tamper-evident **receipt**.
- **Backend:** `AgentPolicy` + `Budget` entities; **enforce in `runOrchestrator`/
  `native` adapter** (inject allowed-tools subset, model route, budget into the
  loop; a **circuit breaker** trips a run/agent over budget or error-rate). Add
  `actorType` to `Activity`; emit a `RunReceipt` (run id, agent, model, policy,
  inputs hash, artifacts, approvals) at terminal.
- **Schema:** `AgentPolicy`, `Budget`, `RunReceipt` (§6); `Activity.actorType`.
- **API/events:** `GET/PUT /agents/:id/policy`, `GET /projects/:id/budget`,
  `GET /runs/:id/receipt`; `budget.exceeded`, `breaker.tripped`.
- **Frontend:** **Policy screen** (admin); a receipt view on the run + PR.
- **Runtime:** the loop reads tools/model/budget from the resolved policy (not env
  alone); budget metering on each turn.
- **Tests:** policy restricts a tool; budget trips the breaker; receipt completeness.
- **Done:** an over-budget run halts with a breaker event + a receipt.

### Phase 5 — Fleet & Model Routing (3 options)
- **Goal:** operate many runs/agents; route across local → self-hosted → frontier.
- **Why:** scale + the sovereign-model differentiator, productized.
- **User outcome:** a **Fleet dashboard**; per-project model strategy with a
  controlled frontier fallback.
- **Backend:** a `RoutingPolicy` resolver in `runtime/model/` (extend
  `modelClientFromEnv` → `resolveModelClient(policy, taskType)`): order **local →
  self-hosted → frontier**, with health-check + fallback rules; a fleet read API
  (active runs, queue, per-agent rollups from `AgentRun`/`RunReceipt`).
- **Schema:** `ModelRoute` config on `AgentPolicy`/project (json); reuse
  `ProjectGitHubIntegration`-style per-project config.
- **API/events:** `GET /fleet/overview`, `GET /fleet/runs?filter`; model-route on
  policy.
- **Frontend:** **Fleet dashboard** (live runs, queue depth, cost/error by agent),
  per-project **model settings** (3 options).
- **Runtime:** per-run model resolution from the route; record `model` + `route`
  on the run.
- **Tests:** route falls back local→self-hosted→frontier; fleet rollups.
- **Done:** a project runs local-first with a frontier fallback, visible in Fleet.
- ⚠️ **Note:** true fleet *scale* needs a **durable job queue** (replace in-process
  `runExecutor`); plan it here, ship the read/console first.

### Phase 6 — Enterprise Packaging
- **Goal:** make it buyable.
- **Backend/devex:** **audit export** (NDJSON of Activity+receipts), **SBOM +
  dependency scan** in CI (extend `ci.yml`; gitleaks already there), security
  posture doc, redaction/client-safe `serializeForViewer` boundary, **rewrite the
  README/PRODUCT** to the agentic story, `openapi.routes.ts` published for the SDK.
- **Defer to demand:** SSO/SCIM, multi-tenant isolation, on-prem installer,
  SOC2 evidence collection.
- **Done:** a one-click audit export + an honest security posture doc + accurate README.

---

## 5. Recommended First Build Sequence (vertical slices, in order)

1. **SSE live trace** (`GET .../stream`) + `RunsSection` subscribes. *Smallest
   slice that changes the feel — turns the black box into a window.*
2. **Run pause/resume** + the `PAUSED` state + buttons. *Control follows visibility.*
3. **Clarification round-trip** (`RunClarificationRequest` + `request_clarification`
   tool + answer endpoint + a minimal inbox). *Makes `AWAITING_INPUT` real.*
4. **Approval gate on `open_pr`** (`RunApprovalRequest` + gate in the finalize
   path). *First governance win, high trust value, small.*
5. **SDLC graph MVP** (`RunPullRequest` + `RunCheck` + `check_run` webhook +
   PR/check panel). *The GitHub transparency differentiator.*
6. **`actorType` on Activity** + a **RunReceipt** at terminal. *Attribution +
   provenance, tiny but enterprise-critical.*
7. **AgentPolicy + Budget MVP** (allowed tools + token/cost budget + breaker),
   enforced in the adapter. *Then the Policy screen.*

> Each is one PR-sized vertical slice (schema + service + 1 endpoint/event + 1 UI
> affordance + tests). Infrastructure (job queue, full policy DSL) waits.

---

## 6. Data Model Plan (new entities — only the justified ones)

All link to the existing `AgentRun` (which has `taskId`, `agentId`, `adapterId`,
`model`, token fields). Reuse `User`/`Project`/`TaskExternalLink`.

| Entity | Purpose | Connects to |
|---|---|---|
| **RunClarificationRequest** | a question the agent needs answered (`AWAITING_INPUT`) | `runId→AgentRun`, `askedBy=agent`, `answeredBy→User`, `question`, `answer`, `status` |
| **RunApprovalRequest** | a risky action needing human approval (open_pr, destructive bash) | `runId`, `action`, `payload Json`, `requestedAt`, `decidedBy→User`, `decision`, `reason` |
| **RunArtifact** | a file the run created/changed (diff stat) | `runId`, `path`, `changeType`, `additions`, `deletions` |
| **RunCommit** | a commit the run made | `runId`, `sha`, `branch`, `message` |
| **RunPullRequest** | the run's PR (run-scoped; `TaskExternalLink` stays the task projection) | `runId`, `externalId` (`owner/repo#n`), `url`, `state`, `mergedAt` |
| **RunCheck** | a CI check on the PR (from `check_run` webhook) | `runPullRequestId`, `name`, `status`, `conclusion`, `detailsUrl` |
| **AgentPolicy** | per-agent (and/or project) governance | `agentId`/`projectId`, `allowedTools String[]`, `modelRoute Json`, `requireApprovalFor String[]`, `maxTokens`, `maxCostUsd`, `maxSteps` |
| **Budget** | spend ceiling + window for an agent/project | `scope`, `windowStart`, `tokenLimit`, `costLimitUsd`, `spentTokens`, `spentCostUsd`, `breakerTrippedAt` |
| **RunReceipt** | tamper-evident provenance at terminal | `runId`, `agentId`, `model`, `route`, `policySnapshot Json`, `inputsHash`, `artifactsHash`, `approvals Json`, `signedAt` |

Also: **`Activity.actorType`** (`HUMAN`/`AGENT`/`SYSTEM`) — one column, unlocks
"what did the agents do" and per-actor audit.

> **Not yet justified:** a generic `Policy` rules-DSL, multi-tenant `Org`/billing,
> a separate event-store table (the existing `RunEvent` + an SSE projection is
> enough until search needs it).

---

## 7. API & Event Plan

**REST (new):**
- `GET  /tasks/:id/runs/:runId/graph` — the SDLC graph for a run.
- `POST /tasks/:id/runs/:runId/(pause|resume)` — run controls.
- `GET  /inbox` · `POST /clarifications/:id/answer` · `POST /approvals/:id/(approve|reject)`.
- `GET  /runs/:id/receipt` · `GET /audit/export?from&to` (NDJSON).
- `GET/PUT /agents/:id/policy` · `GET /projects/:id/budget` · `GET /fleet/overview` · `GET /fleet/runs`.

**SSE/WebSocket (new — start with SSE, matches the v1 pattern):**
- `GET /tasks/:id/runs/:runId/stream` — run steps/events (signal-only, cookie-auth).
- `GET /fleet/stream` — fleet-level run state changes (admin).

**Inbound GitHub webhooks (extend `githubIntegration.service.ts`):**
- `pull_request` (have it) → also attach to `RunPullRequest`.
- **`check_run` / `check_suite`** (new) → `RunCheck`.
- `pull_request_review` (new) → review state on the run.

**Internal domain events (extend the kernel bus; `run.*` exist):**
- `run.paused`/`run.resumed`, `clarification.requested`/`.resolved`,
  `approval.requested`/`.resolved`, `run.commit.recorded`, `run.pr.linked`,
  `run.check.updated`, `budget.exceeded`, `breaker.tripped`, `receipt.issued`.

---

## 8. Frontend UX Plan

**Agent Ops Console** (`pages/admin/AgentOpsPage.tsx`, new)
```
┌ Agent Ops ─────────────────────────────────────────────┐
│ [● Live 3] [Queued 1] [Awaiting input 2] [search ____] │
│ run        task            agent     model     status  │
│ r_8f… Add logout button   coder-1  qwen7b  ● editing  │
│ r_7a… Fix auth bug        coder-1  qwen7b  ⏸ paused   │
│ r_3c… Refactor sprint svc coder-2  selfhosted ▣ AWAIT │
└────────────────────────────────────────────────────────┘  → click → live replay
```

**HITL Inbox** (`pages/InboxPage.tsx`, extend `TriageInboxPage`)
```
┌ Needs you ─────────────────────────────────────────────┐
│ ❓ r_3c (Refactor): "Use Zod or Yup for validation?"   │
│      [ Zod ] [ Yup ] [ type answer… ____ ] [Send]      │
│ ✋ r_9d (Migration): approve `bash: prisma db push`?   │
│      diff preview ▸          [Approve] [Reject + note] │
└────────────────────────────────────────────────────────┘
```

**Task-card Run panel** (upgrade `components/tasks/RunsSection.tsx`)
- Live status pill + current step + token/cost meter (SSE).
- Controls: Pause / Resume / Cancel.
- **Pipeline strip:** `commit abc123 → PR #45 → ✅ build ⏳ test → review`.

**Fleet Dashboard** (`pages/admin/FleetPage.tsx`) — live runs, queue depth,
per-agent cost/error/throughput, model-route in use.

**Policy screen** (`pages/admin/PolicyPage.tsx`) — per agent/project: allowed
tools (checkbox), model route (local/self-hosted/frontier ordering),
approval-required actions, budgets.

**Admin controls** — audit export button; receipt viewer (also linked from the PR).

---

## 9. Enterprise Readiness Plan (concrete)

- **Auditability:** `actorType` on `Activity`; **`/audit/export`** NDJSON of
  Activity + RunReceipts; every consequential action already flows through
  `activity.service`.
- **Provenance:** `RunReceipt` (run, agent, model, route, policy snapshot, inputs/
  artifacts hashes, approvals) at terminal; surfaced on the PR.
- **Redaction / client-safe:** a single **`serializeForViewer(payload, viewer)`**
  boundary (the v1 intent, not yet in lean repo) — strip `actorType`/`agent*`/run
  internals for CLIENT; agents render as "Internal team".
- **Secret handling:** already strong (hashed keys, in-memory access tokens,
  pino redaction, GitHub **App tokens** short-lived). Add: token never persisted
  in clone config (already done in `repoWorkspace.ts`).
- **Model policy:** the RoutingPolicy + per-project model settings; frontier route
  gated by policy + key presence (fails loud).
- **Approval gates:** Phase 2/4; risky tools require `RunApprovalRequest`.
- **Deployment safety:** keep graceful shutdown + `/ready` + reaper; add a job
  queue before fleet scale.
- **CI gates:** extend `.github/workflows/ci.yml` — add **SBOM + `npm audit`
  gate + dependency review** (gitleaks already present); keep coverage floors.
- **Production observability:** structured pino + request ids (have it); add
  run-level metrics (turns, latency, cost) to receipts and the fleet API.
- **Compliance readiness:** the audit export + receipts + security posture doc are
  the SOC2-evidence starting points; defer formal SOC2.

---

## 10. Exargen Team Mode vs Enterprise Mode

| Capability | Team Mode (now, 10 ppl) | Enterprise Mode (sellable) |
|---|---|---|
| Live trace + run controls | ✅ Phase 1 | ✅ |
| HITL clarifications/approvals + Inbox | ✅ Phase 2 | ✅ + SLA/escalation |
| SDLC graph + checks | ✅ Phase 3 | ✅ + branch protections policy |
| Provenance receipts + `actorType` | ✅ Phase 4 (light) | ✅ + signed/exportable |
| AgentPolicy + Budget | ✅ minimal (tools+budget) | ✅ full policy + breakers |
| Model routing (3 options) | ✅ per-project config | ✅ governed fallback + audit |
| Fleet dashboard | basic read | ✅ + durable queue at scale |
| Redaction / client-safe | ✅ (single boundary) | ✅ + per-deliverable rules |
| **Defer for team:** | SSO/SCIM, multi-tenant, audit export UI, SOC2, job-queue scale | required |

**Safe to defer now:** SSO, multi-tenancy, billing, a policy DSL, a durable job
queue (in-process is fine for ~10 people / a handful of concurrent runs).

---

## 11. Risks & Non-Goals

- **Don't build yet:** a generic policy/rules DSL (start with enforced
  knobs on `AgentPolicy`), multi-tenant/SSO/billing, a separate event-store
  (RunEvent + SSE is enough), a custom CI runner (**ingest** `check_run`, don't
  run checks).
- **Tempting but premature:** a full fleet job-queue (Bull/Temporal) before there's
  fleet load; a bespoke observability stack (extend pino + Activity first).
- **Overengineering watch:** modeling every SDLC nuance — ship commit/PR/check,
  skip exotic states; keep `TaskExternalLink` as the task projection, don't
  duplicate it.
- **Architecture risks:** **in-process `runExecutor` won't survive multi-node /
  high concurrency** — fine for the team, but a job queue is the gate to "fleet at
  scale"; **SSE in a multi-instance deploy** needs a shared bus (Redis pub/sub)
  later. Both are *known and deferred*, not accidental.

---

## 12. Final Recommendation

**Top 5 to build first:**
1. **SSE live run trace** — turn the black box into a window.
2. **Run pause/resume** + the `PAUSED` state.
3. **Clarification + approval round-trip with a HITL Inbox** (`AWAITING_INPUT`
   becomes real; approval gates `open_pr`).
4. **SDLC graph MVP** (run→commit→PR→`check_run` webhook→panel).
5. **`actorType` + RunReceipt + AgentPolicy/Budget MVP** (attribution, provenance,
   the first enforced governance).

**The one differentiator to preserve:** **kanban-native agent execution on
sovereign / self-hosted models behind the in-house `RuntimeAdapter` + `ModelClient`
seams.** It's what no competitor combines — don't dilute it by leaning on a vendor
agent SDK or making frontier the default.

**The one market weakness to close fast:** **the mid-flight black box.** Right now
you can start and cancel a run and poll a step list — that's it. monday/Copilot
feel "alive"; Lumey doesn't yet. Phases 1–2 (live trace + run controls + HITL) close
it and are the difference between a demo and a product.

---

# Immediate Coding Backlog (next 2 weeks)

Each item is one PR-sized vertical slice. Three model options
(local / self-hosted OSS / frontier plug-in) ride the existing `ModelClient` seam —
no model code changes needed for this backlog.

### Schema
- [x] `RunStatus += PAUSED` + lifecycle edges (RUNNING↔PAUSED) in `runLifecycle.ts`. ✅ P1.2
- [x] `RunClarificationRequest` + `RunApprovalRequest` models + `ClarificationStatus`/`ApprovalStatus` enums + migrations. ✅ P2.1/P2.2
- [ ] `RunPullRequest`, `RunCheck`, `RunCommit`, `RunArtifact` models + migration.
- [ ] `Activity.actorType` enum column + backfill default `HUMAN`.
- [ ] `AgentPolicy`, `Budget`, `RunReceipt` models + migration (Phase-4 slice).

### Backend
- [x] Run **event hub** + `GET /tasks/:id/runs/:runId/stream` (SSE; single-use
      run-scoped **stream ticket** instead of cookie-auth — EventSource can't send
      a Bearer header; `taskAccess`, signal-only; subscribe to existing `run.*`
      bus facts). ✅ P1.1
- [x] `pauseRun`/`resumeRun` in `runOrchestrator.ts` + `POST .../pause|resume`
      (cooperative `PauseController` parks the loop at a turn boundary). ✅ P1.2
- [x] `runClarification.service` + `ask_human` control tool + `ClarificationController`
      (parks AWAITING_INPUT, resumes with the answer) + `GET .../clarifications` +
      `POST …/clarifications/:id/answer`. ✅ P2.1
- [x] `runInbox.service` + `GET /api/v1/inbox` — cross-task list of every run
      waiting on a human (clarifications + approvals), visibility-scoped. ✅ P2.3
- [x] `runApproval.service` + approval gate in the loop's per-call execution
      (default-gates `open_pr`, env `LUMEY_APPROVAL_TOOLS`) +
      `POST …/approvals/:id/(approve|reject)`. ✅ P2.2
- [ ] Extend `githubIntegration.service.ts`: ingest `check_run` → `RunCheck`;
      attach `pull_request` to `RunPullRequest`.
- [ ] `GET /tasks/:id/runs/:runId/graph`; `GET /runs/:id/receipt`.
- [ ] `actorType` written by `activity.service` (resolve from `req.user.userType`).

### Runtime
- [x] `LoopController` honors a pause check between turns (cooperative, reuses the
      abort plumbing). ✅ P1.2
- [x] `ask_human` control tool — the loop intercepts it and parks AWAITING_INPUT. ✅ P2.1
- [x] Approval gate in the loop's per-call execution (`runTools`): gated tools
      (default `open_pr`) park AWAITING_INPUT; approve runs, reject refuses +
      feeds the reason back. ✅ P2.2
- [ ] Native adapter populates `RunCommit`/`RunPullRequest`/`RunArtifact` from
      `git_commit`/`open_pr` results.
- [ ] Emit a `RunReceipt` on terminal in the native adapter.
- [ ] (Phase-4) read allowed-tools + budget from `AgentPolicy` in the adapter;
      trip a circuit breaker on budget exceed.

### Frontend
- [x] `RunsSection` → `EventSource` live trace (✅ P1.1) + Pause/Resume/Cancel
      buttons + "Paused" pill (✅ P1.2). *(token/cost meter still to come.)*
- [x] In-run clarification answer box + approval Approve/Reject panel in
      `RunsSection` (live). ✅ P2.1/P2.2
- [x] `InboxPage` (`/agent-inbox`) — cross-task HITL inbox with inline answer +
      approve/reject + a sidebar entry. ✅ P2.3 *(SLA/escalation + count badge still to come.)*
- [ ] Run PR/check **pipeline strip** on the task card.
- [ ] `AgentOpsPage` (admin) — runs list + filter/search + drill to live replay.
- [ ] (Phase-4) `PolicyPage` skeleton.

### Tests
- [x] SSE auth/gating (single-use ticket: mint/consume/replay→401, run-scoping,
      TTL). ✅ P1.1 *(reconnect-from-cursor still to come.)*
- [x] pause→resume resumes the live transcript (mock-model loop parks then
      continues; cancel beats pause); lifecycle edge validation. ✅ P1.2
- [x] clarification round-trip + approval gate (ask/gate → park AWAITING_INPUT →
      answer/approve/reject → resume; reject refuses + feeds reason back;
      cancel-while-waiting → CANCELLED). ✅ P2.1/P2.2
- [ ] `check_run` webhook → `RunCheck` attach; graph assembly; idempotent replay.
- [ ] `actorType` recorded for agent vs human actions; RunReceipt completeness.

### Docs / DevEx
- [ ] **Rewrite `README.md`** to the agentic Lumey story (it's stale — "Command
      Center / leave / CMS"); fix removed-service references.
- [ ] Update `PRODUCT.md` status table as phases land; keep `CHANGELOG.md` current.
- [ ] `docs/modules/AGENT-OPS.md` (the console + HITL + SDLC graph).
- [ ] Extend `.github/workflows/ci.yml`: dependency review + `npm audit` gate +
      SBOM artifact (gitleaks already present).
