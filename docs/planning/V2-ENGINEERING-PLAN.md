# Lumey v2.0 — Detailed Engineering Plan

**Companion to `ARCHITECTURE.md`.** That doc is the *what* and *why* (modular pillars,
diagrams, roadmap). This is the *how* and *can-we-actually-do-it* — the engineering
substance behind strong coding agents, low/efficient token usage, a top-notch SDK,
and enterprise guardrails.

> Grounded in the current Claude platform (model IDs, pricing, Agent SDK / Managed
> Agents, prompt caching, effort, batch) as of June 2026. Where this plan leans on a
> platform capability, it names the exact mechanism so the claims are checkable.

---

## 0. The central question: low tokens *and* strong coding — is it real?

Yes — and the reason is that **most tokens in a coding agent are wasted *input
context*, not output.** A coding run's cost is dominated by repeatedly shipping the
repo, the history, and tool outputs back into the model. So the lever isn't a weaker
model; it's **context engineering + caching + routing**, with a genuinely capable
model doing the actual coding.

**Two honest truths that set the strategy:**

1. **Local Gemma-class models cannot code at frontier level.** That's a capability
   gap, not a tuning problem. So we do *not* ask them to. Coding runs on a frontier
   model; local models do the cheap, high-volume work (triage, summarize, extract,
   classify, knowledge-graph extraction).
2. **A frontier coding agent can be made cheap without losing capability** by
   attacking the input-token bill. The platform already gives us the levers:

| Lever | Mechanism | Effect on tokens |
|---|---|---|
| **Prompt caching** | Cache the stable prefix (system + knowledge pack); cache reads bill at **~0.1×** input price, writes at 1.25× (5-min TTL) | The single biggest win — repeated context drops ~90% |
| **Context editing** | Prune stale tool results / thinking blocks mid-run | Keeps the transcript lean without re-summarizing |
| **Compaction** | Summarize earlier context server-side near the window limit | Long runs don't balloon |
| **Effort parameter** | `low → xhigh → max`; `low` for subagents/simple tasks, `xhigh` for the hard coding step | Fewer, more-consolidated tool calls; less preamble |
| **Tiered subagents** | Run sub-tasks (search, file reads) on **Haiku** while the main loop stays on a strong model | Cheap model does the bulk reads; cache stays intact |
| **Task budgets** | Tell the model its token budget for the whole loop; it self-moderates | Graceful wind-down instead of runaway |
| **Batch API** | Non-latency-sensitive work (KG extraction, nightly triage) at **50%** | Halves the cost of the high-volume tail |
| **KG / context compiler** | Retrieve the *minimal sufficient* context from the graph instead of dumping files | Smaller prompts before caching even applies |

**Reference pricing (per 1M tokens):** Opus 4.8 $5 in / $25 out (1M context) ·
Sonnet 4.6 $3 / $15 · Haiku 4.5 $1 / $5 · Fable 5 $10 / $50 (hardest work).
A cache *read* of Opus input is ~$0.50/1M — so a cached 50K-token knowledge pack
costs ~2.5¢ to reuse instead of ~25¢ cold.

**Conclusion:** capability comes from the model choice (Opus 4.8 is state-of-the-art
at long-horizon agentic coding); cost control comes from the seven levers above.
They're independent. That's why "cheap *and* strong" is real.

---

## 1. The decision that makes this buildable: stand on the Claude Agent SDK

We do **not** build the coding-agent loop, the tool runtime, or the execution sandbox
from scratch. We build Lumey as the **control / observability / knowledge plane on top
of the Claude Agent SDK (Managed Agents)**, which already provides exactly the hard
parts we'd otherwise spend months on.

**What we get for free (and would otherwise build):**

| We'd have had to build | Managed Agents provides |
|---|---|
| A coding-agent loop (plan→edit→test→iterate) | Anthropic runs the loop; tools `bash/read/write/edit/glob/grep/web_*` execute in a per-session container |
| A secure sandbox per task | A provisioned container per **session**, isolated |
| Repo clone + git auth without leaking tokens | `github_repository` resource clones the repo; a git proxy injects the token **after** egress — the sandbox never sees it |
| PR creation | GitHub **MCP** `create_pull_request` tool |
| Secret handling | **Vaults** — credentials injected at egress, never enter the sandbox, safe under prompt injection |
| Per-step token telemetry | `span.model_request_end` carries `model_usage` (`cache_creation`, `cache_read`, `input`, `output` tokens) — our observability stream, for free |
| Tool-level human approval | `permission_policy: always_ask` → session pauses, we answer with `tool_confirmation` (allow/deny + message) |
| "Done means done" grading | **Outcomes**: `user.define_outcome` + a rubric runs an iterate→grade→revise loop |
| Cross-session memory | **Memory stores** — versioned, with audit + redact |
| Multi-agent coordination | **Coordinator** agent delegates to sub-agents sharing the container, with per-thread event streams + cross-thread messages |
| Scheduled/triggered runs | **Deployments** — cron-scheduled sessions |

