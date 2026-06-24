# Layer 2 — Agent Control Plane

**Status:** v1 shipped 2026-05-23.
**Owner:** Platform.

## What this layer is

The agent control plane sits between Layer 1 (project management primitives — projects, tasks, comments, users, agents) and Layer 3 (whatever agent execution framework actually runs — could be Claude direct, ADK, LangGraph, a custom poller, etc).

Layer 2 is the **framework-agnostic interface** every Layer 3 implementation talks to. Anything an agent runtime needs to do that is a *control* concern (rather than execution) lives here:

- **Picking work** — which task should the agent do next?
- **Loading context** — what does the agent need to know to act?
- **Recording spend** — how much has this agent cost this month?
- **Safe retries** — if the network blips, how does the runtime not double-create resources?
- **Observability** — what did the agent do, and when?
- **Discovery** — how does a future runtime / external integration learn what's callable?

The deliberate constraint: **Layer 2 must not import or assume any specific runtime.** Today we are not using ADK / LangGraph / CrewAI. The endpoints here would work just as well for a hand-rolled Claude API loop or a future ADK integration. Switching frameworks at Layer 3 should require zero changes to Layer 2.

## What's in v1

### 1. Per-agent identity model (already existed)

The `User` table carries dedicated agent fields:

```
userType                      'HUMAN' | 'AGENT'
agentRole                     String?     (free-text role for the prompt)
agentSystemPromptPath         String?     (points at a markdown file)
agentBudgetMonthlyUsdCents    Int?        (ceiling — null = unlimited)
agentBudgetUsedUsdCents       Int         (rolling sum)
agentActive                   Boolean
```

JWT carries `ut: 'agent' | 'human'` so middleware can tell them apart without a DB round-trip.

**Why agents are User rows (not a separate AgentUser table):** they need to be assignees on tasks, members on projects, authors on comments, etc. — every relation that exists for humans. A separate table would have meant either duplicating those relations or making every relation polymorphic. Sharing the User table is the simpler, less-bug-prone choice.

**Hard invariant: agents cannot move tasks to DONE.** `enforceAgentDoneGate` in `task.service` refuses the transition regardless of permission grants. The "Done" decision belongs to a human reviewer.

### 2. Knowledge pack — `GET /agents/me/knowledge-pack/:projectSlug`

Bundles every piece of project context an agent needs to act on a task into ONE response. Designed for prompt-budget callers — the runtime fetches one response per task instead of hitting 5 endpoints.

Includes:

- Project identity + phase + health + GitHub integration metadata
- Active project members (with `userType` so the agent knows who else is an agent)
- Last 30 days of activity (capped at 100 entries)
- Active sprint + sprint tasks (with **acceptance criteria** so the agent sees "what does Done look like")
- The agent's own assigned tasks (with **acceptance criteria** + isBlocked + blockerNote)
- 20 most recent decisions
- 50 most recent project documents (metadata only — fetch body separately)

Auth: agent-only + must be a project member. Both checks in `agentKnowledgePack.service`.

### 3. Next-task picker — `GET /agents/me/next-task` (NEW)

Returns ONE priority-ordered, unblocked, ready-to-work task. The runtime calls this once per work cycle.

Selection contract:

1. `assigneeId === me` (agents only work on their own tasks)
2. Status is `BACKLOG`, `TODO`, or `IN_PROGRESS` (DONE is finished, IN_REVIEW is human-only)
3. `isBlocked === false` (the team has not flagged the task as gated)
4. All incoming `BLOCKS` dependencies satisfied (every blocker task is `DONE`)
5. Sprint preference — tasks in the active sprint beat same-priority tasks not in the sprint
6. Priority order: `P0 > P1 > P2 > P3`
7. Tiebreak by `dueDate` ascending (overdue first), then `createdAt` ascending for stability

Returns `{ data: null }` when nothing is ready — the runtime should idle / poll later.

Response includes a human-readable `rationale` string (`"priority P1 · in active sprint · due 2026-05-30"`) so runtime logs and agent prompts can surface why this task was selected over others.

### 4. Budget accounting — `POST /agents/me/budget-increment` (already existed)

Runtime records per-task API spend so the platform can refuse to spawn the next container when the agent's monthly budget is exhausted. Returns the updated totals + an `over: boolean` flag. Sanity-capped at $1000/single-increment to catch runtime bugs. Atomic via Prisma's `{ increment: N }`.

### 5. Idempotency keys (NEW)

Every state-changing endpoint accepts an optional `Idempotency-Key` header. Stripe-compatible shape — external developers will recognize it immediately.

**Contract:**

```
Client → POST /tasks  Idempotency-Key: my-uuid-1  body={title:"X"}
Server → 201 Created                              body={id:"task-1"}

[network failure — client retries]

Client → POST /tasks  Idempotency-Key: my-uuid-1  body={title:"X"}
Server → 201 Created  X-Idempotent-Replay: true   body={id:"task-1"}  ← same response!

[client buggy retries with different body]

Client → POST /tasks  Idempotency-Key: my-uuid-1  body={title:"Y"}
Server → 409 Conflict                             body=error("Idempotency-Key reuse with a different request body. ...")
```

