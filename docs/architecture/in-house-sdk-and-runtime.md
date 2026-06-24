# Building the Lumey SDK & Agent Runtime — in-house, from scratch

**Decision (founder, supersedes "buy the loop"):** Lumey does **not** depend on
any external agent SDK or hosted agent runtime (Claude Agent SDK / Managed
Agents, OpenHands, LangChain, etc.). We build **our own** — the agent runtime
*and* the platform SDK — from scratch, to top-notch engineering standards.

We still call **models** (local or frontier inference), but every layer of
orchestration, tool execution, sandboxing, context management, and the SDK
surface is ours. The model is a dependency; the runtime is not.

> 📘 **New here?** Start with the illustrated
> [Lumey Agent Runtime & SDK — learning guide](lumey-runtime-sdk-guide.md):
> a level-by-level walkthrough with diagrams, the MoSCoW, use cases, and how it
> differs from market agent stacks. This document is the build plan / decision
> record behind it.

> This amends `docs/planning/SDK-DECISION.md`. The CTO's `RuntimeAdapter`
> firewall is retained and is exactly what makes building in-house low-risk: our
> runtime is just the first *real* adapter behind a seam we already shipped
> (`backend/src/modules/agent-runtime/runtimeAdapter.ts`, M2.2).

---

## Why build it ourselves

| Reason | What it buys us |
|---|---|
| **No vendor lock-in** | The loop is commoditizing; owning it means no runtime can deprecate us, reprice us, or gate a feature. |
| **The on-prem / air-gap story** | A hosted runtime can't run fully inside a customer's network. Our runtime can — it's the sovereign-AI wedge. |
| **The local-model strategy** | We route work to local models; the loop must be model-agnostic and ours to tune. A vendor loop assumes the vendor's model. |
| **IP & moat** | The runtime + the correction→training loop are the product. Owning them is owning the moat. |
| **Token efficiency** | Context assembly, caching, compaction, and routing are where cost is won. We must control them end to end. |
| **Security & audit** | Sandbox isolation, secret custody, guardrail enforcement, and an immutable trace are ours to guarantee, not trust. |

The cost is real (we build the hard parts), but the `RuntimeAdapter` seam lets
us build incrementally behind a stable interface, with the `referenceAdapter`
standing in for tests and demos the whole way.

---

## Two things called "the SDK" — keep them distinct

1. **The Agent Runtime** — the engine that *executes* a run: the agentic loop,
   model client, tool runner, sandbox, context engine. Wired into the platform
   as a `RuntimeAdapter` (id `native`).
2. **The Lumey Platform SDK** — the typed client/contract that *any* agent,
   runtime, or integration uses to talk to the platform (pull work, compile
   context, emit trace, request review, query the graph). TS + Python.

Both are in-house. They meet at the run model
(`AgentRun` / `RunStep` / `RunEvent`, M2.1): the runtime drives runs through the
run service; the SDK reads/writes the same surface over the network.

---

## Part A — The Agent Runtime (in-house)

### A.1 The seam (done — M2.2)

```ts
interface RuntimeAdapter {
  id: string;
  capabilities(): { selfHosted; memory; outcomes; multiAgent };
  execute(ctx: RunContext): Promise<void>;   // QUEUED → review-park / terminal
  cancel(runId: string): Promise<void>;
}
```

Our runtime is the `native` adapter. The `referenceAdapter` (a deterministic
simulator) already proves the seam; the `native` adapter replaces *what runs*,
not *how it plugs in*. Nothing above the seam knows which runtime executed.

### A.2 The agentic loop (the core)

```
execute(ctx):
  transition(RUNNING)
  context = ContextEngine.assemble(ctx)          # system + compiled task + history
  loop until done | budget exhausted | needs-human | error:
    response  = ModelClient.complete(context, tools, opts)   # one model turn
    record RunStep(PLAN|TOOL_CALL|…) + RunEvent               # the trace
    if response.toolCalls:
        results = ToolRunner.run(response.toolCalls, sandbox) # guarded execution
        context = ContextEngine.extend(context, results)      # cache-stable append
    elif response.needsHuman:                                  # clarify / approve
        transition(AWAITING_INPUT | AWAITING_REVIEW); return
    else:
        break                                                  # model is done
  finalize: open PR / request review → transition(AWAITING_REVIEW | SUCCEEDED | FAILED)
```

