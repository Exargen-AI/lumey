# Human-in-the-Loop module (Enterprise Phase 1–2)

How a human stays *in control of a run while it runs* — not just at the end. This
is the "Glass Cockpit + collaboration" surface from
[`docs/planning/ENTERPRISE-PLAN.md`](../planning/ENTERPRISE-PLAN.md): watch a run
live, suspend/resume it, answer its questions, and approve or refuse its risky
actions — all without killing it and losing the work.

Code: `backend/src/modules/agent-runtime/` (runtime loop, adapter, orchestrator,
routes) · services: `runClarification.service.ts`, `runApproval.service.ts` ·
loop primitives: `runtime/loop/{pauseController,clarificationController,rendezvous}.ts`
· UI: `frontend/src/components/tasks/RunsSection.tsx`.

## The one idea: cooperative parking

Every control here works the same way — the agent loop **parks at a safe point
with its transcript + sandbox alive in memory**, and an out-of-band human action
(routed through the orchestrator → the adapter that holds the run) wakes it. A
cancel (abort signal) always wins, so a parked loop is never stranded.

Two primitives express this:

| Primitive | Shape | Used by |
|---|---|---|
| `PauseController` | a re-armable **flag**, no payload, may wake many waiters | pause/resume |
| `Rendezvous<T>` | a **one-shot** hand-off carrying one value to one parked frame | clarifications (`Rendezvous<string>`), approvals (`Rendezvous<ApprovalDecision>`) |

`ClarificationController` is a thin, domain-named facade over `Rendezvous<string>`
(`answer()` reads better than `settle()`); approvals use `Rendezvous<ApprovalDecision>`
directly. One parking mechanism, no duplication.

> In-memory by design. A parked run lives in the process that started it, so it
> does **not** survive a restart — the boot reaper (`runExecutor.failInterruptedRuns`)
> fails any run left RUNNING / PAUSED / AWAITING_INPUT and cancels its open
> questions/approvals. The PENDING DB rows are the durable record; the controllers
> are only the live wake-up channel. Durable park-across-restart (persist the
> transcript) is a later milestone.

## P1.1 — Live trace (SSE)

A run is no longer a polled black box. `GET …/runs/:runId/stream` is an SSE feed
of the run's `run.*` bus facts, **signal-only** (the client refetches the
authoritative detail — nothing is trusted off the wire). Because a browser
`EventSource` can't send a bearer header, the stream is authed by a **single-use,
~30 s, run-scoped ticket** minted over the normal Bearer + `taskAccess` `POST
…/stream-ticket`. The FE `useRunStream` hook live-invalidates the React-Query
caches and shows a "● live" pill.

## P1.2 — Pause / resume

`RunStatus += PAUSED` (`RUNNING ↔ PAUSED`). `pauseRun`/`resumeRun` flip the loop's
`PauseController` flag and move the DB (RUNNING-first on resume, so every later
transition stays legal); the loop parks at its next **turn boundary**. Guarded to
a run that is RUNNING, executing on this server, and on a runtime that can suspend
(the fire-and-forget `reference` adapter declines). A cancel beats a pause.

## P2.1 — Clarifications (agent → human → agent)

A lead-only **`ask_human` control tool** the loop intercepts before dispatch
(never run in the sandbox). On a call it opens a `RunClarificationRequest`
(PENDING), parks the run on **AWAITING_INPUT**, and on the human's answer injects
it as the tool result and resumes. The human answers over `POST
…/clarifications/:id/answer`, which wakes the loop **first** then persists
ANSWERED (a raced/dead run is rejected before being marked answered).

## P2.2 — Approval gate (human checkpoint before a risky action)

Before a high-risk tool call (default: `open_pr`, configurable via
`LUMEY_APPROVAL_TOOLS`), the loop opens a `RunApprovalRequest` and parks
AWAITING_INPUT. **Approve** → the action runs; **reject** → it is refused with an
`ok:false` result carrying the reason, and the agent continues (picks another
path). `POST …/approvals/:id/{approve,reject}` wakes the loop then persists the
decision. The gate lives in the `LoopController`'s per-call execution (`runTools`),
so any tool can be gated, not just PRs.

## Data model

| Model | Purpose |
|---|---|
| `RunClarificationRequest` | a question the agent raised (`question`, `answer`, `status`, `answeredBy`) |
| `RunApprovalRequest` | a checkpoint before an action (`action`, `summary`, `detail`, `status`, `reason`, `decidedBy`) |
| `RunStatus.PAUSED` | human-held suspend |
| `RunStatus.AWAITING_INPUT` | parked on a clarification **or** an approval |

Enums: `ClarificationStatus` / `ApprovalStatus` (`PENDING → ANSWERED/APPROVED/REJECTED`,
or `CANCELLED` when the run ends first). Migrations
`20260628000000`–`20260628020000`.

## Lifecycle

```
QUEUED ─► RUNNING ─► SUCCEEDED
   │         │  ├─► PAUSED          ─► RUNNING        (pause / resume)
   │         │  ├─► AWAITING_INPUT  ─► RUNNING        (clarification / approval)
   │         │  ├─► AWAITING_REVIEW ─► RUNNING | SUCCEEDED
   │         │  └─► BLOCKED         ─► RUNNING
   │         └─► FAILED
   └─► FAILED
 (any non-terminal) ─► CANCELLED
```

Validated centrally in `lib/runLifecycle.ts`.

## API

| Method | Path | Action |
|---|---|---|
| POST | `…/runs/:runId/stream-ticket` | mint an SSE ticket |
| GET | `…/runs/:runId/stream` | live trace (ticket-authed) |
| POST | `…/runs/:runId/pause` · `…/resume` | suspend / resume |
| GET | `…/runs/:runId/clarifications` | the run's questions |
| POST | `…/runs/:runId/clarifications/:id/answer` | answer a question |
| GET | `…/runs/:runId/approvals` | the run's checkpoints |
| POST | `…/runs/:runId/approvals/:id/approve` · `…/reject` | decide a checkpoint |

Reads are `taskAccess`-gated; writes additionally require `task.edit_*` (same as
dispatch/cancel).

## Events

`run.transitioned`, `run.step.recorded` (drive the live trace) plus
`run.clarification.{requested,answered}` and `run.approval.{requested,decided}`
on the kernel bus, for the trace and a future HITL inbox.

## Testing

No live LLM (per the local-models constraint): the loop behaviours are verified
at the **mock-model seam** — a real loop genuinely parks and resumes. Coverage:
`rendezvous` / `pauseController` / `clarificationController` units; `loopController`
integration (pause→resume, ask→answer→resume, approve→run, reject→refuse,
cancel-while-waiting → CANCELLED); `runClarification`/`runApproval` service units;
`runOrchestrator` guard + wake-order units; reaper covers the interrupted states.

## Not yet built (Phase 2 remainder → later phases)

A global **HITL inbox** (`GET /inbox` across tasks), `request_approval` as an
explicit agent tool (today approval is auto-gated by tool name), SLA/escalation,
and durable park-across-restart.
