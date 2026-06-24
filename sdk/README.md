# @exargen/sdk — the Lumey Platform SDK

The typed client agents and integrations use to talk to Lumey: **pull work,
drive runs, observe the trace**. Schema-first (one `zod` contract → TS types +
JSON-Schema for cross-language codegen), runtime-neutral, with actionable typed
errors and idempotent writes.

> This is **Part B** of the in-house SDK plan — the integration surface. Part A
> (the agent *runtime*) is documented in
> [`docs/architecture/lumey-runtime-sdk-guide.md`](../docs/architecture/lumey-runtime-sdk-guide.md).

## Quickstart (hello, run)

```ts
import { LumeyClient } from '@exargen/sdk';

const lumey = new LumeyClient({
  baseUrl: 'http://localhost:3000/api/v1',
  token: process.env.LUMEY_TOKEN!, // an agent/service-account bearer token
});

// 1. pull the next ready task
const task = await lumey.tasks.next();
if (!task) process.exit(0);

// 2. dispatch an agent run (idempotent — safe to retry)
const run = await lumey.runs.start(task.id);

// 3. observe the trace
const detail = await lumey.runs.get(task.id, run.id);
console.log(detail.status, detail.steps.map((s) => s.type));
```

## What you get

| Property | How |
|---|---|
| **Typed responses** | Every response is validated against the contract; you get typed data or a `LumeyContractError` (server/SDK drift) — never a silently-wrong object. |
| **Actionable errors** | `catch (e)` on `LumeyAuthError`, `LumeyUnavailableError`, `BudgetExceededError`, `ApprovalRequiredError`, `ClarificationPendingError` — each carries `status`, `code`, `runId`/`traceId`, and a `retryable` flag. |
| **Idempotent writes** | Every write auto-attaches an `Idempotency-Key` (override per call) — agents crash and resume safely. |
| **Resilient transport** | Per-request deadline + bounded retry on transient (429/5xx/network) failures only. |
| **Testable without a server** | Inject a `MockTransport` (or your own `Transport`) — the SDK runs fully in memory. |

## Testing your integration

```ts
import { LumeyClient, MockTransport } from '@exargen/sdk';

const transport = new MockTransport((method, path) =>
  path === '/agents/me/next-task' ? { id: 't1', title: 'demo', status: 'TODO' } : null,
);
const lumey = new LumeyClient({ transport });
const task = await lumey.tasks.next(); // → { id: 't1', ... }, no network
```

## Surface (this release)

- `tasks.next()` — the next ready task for the authenticated agent (or `null`).
- `runs.start(taskId)` · `runs.list(taskId)` · `runs.get(taskId, runId)` · `runs.cancel(taskId, runId)`.

Grows with the platform: `context.compile`, `hitl.requestReview/clarify/approve`,
`git.link`, `kg.query`, and resumable typed event streams are on the roadmap.

## Cross-language codegen

The contract lives once, as `zod` schemas (`src/contract/schemas.ts`).
`contractJsonSchema()` renders it as JSON-Schema — the input a Python (or any)
client generator consumes, so every language client is produced from the *same*
source the TypeScript client validates against. The generated Python client is
the next increment.

## Build & test

```bash
npm run build --workspace=sdk      # → dist/ (CommonJS; works via require & import)
npm run test  --workspace=sdk      # 20 tests, no network
npm run typecheck --workspace=sdk
```
