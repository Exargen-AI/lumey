# Mixed assignment (human · named agent · agent pool)

Part of M1 — *work items become contracts*. A task can now be worked by a human,
a **specific named agent**, or **any available agent with a matching
capability** (a pool), with race-safe claiming so two agents never grab the same
pool task.

## The model

| Assignment | `assigneeId` | `agentPoolRole` | Who works it |
|---|---|---|---|
| Human / named agent | set (a `User` id) | ignored | that user (agents are users) |
| **Agent pool** | `null` | set (e.g. `"coder"`) | any agent whose `User.agentRole` matches |
| Unassigned | `null` | `null` | nobody (until assigned) |

- **Capability** is the free-form `User.agentRole` (e.g. `coder`, `reviewer`),
  matched exactly against a task's `agentPoolRole`.
- `agentPoolRole` is **settable via task update** (`PATCH /tasks/:id`); ignored
  once `assigneeId` is set.
- Schema: `Task.agentPoolRole String?` + `@@index([agentPoolRole])`
  (migration `20260624000000_add_task_agent_pool_role`).

## The picker (agent control plane)

`agentNextTask.service` now selects from **both** sources in one query:

```ts
where: {
  status: { in: ACTIONABLE_STATUSES },
  isBlocked: false,
  OR: [
    { assigneeId: agentUserId },                         // directly assigned to me
    { assigneeId: null, agentPoolRole: agentRole },      // open pool I'm eligible for
  ],
}
```

The pool clause is added only when the agent has a role. The Definition-of-Ready
gate and the BLOCKS dependency filter apply to pool tasks exactly as to assigned
ones — an under-specified pool task is never handed out.

## Atomic claim (race-safe)

When the winning task is an **open pool task** (`assigneeId === null`), the picker
claims it with a conditional update before returning it:

```ts
const claim = await prisma.task.updateMany({
  where: { id: winner.id, assigneeId: null },   // only while still unclaimed
  data: { assigneeId: agentUserId },
});
if (claim.count === 0) return null;             // lost the race → poll again
```

If two agents race for the same pool task, exactly one update touches a row; the
loser gets `count === 0` and yields `null` (the runtime simply asks for the next
task). Directly-assigned tasks are never re-claimed.

## Scope (MoSCoW)

- **Must ✅** — `agentPoolRole` + migration; pool-aware picker; atomic claim +
  race handling; readiness still applies; tests.
- **Should ✅** — settable via task update.
- **Won't (this increment)** — create-flow field, multi-capability agents,
  reassignment-mid-flight, "any human" pools, frontend UI.

## Tests

`agentNextTask.service.test.ts` — the OR query shape (with/without a role),
atomic claim on pickup, lost-race yields null, no claim for already-assigned
tasks, and readiness still enforced on pool tasks.