**Storage:** dedicated `idempotency_keys` table, scoped per-user with a composite unique on `(userId, key, method, path)`. 24-hour TTL. Daily sweep deletes expired rows.

**Out of scope:** streaming responses (PDF, ZIP, file upload) bypass the middleware. JSON only. Stream replay is a separate hard problem.

**Opt-in:** clients without the header get the legacy behavior. No FE migration required.

### 6. OpenAPI specification (NEW)

`GET /api/v1/openapi.json` — machine-readable spec.
`GET /api/v1/docs` — Swagger-UI for humans (read-only — no "Try it out" because we don't want anyone driving prod from the docs).

Built incrementally. **Layer 2 (agent control) endpoints are fully documented.** Layer 1 endpoints get registered as they stabilize — adding one is `registry.registerPath({...})` in a new path file.

Why no auto-introspection of every endpoint: zod schemas exist for ~80 routes but most are partially-validated (validators were grown organically). A full sweep would surface every gap at once — better to register routes deliberately as the API stabilizes.

### 7. Audit logs (already existed)

The `activities` table records every meaningful state change with `(userId, projectId, action, targetType, targetId, details, createdAt)`. Agents log to the same table as humans, with the same shape, so an audit query like "what did agent X do this week" works without a separate log surface.

Every Layer 2 mutation (`incrementAgentBudget`, etc.) writes an activity row.

## Recommended runtime usage

A minimal work-cycle loop, framework-agnostic:

```ts
// 1. Get next task. Idempotent.
const { data: result } = await api.get('/agents/me/next-task', {
  headers: { Authorization: `Bearer ${agentToken}` },
});
if (!result) {
  // Nothing to do. Idle and poll later.
  await sleep(60_000);
  continue;
}
const { task } = result;

// 2. Get context.
const { data: kp } = await api.get(
  `/agents/me/knowledge-pack/${task.projectSlug}`,
  { headers: { Authorization: `Bearer ${agentToken}` } },
);

// 3. Do the work (Layer 3 — whatever framework you use).
const { cost, completed } = await runAgent({ task, knowledgePack: kp });

// 4. Record spend. Send Idempotency-Key so a retry doesn't double-charge.
await api.post(
  '/agents/me/budget-increment',
  { usdCents: cost },
  {
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Idempotency-Key': `${task.id}-${Date.now()}`,
    },
  },
);

// 5. Mark task done (Layer 1). Agents cannot transition to DONE
//    directly — request a human review instead.
if (completed) {
  await api.post(`/tasks/${task.id}/request-review`, {
    reviewerId: kp.project.members.find((m) => m.userType === 'HUMAN')?.userId,
    note: 'Agent completed; ready for review',
  });
}
```

The platform doesn't care whether `runAgent` is Claude direct, an ADK pipeline, a LangGraph state machine, or `child_process.spawn('python', ['my_script.py'])`. That choice belongs to Layer 3.

## Future Layer 2 work (not in this PR)

- **Outbound webhooks** — agents currently poll. A subscription model with per-agent webhook URLs + retry/backoff would let agents react to events (new comment, blocked, sprint completed) without polling. Planned but unimplemented; design doc in `docs/agent-platform/05-webhooks-design.md` (to be written when there's appetite to build).
- **Per-agent API keys** — long-lived revocable tokens scoped to a single agent. The CMS public routes already have this pattern; reuse when login-rate-limiting starts to bite.
- **Skills surface** — knowledge pack returns `skills: []` (placeholder). Surfacing skill metadata from `~/.claude/skills` + per-agent skill mappings would let the platform contribute to the agent prompt directly.
- **Throttle-by-budget** — today the runtime refuses to spawn when `over === true`. A platform-side enforcement (auth middleware that 429s an agent over budget) would be defense-in-depth.

## What this layer is NOT

- **Not an agent framework.** No agent loop, no prompt assembly, no LLM client. Those belong to Layer 3.
- **Not a tool calling protocol.** This is REST. If a future framework wants to expose Layer 1+2 endpoints as MCP tools (or whatever), that's a wrapper around this API, not a replacement.
- **Not a queue / worker system.** No "kick off this task and call me when done" semantics. The runtime owns its own scheduling.

## Stability commitments

- **Endpoint shapes:** every Layer 2 endpoint documented in OpenAPI is stable. Breaking changes go through a `/v2/` route.
- **Error envelope:** every error response is `{ success: false, error: { code, message, errorId } }`. The `code` field is stable (machine-readable); `message` is human-readable and may be tweaked for clarity.
- **Idempotency contract:** Stripe-compatible. We will not change semantics under the same header name.
- **JWT shape:** `ut`, `sub`, `role`, `exp`, `iat` claims are stable. Additional claims may be added but never removed.