Each iteration maps to the run model via the run service (`appendStep`,
`transitionRun`) — so the loop is observable, costed, and resumable by
construction.

### A.3 Components (each built from scratch, each its own module-internal unit)

| Component | Responsibility | Built-from-scratch notes |
|---|---|---|
| **ModelClient** | One method: `complete(messages, tools, opts) → ModelResponse` (+ streaming). | A thin typed client over **raw HTTP** — no vendor SDK. Backends: `LocalModelClient` (vLLM/Ollama), `FrontierModelClient` (raw HTTPS). Model-agnostic; we own caching + routing. |
| **ToolRunner** | Declares tools (`read`/`write`/`edit`/`bash`/`grep`/`test`/`open_pr`), validates args against a schema, executes in the sandbox, returns typed results. | Typed, gated. Promoting an action to a tool gives the harness a hook to **audit, gate, or parallelize** it. |
| **Sandbox** | The execution environment: a workspace with scoped fs + exec. | Implementations: `WorktreeSandbox` (git worktree, local dev), `ContainerSandbox` (Docker isolation), `SelfHostedSandbox` (customer infra / air-gap). We control egress, secret injection, and blast radius. |
| **ContextEngine** | Assemble the prompt: system + compiled context (from the knowledge graph / knowledge-pack) + run history + tool results. | Implements **prefix-stable caching**, **compaction** (summarize old turns), and **context editing** (prune stale results). Token efficiency lives here. |
| **LoopController** | Drives the loop; enforces budget (token/step ceilings); detects done / needs-human; maps iterations to `RunStep`/`RunEvent`; cooperative cancellation. | Owns the safety rails: runaway/loop detection, budget circuit breaker. |
| **GuardrailEnforcer** | Pre-tool checks (path/repo/command allowlist), secret-scan tool outputs before commit, approval gates for risky actions. | Enforced at the **tool boundary**, server-side — an agent can't bypass it. |

### A.4 Model-agnostic by design

`ModelClient` is an interface; the loop never names a model family. A
`RoutingPolicy` (Plane 9) picks the backend per task-type: frontier for hard
coding, local for triage/summarize/extract. The same loop runs both — which is
only possible because the loop is ours.

### A.5 Mapping to the run model (done — M2.1)

`AgentRun` (the execution), `RunStep` (each action), `RunEvent` (the structured
trace stream). The runtime writes these through `agentRun.service`; every change
also publishes a `run.*` fact on the kernel event bus, so observability and the
live-trace UI subscribe without the runtime knowing they exist.

---

## Part B — The Lumey Platform SDK (in-house)

The typed client every agent/runtime/integration uses to talk to the platform.

### B.1 Schema-first, generated, zero drift

- A single **contract source of truth** (JSON-Schema / OpenAPI, generated from
  the same Zod/Prisma types the API already uses).
- **Codegen** produces the **TypeScript** and **Python** clients from that
  contract. Hand-written client code never drifts from the server.

### B.2 Surface (grows with the platform)

| Capability | SDK call (illustrative) | Backed by |
|---|---|---|
| Pull work | `lumey.tasks.next()` | agent control plane (`next-task`) |
| Compile context | `lumey.context.compile(taskId)` | knowledge-pack + KG |
| Create / drive a run | `lumey.runs.create()` · `runs.event()` · `runs.transition()` | run service (M2.1) |
| Report cost | `lumey.runs.usage()` | token/cost rollups |
| Human-in-the-loop | `lumey.hitl.requestReview()` · `clarify()` · `approve()` | done-gate + HITL objects |
| Link PR / commit / test | `lumey.git.link()` | git telemetry |
| Query the graph | `lumey.kg.query()` | knowledge graph |

### B.3 Top-notch SDK properties (non-negotiable)

- **TypeScript-first, Python parity** — generated from one schema.
- **Versioned contract** (`/v1`, additive-only, deprecation windows) — not just
  a versioned package. Seniors trust an SDK that promises not to break them.
