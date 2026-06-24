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

## M2.4 — in-house ModelClient (the first runtime component)

The first brick of the in-house `native` runtime: a model-agnostic inference
client over **raw HTTP, no vendor SDK**. Code:
`backend/src/modules/agent-runtime/runtime/model/`.

It speaks the **OpenAI-compatible `/chat/completions`** wire format — the
de-facto standard that local servers (vLLM, Ollama, llama.cpp) *and* frontier
gateways all expose — so one client serves both backends. A model is a
*dependency* (config: a `baseUrl` + a `model` id); the runtime is ours.

| Piece | Responsibility |
|---|---|
| `types.ts` | runtime-neutral contract: `ModelClient`, `ChatMessage`, `ToolSchema`, `ModelToolCall`, `CompletionRequest`, `ModelResponse`, `ModelStreamChunk`. Nothing names a model family. |
| `errors.ts` | typed failures, each with a `retryable` flag + HTTP `status`: `ModelAuth`/`RateLimit`/`Unavailable`/`Request`/`Timeout`/`Transport`/`Protocol`Error. Callers never see a raw `fetch` error. |
| `httpModelClient.ts` | the engine: request/response mapping, a per-request **deadline** (AbortController), **bounded exponential-backoff retry on retryable failures only**, honest status→error classification, tool-call (de)serialization, and **SSE streaming** (`stream()`). |
| `factory.ts` | the two named backends — `createLocalModelClient` (self-hosted vLLM/Ollama, no auth, air-gap/cost path) and `createFrontierModelClient` (hosted HTTPS gateway, API key **mandatory** — fail loud, not mid-run). |

**Boundaries it keeps** (so it stays a thin, swappable transport): it does *not*
parse/validate tool arguments (ToolRunner, M2.5), assemble or cache prompts
(ContextEngine, M2.6), or route between backends (RoutingPolicy, later). It maps
bytes to typed values and nothing more.

**Retry/cancel semantics:** transient faults (`429`, `5xx`, transport, our own
timeout) back off and retry up to `maxRetries`; permanent ones (`401/403`, other
`4xx`, malformed `2xx`) fail fast. A **caller cancellation** (the run's cancel
path) propagates untouched — it is never wrapped or retried, so cancelling a run
stops the model call immediately.

**Tests** (`httpModelClient.test.ts`, `factory.test.ts`, 19 cases, injected
`fetch` + `sleep` — no network, no real timers bar one 5 ms deadline): response
+ tool-call + usage mapping, wire-body/auth/URL shape, each error class, retry
exhaustion vs fast-fail, caller-cancel passthrough, SSE delta+finish parsing,
and the local/frontier factory defaults.

**Scope (MoSCoW):** Must ✅ (model-agnostic client, raw HTTP, typed errors,
retry/timeout, tool calls, tests) · Should ✅ (streaming; local + frontier
factories; caller cancellation) · Won't this increment (wiring it into a running
loop — that's M2.7; routing/caching — later).

## M2.5 — ToolRunner + Sandbox (how the agent acts, safely)

The agent's hands. An agent acts *only* through declared, schema-validated,
guardable tools, executed inside a contained sandbox. Code:
`runtime/sandbox/` and `runtime/tools/`.

### Sandbox — the contained workspace

`runtime/sandbox/sandbox.ts` defines the `Sandbox` contract; `WorktreeSandbox`
is the local-dev implementation. Two invariants hold regardless of what a tool
asks for:

- **Path containment** — every path resolves *inside* `root`; `resolve()` throws
  `SandboxPathError` on any traversal (`../`) or absolute path. A tool cannot
  read or write outside the workspace.
- **Bounded exec** — every process runs **shell-free** (explicit argv, no
  injection), with a **timeout** (killed → `timedOut`), an **output cap**
  (clipped → `truncated`), and **abort** support. A non-zero exit is returned,
  never thrown.

`WorktreeSandbox.create({repoPath, ref})` adds a detached **git worktree** —
each run gets its own on-disk checkout sharing the object store, cheap to make
and throw away; `dispose()` removes it. `forDir()` wraps a plain directory with
the same guarantees. Isolation here is process+path level (trusted local dev);
the same contract upgrades to a container sandbox (dropped caps, controlled
egress) for untrusted execution.