**This resolves gate G2 (sandbox model).** The runtime is the Claude Agent SDK; Lumey
is the plane around it. And critically for the on-prem selling story:

> **Self-hosted sandboxes** (`config: {type: "self_hosted"}`) let tool execution run on
> **the customer's own infrastructure** via an outbound-polling worker — the agent loop
> stays on Anthropic's side, but bash/file/code run in *their* container, so source code
> and egress never leave their network. This is the spine of the "sovereign / air-gapped"
> value play. (Caveat: a couple of conveniences — `memory_store` resources and
> `environment_variable` vault credentials — aren't supported in self-hosted yet; we
> route those through host-side custom tools.)

### The runtime is pluggable (two paths)

```
Kanban task ──► Lumey control plane ──► router picks a path:
   ├─ CODING / hard reasoning  ─► Claude Agent SDK (Managed Agents)
   │                              session + Outcome, self-hosted sandbox on-prem
   └─ AUXILIARY (triage, summarize,─► Local inference (vLLM/Ollama) via a
      extract, classify, KG)         single-call or workflow path — NOT a coding loop
```

The **module contract** from `ARCHITECTURE.md §2.2` is what keeps these
interchangeable: both paths emit the same `RunEvent` stream, so observability, KG, and
HITL don't care which ran.

---

## 2. Agent runtime — task to PR, concretely

**Mapping a kanban card to a run:**

1. The runtime calls `GET /agents/me/next-task` (v1 already built this) → one task.
2. Lumey **compiles context** (the knowledge pack + KG retrieval — see §3) and creates
   a Managed Agents **session** with the repo mounted as a `github_repository` resource.
3. Acceptance criteria on the card become an **Outcome rubric** (`user.define_outcome`)
   — the harness iterates until the rubric passes, hits `max_iterations`, or fails.
4. The agent edits in the sandbox, runs tests via `bash`, pushes a branch, opens a PR
   via the GitHub MCP tool, and posts a summary **comment** back to the task.
5. The agent moves the task to **IN_REVIEW** — the v1 done-gate makes this human-only.
6. Every step streams a `RunEvent`; `model_usage` rolls up into token/cost telemetry.
7. On human merge, the diff + any human edits are captured as a **Correction** (§8).

**Run lifecycle → our tables** (from `ARCHITECTURE.md §7`): session = `AgentRun`;
each `span.*` / tool event = `RunStep` + `RunEvent`; `model_usage` = `TokenUsage`;
`tool_confirmation` pauses = `ApprovalGate`; `define_outcome` grading = quality signal.

---

## 3. The token-efficiency engine (detailed)

This is the pillar you care most about. It's a stack, applied in order:

**a. Compile, don't dump (the context compiler).** Before a run, assemble the
*minimal sufficient* context from the knowledge graph: the 3 relevant decisions, the
files this task touches, the prior run's outcome — not the whole repo, not all 20 docs.
The KG is the index; the compiler is the query planner with a token budget.

**b. Cache the stable prefix.** The compiled knowledge pack + system prompt are
identical across a task's steps → put them first and cache them. Managed Agents caches
historical repeated tokens automatically; for our own auxiliary calls we place
`cache_control` on the last stable block. **Verify** with `cache_read_input_tokens` —
if it's zero, a silent invalidator (a timestamp, unsorted JSON) is in the prefix.

**c. Edit + compact mid-run.** Context editing prunes stale tool results; compaction
summarizes near the window limit. Long coding runs stay bounded.

