# Lumey — Platform Planes & Build Plan

How the platform is layered (11 planes), what each **has today** (grounded in the lean
core), what to **add** to make it a truly agentic, top-notch product, and an
**incremental, testable build plan** that sequences it all.

> Companion to `ARCHITECTURE.md`, `V2-ENGINEERING-PLAN.md`, `FEATURE-BACKLOG.md`.
> ⭐ = the highest-leverage upgrade in that plane.

---

## Plane 1 — Identity & Access
**Today:** agents are first-class principals (`User.userType=HUMAN|AGENT`, `agentRole`,
`agentBudget*`, `agentUsers.seed`); JWT auth + `RefreshToken` (theft detection,
`tokenVersion`); RBAC (`Permission`/`RolePermission`, `permissionSync`, shared keys);
deep access middleware. Single-tenant.
**Add:**
- ⭐ Multi-tenancy + entitlements (`Tenant`, `ModuleInstallation`, `Entitlement`) — kernel foundation.
- ⭐ Agent identity hardening — scoped, short-lived, rotatable service-account tokens; credential vault; the RuntimeAdapter authenticates *as* the agent.
- ⭐ Capability + scope grants — agent may touch repo/paths/commands within a budget (agent onboarding/access).
- Graduated autonomy as policy (trust gates unattended action). Delegation / "on behalf of". Provenance-grade attribution. (SSO/SCIM later.)
**North star:** every action is by a scoped, attributable principal whose authority is least-privilege, time-bounded, and earned.

## Plane 2 — Work Management
**Today:** rich model — `Project`/`Product`/`Task` (`acceptanceCriteria`, types, statuses incl. `IN_REVIEW`), `Epic`/`Sprint`/`Milestone`/`Decision`/`Deliverable`/`CustomFieldDefinition`; dependency graph (`TaskLink` BLOCKS), `TaskSubscription`/`TaskNudge`/`TaskStatusHistory`; agents consume it via `agentNextTask` (priority/blocked/dep-graph/sprint-aware); intake via `projectIngestion` + `TriageInbox`.
**Add:**
- ⭐ Machine-checkable acceptance criteria / Definition-of-Done (maps to Claude Agent SDK Outcomes).
- ⭐ Mixed assignment — human | named agent | "any agent with capability X"; claim/reassign mid-flight.
- ⭐ Run-aware task lifecycle (queued → working → in-PR → needs-review → blocked) over `TaskStatus`.
- Work-item join (`Task ↔ Run ↔ PR ↔ Commit ↔ TestRun`); Definition-of-Ready gate; agent-proposed decomposition; readiness events on the bus; effort/size + mixed-team capacity; templates + triage-agent intake.
**North star:** every work item is a precise, ready contract with a gradeable definition of done; the board reflects live execution.

## Plane 3 — Collaboration & Comms
**Today:** threaded `Comment` (mentions, story updates); deep notification system (~20 `notify*`, `NotificationPreference`, categories, mute); `TaskSubscription`/`TaskNudge`/`Activity`; `StatusUpdate`/`recentProgress`/generic standups. Built human↔human.
**Add:**
- ⭐ Typed collaboration objects — `ClarificationRequest`/`ReviewRequest`/`ApprovalRequest`/`Handoff`/`ProgressUpdate` (stateful, tied to run+task). Comments stay as the freeform layer.
- ⭐ "Agent needs you" inbox — prioritized queue of run-blocking agent asks.
- ⭐ Dual-audience delivery — human (in-app + Slack/email/IDE) **and** a machine event channel on the bus.
- Summon an agent via @mention; structured agent run-summaries; presence/awareness; smart digest; one-tap approvals.
**North star:** a typed, stateful, dual-audience fabric — humans and agents exchange actionable requests, fully attributable.

## Plane 4 — Code & Git
**Today:** `ProjectGitHubIntegration` + `githubIntegration.service`; `TaskExternalLink` (link tasks to PRs/issues); per-project GitHub webhook for task-linking. Read/link-only.
**Add:**
- ⭐ Agent code workflow via the RuntimeAdapter (clone → edit → push → PR) — git proxy + vaulted tokens (secrets never in sandbox).
- ⭐ First-class `PullRequest`/`Commit`/`Branch` objects linked to run + task; CI/test status ingested onto cards; diff metrics.
- Secret-scan diffs before commit (`.gitleaks.toml`); branch-per-run; GitHub MCP for PR creation; multi-provider (GitLab) later.
**North star:** every code change flows through a tracked branch → commits → PR → CI → review → merge, each step linked to the run and task that produced it.