### Tools — declared, validated, guarded

| Piece | Role |
|---|---|
| `types.ts` | `ToolDefinition` — name, description, a single `zod` arg schema, `mutates`, and a handler acting through the sandbox. |
| `schema.ts` | `zodToJsonSchema` / `toModelTool` — generate the model-facing JSON-Schema **from the zod schema**, so a tool is declared exactly once (no drift). |
| `guardrails.ts` | `checkCommand` — the server-side `bash` gate: a **denylist** (sudo, `rm -rf`, fork bombs, device writes, `curl … \| sh`, …) where deny always wins, over an **allowlist** of leading binaries (empty ⇒ deny-by-default). |
| `builtins.ts` | the coding toolset: `read_file`, `write_file`, `edit_file` (unique-match unless `replaceAll`), `list_dir`, `grep` (JS walker, skips `node_modules`/`.git`/…), and a guardrail-checked `bash`. |
| `toolRunner.ts` | dispatch + validation: resolve tool → parse JSON args → `zod` validate → run in sandbox → one `ToolResult`. **Never throws** — unknown tool, bad JSON, schema failure, blocked command, and handler errors all become `ok:false` results the model reads and recovers from. |

**Design stance — tool errors are data.** A failing tool (or a blocked command,
or a non-zero `bash` exit) is information the agent acts on, not a crash. The
runner always returns a `ToolResult`; the loop records it as a step and lets the
model decide what to do next. Calls run **sequentially** (writes/edits/side
effects must order); parallelizing provably read-only tools is a later
optimization.

**Scope (MoSCoW):** Must ✅ (sandbox path-guard + bounded exec; tool contract +
zod validation; the six builtins; guardrail gate; runner-never-throws; tests) ·
Should ✅ (git-worktree create/dispose; schema generation from zod; output caps;
cancellation) · Won't this increment (container/air-gap sandbox hardening;
`run_tests`/`open_pr` finalize tools — they come with the loop in M2.7; secret-
scanning tool outputs before commit; read-only parallel execution).

**Tests** (45 cases across `sandbox` + `tools`): real-fs sandbox round-trips,
path-traversal blocks, exec timeout/abort/output-cap, a real **git-worktree
lifecycle**; zod→JSON-Schema mapping; guardrail allow/deny (incl. deny-wins);
every builtin incl. edit uniqueness + grep dir-skipping + bash block; and the
runner's full failure-to-`ok:false` matrix.

## M2.6 — ContextEngine (token efficiency)

Where cost is won: the ContextEngine assembles the prompt for each model turn
and keeps it within a token budget. Code: `runtime/context/`.

| Piece | Role |
|---|---|
| `systemPrompt.ts` | `buildSystemPrompt(ctx, tools)` — the **stable prefix**, built once per run from the task + tool catalog. Strictly static (no timestamps/counters) so its bytes never change across turns. |
| `tokens.ts` | `estimateTokens` / `estimateMessagesTokens` — a fast ~4-chars/token heuristic that errs toward over-counting (compact early, never overflow). Injectable, so a real tokenizer can replace it. |
| `contextEngine.ts` | `assemble(transcript)` — applies the three levers below and returns the turn's `ChatMessage[]`. |

**Three levers, in order:**
1. **Prefix-stable assembly** — the system prompt is byte-identical every turn
   and always `message[0]`; per-turn material is *appended*, never folded into
   the prefix. Stable leading bytes are what let prompt / KV caches hit instead
   of re-encoding the whole context each turn — the single biggest cost lever.
2. **Context editing** — no single tool result can dominate the window:
   oversized `tool` outputs are clipped to a cap with an elision marker.
3. **Compaction** — when the prompt would exceed the budget, the oldest turns
   are summarized into one note and the most recent turns kept verbatim. The
   summarizer is **pluggable** — a model-backed one in the loop, a deterministic
   structural one by default (so this is fully testable without a model).

**Wire-safety:** compaction never leaves an orphaned `tool` message (one whose
`assistant` tool-call was summarized away) at the head of the kept window — the
split point advances past leading tool results.

