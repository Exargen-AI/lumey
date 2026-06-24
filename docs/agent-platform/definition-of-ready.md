# Definition of Ready (agent pickup)

Part of M1 — *work items become contracts*. A task an autonomous agent acts on
must declare a checkable **definition of done**, or the agent has nothing to
verify its work against and will grind on (or falsely "complete") an
under-specified task. That's a *poison task*. The Definition-of-Ready gate keeps
the agent task-picker from ever handing one out.

## The rule (today)

A task is **agent-ready** iff it has **at least one acceptance criterion with
non-empty text**.

`Task.acceptanceCriteria` is already structured and machine-checkable — a Json
array of `{ id, text, done }` (validated in `task.schema.ts`). Each criterion's
`done` flag is what an agent grades itself against later (Outcomes, M2). The
readiness gate simply requires that the contract *exists*.

Humans are unaffected — they have the full kanban UI and their own judgement.
This gate is specifically the entry contract for **agent execution**.

## Where it's enforced

`backend/src/services/agentNextTask.service.ts` — the agent control-plane
`next-task` picker. After the dependency-graph (BLOCKS) filter, candidates are
filtered through `evaluateAgentReadiness` (`backend/src/lib/taskReadiness.ts`).
A not-ready task is skipped and logged at `debug` (so under-specified work is
diagnosable, never silently dropped). Readiness is applied **before** scoring,
so it overrides priority — a ready P2 is handed out before an unspecified P0.

## Behaviour guarantees

- **Fail closed.** A malformed / non-array `acceptanceCriteria` value is treated
  as "not ready", never throws — the picker can't be crashed by bad data.
- **Reusable.** `evaluateAgentReadiness({ acceptanceCriteria })` is a pure
  function returning `{ ready, reason }`; UI / other services can surface
  readiness without re-implementing the rule.

## Future (not yet — added without changing this gate)

Repo-linkage and scope-bounded checks become **run-start guards** in M2 (when a
run actually needs a repo + sandbox), layered on top of this gate rather than
folded into it. Keeping the readiness rule small keeps it easy to reason about.

## Tests

- `backend/src/lib/taskReadiness.test.ts` — the rule, blank-criteria, fail-closed.
- `backend/src/services/agentNextTask.service.test.ts` — the picker skips a
  no-criteria task and prefers a ready lower-priority task over an unspecified
  higher-priority one.