## Plane 5 — Agent Runtime & Execution  ⭐ KEYSTONE
**Today:** agent control plane (`next-task`, `knowledge-pack`, `budget-increment`), agents-as-users, IN_REVIEW human-only gate, `agentVisibility`. **No run model, no execution, no trace, no sandbox** — agents are driven externally; the platform only sees side effects.
**Add:**
- ⭐ `RuntimeAdapter` (Claude Agent SDK = adapter #1) — `startRun` / `events` / `approve` / `cancel`, normalized to OUR schema.
- ⭐ `AgentRun` / `RunStep` / `RunEvent`; sandbox (Managed Agents container; self-hosted for on-prem); the loop (plan → code → test → PR); Outcomes from the rubric; live event stream; `task_budget`; cancellation/steering.
- Pluggable 2nd adapter (OpenHands, on-prem); reproducibility pinning (prompt+context+model).
**North star:** every task an agent works becomes a first-class, observable, steerable, reproducible Run behind a vendor-neutral seam.

## Plane 6 — Observability & Cost
**Today:** `Activity` log, `TaskStatusHistory`, agent budget usage recording. Seeds, no traces/dashboards.
**Add:**
- ⭐ `RunEvent` stream as the trace → waterfall view; `TokenUsage` per step → rollups (task/project/agent/day).
- ⭐ Cost dashboards + ROI ("14 PRs · ~40h saved · $82"); replay; failure capture; cache-hit-rate metric; latency/SLA (time-to-PR); cost/anomaly alerts.
**North star:** nothing an agent does is off the record; every run is a costed, replayable trace and the org sees ROI in dollars and hours.

## Plane 7 — Knowledge & Context
**Today:** `ProjectDocument` (S3), `Decision` records, the `knowledge-pack` that already compiles project context for agents.
**Add:**
- ⭐ Knowledge graph (Postgres nodes/edges) fed by the event stream + repo/docs ingestion.
- ⭐ Context compiler — minimal-sufficient context from the graph (graph-as-context, prompt caching, differential context) = token efficiency.
- Per-project agent memory; org playbooks/skills (self-codifying from successful runs); RAG over repo/docs.
**North star:** the org's accumulated knowledge is a queryable graph that doubles as a token-efficient context compiler — agents query 3 facts, not 20 docs.

## Plane 8 — Orchestration & Fleet
**Today:** `agentNextTask` (single-agent pull); sprints/epics (manual). No orchestrator, fleet view, triggers, or multi-agent coordination.
**Add:**
- ⭐ Orchestrator agent (epic → tasks → assign — self-populating board).
- ⭐ Fleet view (all agents, live status, queue depth, utilization, who's blocked).
- Triggers (on-merge / issue / schedule → spawn); workflow templates (DAGs); specialties + capability routing; inter-agent handoff + message bus/blackboard; concurrency/queue mgmt; graduated-autonomy gating.
**North star:** the board runs itself — epics decompose, work routes to the right teammate by capability and trust, and you can see and steer the whole fleet at a glance.

## Plane 9 — Model & Inference
**Today:** `agentBudget` cost ceiling; model choice lives in the external runtime. No router/serving/telemetry.
**Add:**
- ⭐ Model router — frontier codes, local does auxiliary; route by task-type/difficulty (`ModelEndpoint`/`RoutingPolicy`).
- ⭐ Local serving (vLLM/Ollama, on-prem) + the self-calibrating **shadow router** (promote local as it catches up) + the correction→training loop.
- Per-model success metrics; BYO-model.
**North star:** every step runs on the cheapest model proven good enough for it; the on-prem model improves from the customer's own corrections; nothing is locked to one vendor.

## Plane 10 — Governance & Safety  *(woven into every plane)*
**Today:** strong security middleware (`authenticate`/`authorize`/`projectAccess`/`requireOrigin`/`stripDangerousKeys`/`rateLimiter`), idempotency, `.gitleaks.toml`, RBAC. No agent-specific guardrails/approvals/provenance.
**Add:**
- ⭐ Guardrail policy engine — allowlist of paths/repos/commands/budget per agent (from Plane 1 scope).
- ⭐ Approval gates for risky actions; secret-scan before commit; circuit breakers (cost/runaway/fleet); deadlock + poison-task escalation.
- Provenance/audit chain (line → run → model → reviewer); immutable audit log; reproducibility pinning; (SOC2 / data-residency later).
**North star:** agents act inside a least-privilege, policy-enforced blast radius; every consequential action is gated or attributable; the system can prove what happened and why.

## Plane 11 — Client Portal
**Today:** full portal (`pages/client/sections/*`: Board, Roadmap, Sprints, Decisions, Deliverables, Documents, Products, Timeline, Insights, Status, Help), client-scoped access, `clientActions`.
**Add:**
- ⭐ Agentic transparency — clients watch their feature get built by agents in real time (scoped, read-only, redacted run view).
- Client-visible PRs/decisions with the human-approval checkpoint surfaced; client approve/comment at gates; client ROI/status.
**North star:** clients don't just see status — they watch their software being built by agents, with a clear human-accountability checkpoint, building trust no static portal can.

---

# Build plan — incremental & testable

Each milestone is shippable and verified before the next. Test gate at every step:
**typecheck (both workspaces) + unit tests + the milestone's new e2e check**, then commit
and demo. We improvise from what each demo teaches.

### M0 — Kernel & module scaffolding  *(Plane infra)*
Introduce the kernel (module registry · event bus · entitlements) and a minimal `Tenant`.
Reorganize the spine into pluggable modules **incrementally** (`packages/kernel` +
`packages/modules/*`) without breaking the green baseline.
**Gate:** kernel boots, validates the dependency graph; existing 862 tests still pass; one
existing capability (e.g. comments) runs as a registered module.

### M1 — Work items become contracts  *(Plane 2 + Plane 1 scope seed)*
Machine-checkable acceptance criteria / DoD on `Task`; mixed assignment (human / agent /
any); Definition-of-Ready gate; the `Task ↔ Run` join (stub); minimal agent
capability/scope grant.
**Gate:** create a task with a rubric, assign to an agent type; the readiness gate blocks an
underspecified task; tests cover the new assignment + readiness logic.

### M2 — The agent-runtime keystone  *(Planes 5 + 6 + 4)* ⭐ the proving demo
`RuntimeAdapter` (Claude Agent SDK), `AgentRun`/`RunStep`/`RunEvent`, sandbox, the loop,
Outcomes from the rubric, **live trace on the card**, token/cost capture, PR creation +
linkage. Basic guardrails (Plane 10) start here.
**Gate (end-to-end):** assign a task → agent runs on a real repo → opens a PR + summary →
moves to IN_REVIEW; the card shows the live trace and the run's cost. **Disable the
observability module and the runtime still runs** (proves modularity).

### M3 — The human↔agent loop  *(Planes 3 + 4 review UI)*
Typed collaboration objects (`Clarification`/`Review`/`Approval`); the "agent needs you"
inbox; in-app PR review gate UI; steering (pause/cancel); optional Slack delivery.
**Gate:** agent asks a question → run blocks → human answers → run resumes; human
approves a PR in-app; the inbox prioritizes the blocking ask.

### M4 — Knowledge & token efficiency  *(Planes 7 + 6)*
Knowledge graph (Postgres) fed by the event stream; context compiler + prompt caching +
graph-as-context; ROI dashboard.
**Gate:** runs draw context from the graph; measured prompt-size + cost drop with **no
rubric-pass-rate regression**; cache-hit rate is a visible metric.

### M5 — Orchestration, fleet & client transparency  *(Planes 8 + 11)*
Orchestrator (epic → tasks → assign); fleet view; triggers; client-portal live agent
progress + approval checkpoints.
**Gate:** an epic auto-decomposes into assigned tasks; fleet view shows live agents +
queue; a client account watches live agent progress on their project.

### M6 — Model router, training loop & full governance  *(Planes 9 + 10)*
Model router (frontier + local), local serving, the shadow router, correction→training;
guardrail policy engine, approval gates, provenance chain, circuit breakers.
**Gate:** auxiliary work routes to a local model; the shadow router measures the
frontier-vs-local gap per task-type; a guardrail blocks an out-of-scope action; the
provenance chain (line → run → model → reviewer) is intact for a merged PR.

> **Safety (Plane 10)** is woven from M2 onward (basic allowlist + secret-scan) and
> completed in M6. **Identity hardening (Plane 1)** lands incrementally: tenancy in M0,
> agent scope in M1, full credential/vault in M2.

### Working rhythm
Build a milestone → run the gate → commit → demo → **improvise** (the demo reveals the
next refinement). Keep the baseline green at every commit.