**Scope (MoSCoW):** Must ✅ (stable system prompt; token estimation; budgeted
assembly with compaction; tests) · Should ✅ (context editing of tool results;
pluggable summarizer; orphan-tool wire-safety; injectable estimator) · Won't
this increment (knowledge-graph / knowledge-pack context compilation — slots in
as another prefix section when the KG lands; a real tokenizer; semantic
deduplication of tool results).

**Tests** (15 cases): system-prompt content + byte-stability + defensive
criteria/description rendering; token-estimator monotonicity + overhead;
pass-through under budget, prefix stability as the transcript grows, tool-result
clipping, compaction (structural + injected summarizer), and orphan-tool
avoidance.

## M2.7 — LoopController wired as the `native` adapter (it's alive)

The keystone: the four components compose into a real agentic loop that executes
a task. Code: `runtime/loop/loopController.ts` + `adapters/native.ts`.

**The loop** (`LoopController`) — one iteration per model turn:

```
transition(RUNNING)
loop until done | budget | cancelled | error:
  messages = ContextEngine.assemble(transcript)
  response = ModelClient.complete(messages, tools)        # one turn
  record RunStep(s) + transcript append                   # the trace
  if response has tool calls:
     results = ToolRunner.runAll(calls, sandbox)           # guarded, isolated
     append results to transcript
  else:
     transition(AWAITING_REVIEW)  # model produced its final answer → human gate
finalize: AWAITING_REVIEW | FAILED | CANCELLED
```

It owns the **safety rails**: a step ceiling and a token budget (the circuit
breaker against a runaway loop — both hand off to human review, not a crash),
cooperative cancellation, and turning a terminal model error into a `FAILED`
run. Each turn and each tool result maps to a `RunStep` through an injected
`RunRecorder` — so the loop is observable, costed, and lands the run in the
right lifecycle state *by construction*. The recorder is a seam: it writes
through the run service in production and collects calls in tests, so the loop
is verified end-to-end with a **mock model over a real sandbox + tools +
context engine**.

**The adapter** (`createNativeAdapter` / `nativeAdapter`, id `native`) — composes
ModelClient + ToolRunner + Sandbox + ContextEngine + LoopController behind the
M2.2 seam. Dependency-injected (model/sandbox/tools factories) so it's fully
testable; the default resolves the model from env (`modelClientFromEnv`) and
gives each run a fresh temp-dir workspace. It's registered alongside
`reference`; **`reference` stays the default** so the product works with no
model at all, and `native` is selected per-run once a model is wired. A setup
failure (no model configured) fails the run with a clear message via the new
`QUEUED → FAILED` lifecycle edge. Cancellation is cooperative: `cancel(runId)`
aborts the in-flight loop, which transitions `CANCELLED` at its next checkpoint.

**Nothing above the seam changed** — the same `POST /tasks/:id/runs` and the same
live trace UI from M2.3 now run on a real loop when `native` is chosen.

**Scope (MoSCoW):** Must ✅ (the loop; step/token budget rails; native adapter
composing all four components; registry wiring; e2e tests) · Should ✅
(cooperative cancellation; `QUEUED→FAILED` for setup errors; `modelClientFromEnv`;
tool→step-type classification; tool-failure-as-data continuation) · Won't this
increment (background/async execution so a long run doesn't block the request —
today `execute` is awaited like `reference`; cloning the project's real repo
into the worktree — runs use a temp workspace until git-config lands;
`run_tests`/`open_pr` finalize tools; cross-run memory / Outcomes grading).

**Tests** (20 across loop + adapter + factory): an **end-to-end** run that reads
a file, writes a new one, and requests review — asserting the workspace was
actually mutated and the trace + lifecycle are correct; tool-failure-as-data;
test-command step classification; model-error→FAILED; step-ceiling and
token-budget hand-offs; cooperative cancel; adapter wiring + no-model→FAILED +
cancel; and `modelClientFromEnv` local/frontier resolution.

## M2.8 — finalize tools + repo-aware workspace (it works on real code)

The native runtime now operates on an actual repo and completes the loop:
verify, then prepare for review. Code: `runtime/tools/finalize.ts` +
`adapters/native.ts`.

