# Agent-runtime module (M2)

The keystone of the platform: an **AgentRun** is one execution of an agent
against a task. M2.1 lands the *platform-side* foundation — the data model, a
validated lifecycle, and a runtime-neutral run service that emits the trace.
The *execution* side (a RuntimeAdapter driving a real run via our in-house
runtime / a sandbox) is M2.2+, and calls the same service.

Code: `backend/src/modules/agent-runtime/` · service:
`backend/src/services/agentRun.service.ts` · lifecycle:
`backend/src/lib/runLifecycle.ts`.

## Data model

| Model | Purpose |
|---|---|
| `AgentRun` | one run: `taskId`, `agentId`, `status`, `model`, `summary`, `error`, `startedAt`/`endedAt` |
| `RunStep` | an ordered action within a run (`PLAN`/`TOOL_CALL`/`EDIT`/`COMMAND`/`TEST`/`REVIEW_REQUEST`), `(runId, seq)` unique |
| `RunEvent` | the structured **trace** stream — `type` + `payload` Json, `(runId, seq)` unique |

Runtime-neutral by design: no vendor concepts appear in these models. Migration
`20260624010000_add_agent_run_model`.

## Lifecycle (state machine)

```
QUEUED ──► RUNNING ──► SUCCEEDED                 (happy path)
              │  ├────► AWAITING_REVIEW ─► RUNNING | SUCCEEDED
              │  ├────► AWAITING_INPUT  ─► RUNNING
              │  └────► BLOCKED         ─► RUNNING
              └──► FAILED
   (any non-terminal) ──► CANCELLED
```

`lib/runLifecycle.ts` centralises legal transitions. Neither the API nor a
runtime adapter can drive a run into an impossible state — `assertTransition`
throws `ValidationError` on an illegal move (e.g. resurrecting a `CANCELLED`
run, or `QUEUED → SUCCEEDED` without doing work). Terminal states
(`SUCCEEDED`/`FAILED`/`CANCELLED`) are immutable.

## Run service

`services/agentRun.service.ts`:

| Function | What it does |
|---|---|
| `createRun({taskId, agentId, model?})` | create a `QUEUED` run; record `run.created` |
| `transitionRun(runId, to, {error?, summary?})` | validated state change; stamps `startedAt` on first `RUNNING`, `endedAt` on terminal; record `run.transitioned` |
| `appendStep(runId, {type, title, detail?})` | record a step at the next per-run sequence; record `run.step.recorded` |
| `getRun(runId)` | run + ordered steps + trace events |
| `listRunsForTask(taskId)` | a task's runs, newest first |

Every change **appends a `RunEvent`** (the trace) and **publishes a `run.*`
fact** on the kernel bus (`run.created` / `run.transitioned` /
`run.step.recorded`) — observability and the live-trace UI subscribe later
without this service knowing they exist. Sequence numbers are assigned inside a
transaction so concurrent appends can't collide on `(runId, seq)`.

## Read API (run visibility)

Scoped under the task so the existing `taskAccess` gate authorises both:

- `GET /api/v1/tasks/:id/runs` — the task's runs (summary).
- `GET /api/v1/tasks/:id/runs/:runId` — one run with steps + trace (re-checks
  the run belongs to that task).

Write paths (create/transition) arrive with the RuntimeAdapter in M2.2.

## Scope (MoSCoW)

- **Must ✅** — run model + migration; lifecycle state machine; run service
  emitting trace events + bus facts; tests.
- **Should ✅** — `agent-runtime` registered as a kernel module with read-only
  run-visibility routes.
- **Won't (this increment)** — the `RuntimeAdapter` interface + real execution
  (Claude Agent SDK / sandbox), token/cost capture, PR linkage, the frontend
  trace UI. Those are M2.2+.

## Tests

- `lib/runLifecycle.test.ts` — terminal set, happy path, forbidden moves,
  pause/resume, cancellation, illegal-transition throw.
- `services/agentRun.service.test.ts` — create/transition (timestamps + illegal
  + not-found), step sequencing, read paths.
- `modules/agent-runtime/agent-runtime.module.test.ts` — mount + entitlement
  gate (401 enabled vs 404 disabled).

## M2.2 — the RuntimeAdapter seam

The firewall between Lumey and whatever runtime executes a run (a simulator,
the Claude Agent SDK, OpenHands, a local loop). An adapter translates its
runtime's **native** execution into **our** run model via the run service — no
runtime concept (`span.*`, `tool_confirmation`, internal types) ever surfaces
above the interface. Swapping runtimes is "write a new adapter", never "rewrite
the platform".