- **Resumable, typed event streams** — `for await … of lumey.runs.events()`,
  resumable from a cursor, backpressure-aware, typed discriminated-union events.
- **Actionable typed errors** — `BudgetExceededError`, `ApprovalRequiredError`,
  `ClarificationPendingError`; every error carries a `runId`/`traceId`;
  retryable-vs-terminal flags.
- **Idempotency keys on every write** — agents crash and resume constantly; the
  platform already has `IdempotencyKey` to back this.
- **Runtime-neutral schemas** — `RunEvent`/`ReviewRequest`/etc. never name a
  vendor concept; the same client serves our `native` runtime, a third-party
  agent, or a human IDE.
- **DX that earns "excellent"** — time-to-hello-world < 10 min; copy-paste
  quickstart that produces a real traced run; a local mock/replay mode so
  integrators test without burning tokens; docs generated from the schema.

---

## Engineering standards (how we hold the bar)

- **Strict TypeScript**, schema-first single source of truth, generated clients.
- **Minimal dependencies.** We own the loop, the tool runner, the model client,
  and the SDK client. We pull in only well-vetted primitives (a JSON-schema
  validator, native `fetch`) — every avoided dependency is removed
  supply-chain risk and removed lock-in.
- **Tested at every layer.** Unit + integration; the `RuntimeAdapter` seam keeps
  the runtime swappable and testable (`referenceAdapter` for fast deterministic
  tests). The whole repo stays green at every commit (current: 946 backend
  tests, zero dead exports).
- **Security by construction.** Sandbox isolation; secrets never enter the
  loop's reach (injected at the egress/proxy boundary); guardrails enforced at
  the tool boundary; immutable `RunEvent` audit; reproducibility via pinned
  prompt + context + model version per run.
- **Token efficiency as a measured property.** The `ContextEngine` owns caching,
  compaction, and context editing; cache-hit rate and cost-per-run are
  first-class metrics.
- **Observable by default.** Every step emits a `RunEvent` and a bus fact —
  nothing the runtime does is off the record.

---

## Build process — incremental, behind the seam

Each step ships green, tested, documented; the `referenceAdapter` covers the UI
and demos until the `native` runtime catches up.

| Step | Status | What it delivers |
|---|---|---|
| Run model — `AgentRun`/`RunStep`/`RunEvent` + lifecycle + service | ✅ M2.1 | the platform-side spine + trace |
| `RuntimeAdapter` seam + `referenceAdapter` + registry + orchestrator | ✅ M2.2 | the firewall + a simulator runtime |
| Start-run write API + live trace UI (reference adapter) | ✅ M2.3 | the agentic loop **visible** in the product |
| `ModelClient` (local + frontier, raw HTTP) | ✅ M2.4 | model-agnostic inference, no vendor SDK |
| `ToolRunner` + `Sandbox` (worktree → container) | ✅ M2.5 | real tool execution, isolated |
| `ContextEngine` (assembly + caching + compaction) | ✅ M2.6 | token-efficient prompting |
| `LoopController` → wire as the `native` adapter | ✅ M2.7 | the in-house runtime **executes** a real task end to end |
| `GuardrailEnforcer` at the tool boundary | woven | least-privilege blast radius |
| Lumey Platform SDK (schema → TS + Python codegen) | M2.8 | the top-notch integration SDK |

> Nothing above the seam changes as `native` replaces `reference`. That is the
> whole point of having built the firewall first.

---

## Risks of owning the hard parts (and the mitigations)

| Risk | Mitigation |
|---|---|
| Building a loop is a lot of work | Incremental, behind the seam; `referenceAdapter` keeps the product demoable throughout. |
| Sandbox security is hard | Start with `WorktreeSandbox` for local dev; harden to `ContainerSandbox` with dropped caps, read-only rootfs, controlled egress before any untrusted execution. |
| Frontier-quality coding without a vendor loop | The loop is ours; the *model* is still frontier-grade via `FrontierModelClient`. Quality comes from the model + context engine, both of which we control. |
| Re-inventing solved problems | We reuse well-vetted primitives (HTTP, JSON-schema, git) — we don't rebuild those; we build the *orchestration* that's our differentiator. |