- **Repo-aware workspace** — when `LUMEY_RUN_REPO_PATH` is set, a run gets a git
  **worktree** of that repo (real code, real tests, a real branch); otherwise a
  temp dir. An env bridge until per-project git config lands.
- **`run_tests`** — runs the project test suite (default from `LUMEY_TEST_CMD`,
  or a model override) and reports `PASS`/`FAIL`/`TIMEOUT` with output. The
  (overridable) command passes the same guardrail as `bash`.
- **`git_commit`** — stages all changes and commits them onto a per-run branch
  (`lumey/run-<runId>`), returning the sha. Off a git repo, or with nothing to
  commit, it returns `ok:false` (errors-as-data) rather than throwing.

The loop classifies these on the trace (`run_tests → TEST`, `git_commit →
COMMAND`). The native adapter binds them per run (the commit branch is named for
the run) alongside the six coding tools.

**Scope (MoSCoW):** Must ✅ (run_tests + git_commit, guardrailed, errors-as-data;
repo-aware workspace; loop step-typing; tests) · Should ✅ (per-run branch;
model-overridable test command; non-git/empty-commit graceful paths) · Won't
this increment (pushing the branch + opening a real PR on a remote — needs git
auth/remote config; per-project repo settings replacing the env bridge;
background execution).

**Tests** (6 unit + a full-flow e2e): run_tests PASS/FAIL/guardrail-block;
git_commit onto a branch / nothing-to-commit / non-git; and an **end-to-end run
over a real git worktree** where the agent writes code → runs tests → commits to
`lumey/run-e2e` → requests review, asserting the commit actually landed on the
branch and the trace shows EDIT → TEST → COMMAND → REVIEW_REQUEST.

## M2.9 — open_pr + PR linking (the loop closes)

The agent now **opens a pull request and tags a human** — the work lands where a
reviewer already looks. Code: `runtime/git/` + `runtime/tools/finalize.ts` +
`services/taskPullRequestLink.service.ts`.

- **GitProvider seam** (`runtime/git/gitProvider.ts`) — the firewall between the
  runtime and whatever hosts the repo. Opening a PR is provider-specific; the
  runtime only sees a neutral `PullRequestRef`. Same philosophy as the
  RuntimeAdapter seam: swap hosts by writing a provider.
- **`referenceGitProvider`** — a deterministic, dependency-free simulator
  (fabricates a stable PR ref from the branch; no remote, no push). The default,
  so the flow works with no GitHub auth. A real `github` provider (push +
  create PR via the project's GitHub integration) slots in behind the seam.
- **`open_pr` tool** — opens the PR via the provider and invokes a server-side
  `onOpened` hook; the loop traces it as a `REVIEW_REQUEST` step.
- **`linkPullRequestToTask`** — upserts a `TaskExternalLink` (kind `GITHUB_PR`),
  the **same surface the GitHub webhook populates**, so an agent-opened PR shows
  up in the task's **Linked PRs** exactly like a human-opened one. Idempotent on
  `(taskId, kind, externalId)`.

The native adapter binds `open_pr` per run with the reference provider and links
to `ctx.taskId`. End to end, a run now does **write → test → commit → open PR →
request review**, and the PR appears on the task.

**Scope (MoSCoW):** Must ✅ (GitProvider seam + reference provider; open_pr tool;
PR→task linking; loop step-typing; tests) · Should ✅ (idempotent link on the
existing TaskExternalLink surface; deterministic simulator; per-run wiring) ·
Won't this increment (the real `github` provider — push the branch + create the
PR via the project GitHub integration/auth; PR state sync back from merge).

**Tests** (incl. the full-flow e2e over a real git worktree): deterministic
reference provider; open_pr opens + links (callback fired with the ref);
`linkPullRequestToTask` upsert shape; and the e2e where the agent writes →
tests → commits → **opens a PR (linked)** → requests review.

## Next — beyond M2.9

The real **`github` GitProvider** (push the run branch + create the PR through
the project's GitHub integration), **per-project repo config** (replace the env
bridge), **background execution**, then **memory** and **Outcomes** grading. And
more **SDK** surface as endpoints land. Full build plan:
[`docs/architecture/in-house-sdk-and-runtime.md`](../architecture/in-house-sdk-and-runtime.md).