```ts
interface RuntimeAdapter {
  id: string;
  capabilities(): { selfHosted; memory; outcomes; multiAgent };  // honest flags
  execute(ctx: RunContext): Promise<void>;   // drive QUEUED → review-park / terminal
  cancel(runId: string): Promise<void>;
}
```

- **`referenceAdapter`** (`adapters/reference.ts`) — a deterministic,
  dependency-free simulator for dev/demos/tests. It records a realistic step
  trace (PLAN → EDIT → TEST → REVIEW_REQUEST) and parks the run at
  `AWAITING_REVIEW` — exactly where a real coding agent lands after opening a
  PR. No external calls, no sandbox, no model.
- **`adapterRegistry`** — adapters self-register by id; `getAdapter(id)` resolves
  one. Adding a runtime is registering one more adapter.
- **`runOrchestrator.startRun({taskId, agentId, adapterId?})`** — the entry
  point: validates the runner is an **agent** user, resolves the adapter
  *before* creating the run (so an unknown runtime fails fast), creates the run
  (QUEUED), and hands it the task context to execute.

**Scope (MoSCoW):** Must ✅ (interface + reference adapter + registry +
orchestrator + tests) · Should ✅ (honest capabilities, agent-only enforcement)
· Won't this increment (the Claude Agent SDK adapter / real sandbox, a
start-run HTTP route + permissions, the frontend trace UI).

**Tests:** reference adapter drives the lifecycle + step trace + cancel;
registry resolve/unknown/duplicate; orchestrator creates-and-delegates,
rejects non-agents, fails fast on missing task / unknown adapter.

## M2.3 — start-run API + live run-trace UI

The write path and the human-facing view. A run can now be *dispatched* from the
product and *watched* as it executes.

**Orchestrator additions** (`runOrchestrator.ts`):

| Function | What it does |
|---|---|
| `resolveRunnerAgentId(taskId)` | pick the runner: the task assignee if it's an active agent, else the first active agent in the deployment, else `null` (no agents → caller 422s) |
| `cancelRun(runId)` | cancel a non-terminal run (→ `CANCELLED`); no-op on an already-terminal run; `NotFoundError` if missing |

**Write API** (`agentRun.routes.ts` / `agentRun.handler.ts`) — scoped under the
task, reusing the same `taskAccess` gate plus `authorizeAny('task.edit_any',
'task.edit_own')` (dispatching an agent is editing the task's work):

- `POST /api/v1/tasks/:id/runs` — resolve the runner agent and start a run;
  `201` with the run summary. `422` if the deployment has no agent to run it.
- `POST /api/v1/tasks/:id/runs/:runId/cancel` — cancel an in-flight run.

**Reference agent seed** (`seed/referenceAgent.seed.ts`) — upserts a *Lumey
Agent* (`agent@lumey.local`, `userType: AGENT`, `agentRole:
autonomous-engineer`) so a fresh deployment can dispatch a run with zero setup.
Wired into `seedDemoData`.

**Frontend** (`components/tasks/RunsSection.tsx`, on the task detail page) — an
**Agent runs** panel: a *Run with agent* button, and per-run expandable rows
showing a status pill (`Awaiting review`, `Running`, …), the ordered step trace
(Plan → Apply edits → Run tests → Open PR + request review, each with its
icon + detail), the run summary, and a *Cancel run* action while the run is
live. API/hooks: `api/agentRuns.ts`, `hooks/useAgentRuns.ts` (React Query).

Verified end-to-end against the local deployment: *Run with agent* dispatches
the reference adapter, which parks the run at **AWAITING_REVIEW** with the full
four-step trace rendered in the panel.

**Scope (MoSCoW):** Must ✅ (start/cancel routes + permissions; runner
resolution; trace UI) · Should ✅ (reference-agent seed; honest 422 when no
agent exists) · Won't this increment (real execution behind the seam; live
push/streaming of the trace — the UI fetches on open/invalidate, not via a
socket yet).

**Tests:** `runOrchestrator.test.ts` covers `startRun` (agent-only, missing
task, unknown adapter fails before create), `cancelRun` (non-terminal /
terminal no-op / missing), and `resolveRunnerAgentId` (assignee-agent / pool
fallback / no-agents → null).

## Next (M2.4+)

Our **in-house `native` runtime** behind the seam (built from scratch — model
client, tool runner, sandbox, context engine; **no external agent SDK**), which
slots in as one more adapter and lights up the *same* start-run API and trace UI
shipped here. Full build plan:
[`docs/architecture/in-house-sdk-and-runtime.md`](../architecture/in-house-sdk-and-runtime.md).