**d. Route by difficulty.**
- The hard coding/reasoning step → Opus 4.8 at `effort: xhigh`.
- Bulk file reads / search → **Haiku subagents** (keeps the main loop's cache intact).
- Auxiliary tasks (triage, summarize, classify, KG extraction) → **local model**, or
  Haiku, or the **Batch API** at 50% when not latency-sensitive.

**e. Bound the loop.** `task_budget` tells the model its total token allowance so it
winds down gracefully instead of running away (also a guardrail — §7).

**f. The self-calibrating shadow router (the flagship).** Because every run is a pinned
trace, replay shipped tasks against the local model in **shadow** (no repo writes),
compare to the Opus output the human already accepted, and **auto-promote the local
model per task-type** where it matches. Gap cases become training data (§8). Cost falls
over time *because the data decided it was safe*, not because we risked quality.

**Expected shape of the bill:** for a typical coding task, after caching + Haiku
subagents + compaction, the dominant cost is a few Opus `xhigh` reasoning turns; the
high-volume reads and the entire auxiliary/KG workload sit on Haiku/local/batch. That's
how "efficient tokens, no capability hit" actually pencils out.

---

## 4. Strong coding agents — the capability stack

Token thrift is worthless if the agent codes badly. The capability levers:

- **Model:** Opus 4.8 — SOTA long-horizon autonomous coding. `effort: xhigh` for the
  coding step (Claude Code's own default). Fable 5 reserved for the hardest tasks.
- **Spec up front:** give the full task spec in the first turn (acceptance criteria +
  KG context). Opus 4.8's coherence comes from planning against a clear goal — this is
  both better *and* cheaper (fewer turns).
- **Outcomes with rubrics:** acceptance criteria → a gradeable rubric → an independent
  grader iterates the agent until it passes. This is automated quality, not vibes.
- **Self-verification:** instruct the agent to run tests every cycle; use a fresh-context
  verifier sub-agent (outperforms self-critique).
- **Memory:** a memory store per repo so the agent stops re-learning quirks ("tests need
  this env var") — feeds the real-time collective learning idea.
- **Multi-agent for fan-out:** a coordinator decomposes an epic and delegates parallel
  sub-tasks (review, tests, implementation) — sub-agents communicate asynchronously so
  the orchestrator isn't blocked on the slowest.
- **Guardrailed autonomy:** small decisions → act and note; scope changes / destructive
  actions → ask (tool-level `always_ask`). Graduated by the agent's PR-acceptance rate.

---

## 5. The Lumey SDK (top-notch, and distinct from the agent SDK)

Two different SDKs — don't conflate them:

- **Agent Runtime SDK = the Claude Agent SDK.** We *consume* it to run coding agents.
- **Lumey Platform SDK = ours.** It's how *any* runtime (Claude Agent SDK, a local
  runtime, a third-party agent, a human's IDE) integrates with the Lumey plane. This is
  the SDK that makes Lumey pluggable and sellable.

**Design principles:** TypeScript-first (Python parity for the ML/serving side); typed,
schema-validated; thin over a stable REST/event API; everything an agent does flows
through it so observability/KG/guardrails are automatic.

**Surface (v1 control-plane endpoints are the seed):**

| Capability | SDK call (illustrative) | Backed by |
|---|---|---|
| Pull work | `lumey.tasks.next()` | v1 `GET /agents/me/next-task` |
| Get compiled context | `lumey.context.compile(taskId)` | knowledge pack + KG (§3) |
| Emit a trace event | `lumey.runs.event({...})` | observability stream |
| Report token/cost | `lumey.runs.usage({...})` | v1 budget-increment + `model_usage` |
| Request human review | `lumey.hitl.requestReview({...})` | done-gate + `ReviewRequest` |
| Ask a clarifying question | `lumey.hitl.clarify({...})` (blocks) | `ClarificationRequest` |
| Gate a risky action | `lumey.hitl.approve({...})` | `ApprovalGate` / `tool_confirmation` |
| Link PR / commit / test | `lumey.git.link({...})` | git telemetry tables |
| Read/write shared memory | `lumey.blackboard.*` / `lumey.kg.query()` | inter-agent comms + KG |
| Register a skill | `lumey.skills.publish({...})` | self-codifying skill library |

**Guardrails live in the SDK, not in each agent.** Secret-scanning, path/command
allowlists, and budget checks are enforced on the SDK boundary, so a misbehaving or
third-party agent can't bypass them.

---

## 6. Guardrails — enterprise-grade, layered

Defense in depth, each layer mapped to a concrete mechanism (native or built):

**Pre-execution (policy)**
- Path / repo / command **allowlist** — what an agent may touch (enforced at the SDK
  boundary + sandbox).
- **Networking limits** — Managed Agents `limited` egress (deny-by-default +
  `allowed_hosts`); on-prem self-hosted controls egress entirely.
- **Reproducibility pin** — pin the exact prompt + compiled context + model version per
  run (agent versioning gives this).

**In-execution (containment)**
- **Sandbox isolation** — per-session container; on-prem self-hosted for sovereignty.
- **Secrets never in the sandbox** — Vaults inject at egress; the git proxy injects repo
  tokens after the request leaves the container. Safe under prompt injection.
- **Tool-level approval** — `permission_policy: always_ask` on dangerous tools (e.g.
  `bash`) → session pauses → human `tool_confirmation`.
- **Task budget** — model self-moderates against a token ceiling.

**Post-execution (verification)**
- **Secret-scan the diff** before any commit (reuse `.gitleaks.toml`).
- **Tests must pass** (Outcome rubric) + human review gate (IN_REVIEW is human-only).

**Meta (fleet safety)**
- **Cost circuit breaker** — auto-pause an agent/project at its budget ceiling (platform
  enforces, not the runtime).
- **Runaway / loop detection** — step + cost ceilings per run.
- **Deadlock + poison-task** — cyclic-dependency detection; auto-escalate a task to a
  human after N failed attempts instead of burning budget.
- **Fleet circuit breaker** — error-rate spike pauses the fleet.
- **Immutable audit log** — every event retained for compliance; memory versions support
  redaction for PII/secret-leak response.

---

## 7. Local model serving & the router

- **Serving:** vLLM or Ollama, on-prem; exposed as a `ModelEndpoint`. For coding under
  full air-gap, pair local serving with Managed Agents **self-hosted sandboxes** (loop
  logic stays external) or a fully local runtime (accepting weaker coding) — this is the
  open G1 tradeoff, surfaced per buyer.
- **Router:** picks model per task-type from a `RoutingPolicy`. Records which model ran
  which step + the outcome → feeds the shadow-router promotion loop (§3f).
- **Training loop:** human Corrections → fine-tune the local model on the customer's own
  code, never leaving their network. Optional federated weight-delta sharing (no code
  shared) as a later, category-defining bet.

---

## 8. The correction → training-data loop

Every human edit or rejection of an agent PR is a labeled pair. Capture: the compiled
context, the agent's output, the human's corrected version, and the rubric verdict.
This becomes the fine-tuning dataset that improves the on-prem model on *this customer's*
codebase — the moat. Memory-store versioning + the immutable event log give us the audit
trail; the shadow router (§3f) decides when the improved model is ready for more work.

---

## 9. Revised phased plan (SDK decision folded in)

**Phase 0 — Foundation + kernel**
Init `lumey` repo + monorepo; build the kernel (module registry, event bus,
entitlements, IAM/tenancy); port the spine into `kanban` + `git` modules; slim the
Prisma schema; Postgres up.
*Done when:* kernel boots, validates a dependency graph, runs `kanban` + `git`.

**Phase 1 — Agent runtime on the Claude Agent SDK + observability (keystone)**
Wrap Managed Agents: task → session (repo mounted) → Outcome from acceptance criteria →
PR + comment → IN_REVIEW gate. Map the event stream to `AgentRun/RunStep/RunEvent` +
`TokenUsage`. Ship a trace viewer.
*Done when:* a real kanban task produces a reviewed PR, fully traced — and observability
can be toggled off without touching the runtime (proves the module model).

**Phase 2 — Token-efficiency engine + deeper HITL**
Prompt caching (verified via `cache_read_input_tokens`), context editing, compaction,
effort routing, Haiku subagents, task budgets, batch for auxiliary. HITL: review-request,
approval gates (`tool_confirmation`), clarification loop. Git/test telemetry linked to runs.
*Done when:* cache-hit rate + cost-per-task are dashboards, and a tuned task shows a
measured cost drop with no rubric-pass-rate regression.

**Phase 3 — Knowledge graph + context compiler**
Postgres nodes/edges fed by the event stream + git/doc ingest; the compiler assembles
minimal context from the graph.
*Done when:* runs draw context from the KG and average prompt size drops.

**Phase 4 — Inter-agent comms + self-calibrating router**
Message bus / blackboard (or Managed Agents multiagent for the coding path); orchestrator
decomposes epics; shadow-replay the local model and auto-promote per task-type.

**Phase 5 — Local serving + training loop**
vLLM/Ollama; self-hosted sandboxes for on-prem; Corrections → fine-tune; optional
federated deltas.

> Safety/guardrails (§6) are woven into **every** phase.

---

## 10. Resolved gates & honest unknowns

| Gate | Resolution |
|---|---|
| **G2 sandbox model** | **Resolved** — stand on the Claude Agent SDK; per-session containers, self-hosted for on-prem |
| **G1 local-model role** | **Router** confirmed: frontier (Opus 4.8) codes via the Agent SDK; local does auxiliary. Full-local coding stays an explicit per-buyer downgrade |
| **G5 modularity depth** | Soft (one Postgres, entitlement-gated) on day one |
| **G3 launch line** | Modules 1–5 + model-router + safety at launch; 6/7/8 fast-follow |
| **G4 ICP** | Still open — gates which v1 modules get cut and the on-prem emphasis |

**Honest unknowns to validate early:**
- Self-hosted sandboxes don't yet support memory-store resources or env-var vault creds —
  on-prem memory + secrets route through host-side custom tools until that lands.
- Managed Agents runs Claude only — the local coding path needs a *separate* runtime
  (self-hosted sandbox keeps the loop external; a fully local runtime is a bigger build).
  Prove the auxiliary local path (triage/extract) first; treat local *coding* as research.
- Per-buyer data-retention / ZDR constraints affect which models are usable — confirm
  with the regulated ICP before committing the air-gapped story.
