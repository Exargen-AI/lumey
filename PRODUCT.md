# Lumey — Product Status

**Lumey (Command Center v2.0)** is an enterprise-grade, modular, **agentic
software-engineering platform**: AI agents pick up kanban tasks, write & test
code, open pull requests, and tag humans for review — running entirely on a
team's **own local models**, with a built-from-scratch runtime and SDK and **no
external agent SDK**.

> **Status:** the agentic core is **built, tested, and proven live**. The `native`
> runtime is **capability-complete** (self-hosted · memory · outcomes ·
> multi-agent) and has executed real runs against a local model end-to-end.
> 40 commits on `Exargen-AI/lumey`, **1,114 backend + 39 SDK tests green**, zero
> dead code.

---

## 1. What Lumey is (the product)

A team manages work on a familiar **kanban board** (projects, tasks, sprints,
reviews, a client portal). The difference: tasks can be picked up and executed by
**AI agents** instead of — or alongside — humans. An agent:

1. **Pulls a ready task** (gated by a Definition-of-Ready),
2. **Works in an isolated git workspace** — reads the repo, writes & edits code,
3. **Runs the tests**, **self-grades** against the task's acceptance criteria and
   **revises** until it passes,
4. **Commits to a branch and opens a real pull request**,
5. **Tags a human for review** — agents propose, humans dispose.

Every step is **observable** (a live trace), **costed** (token usage), **safe**
(sandboxed, guardrailed), and **resumable**. Humans and agents share the same
board, the same review gate, and the same audit trail.

### The wedge (why it's different)

- **Sovereign / on-prem / air-gap.** The entire agent runs on **local models**
  (Ollama / vLLM) — no code, prompt, or data ever leaves the network. A hosted
  agent service structurally cannot offer this; Lumey is built for it.
- **Own the loop.** The agent runtime — the loop, tools, sandbox, context engine,
  memory, multi-agent orchestration — is **ours, from scratch**. No vendor can
  deprecate, reprice, or gate us. The model is a *dependency*; the runtime is not.
- **Model-agnostic by construction.** A stable `ModelClient` seam speaks the
  OpenAI-compatible wire format, so any local model works and swapping is a config
  change. (Online frontier APIs are deliberately **not** the direction.)

---

## 2. Where it stands — status at a glance

| Capability | State | Evidence |
|---|---|---|
| **Agent executes a task end-to-end** (write → test → commit → PR → review) | ✅ built | full-flow e2e over a real git worktree |
| **Runs on a local model, live** | ✅ proven | Ollama + `qwen2.5-coder:7b`; Outcomes loop visible in the trace |
| **Self-grading + revise (Outcomes)** | ✅ built | grade→revise→pass observed live |
| **Cross-run memory, semantic (RAG)** | ✅ built | local embeddings; 0.70 vs 0.37 relevance verified live |
| **Multi-agent delegation** | ✅ built | isolated-context workers on a shared sandbox |
| **Real GitHub PRs + App-token auth** | ✅ built | push + create PR via REST; short-lived tokens |
| **Background execution + cancel** | ✅ built | request returns immediately; adapter-aware cancel |
| **Typed SDK (TypeScript + Python)** | ✅ built | one schema → two clients; verified live |
| **Live trace UI on the task card** | ✅ built | verified in-browser (reference adapter) |
| **Reliable tool use on small local models** | ⚠️ model-bound | 7B reliable; 3B narrates — a model-quality limit, not a runtime one |
| **Parallel multi-agent fan-out** | ⏳ next | delegation is sequential today |
| **Per-project repo provisioning UI** | ⏳ next | wired via config; UI to follow |

---

## 3. The product, in detail

### 3.1 The agent runtime (the core — built in-house)

The engine that *executes* a run, behind a stable `RuntimeAdapter` seam (a
`reference` simulator for demos + the real `native` runtime). The `native`
runtime composes five from-scratch components in an agentic loop:

- **ModelClient** — model-agnostic inference over raw HTTP (OpenAI-compatible,
  local), typed errors, retry/timeout, tool calls, streaming.
- **ToolRunner + Sandbox** — the agent's guarded, isolated hands: a git-worktree
  workspace with **path containment** + **bounded, shell-free exec**;
  guardrailed tools (`read_file`, `write_file`, `edit_file`, `grep`, `bash`,
  `run_tests`, `git_commit`, `open_pr`, `delegate`); **errors are data**, not
  crashes.
- **ContextEngine** — token efficiency: prefix-stable assembly (cache-friendly),
  context editing, budget compaction, and a **semantic-memory preamble** (RAG).
- **LoopController** — the think→act→observe loop with **safety rails** (step +
  token budgets), **Outcomes** self-grading (grade→revise→review), and a
  `delegate` path for **multi-agent** work (isolated-context workers).
- **Memory** — cross-run learnings recorded per project and recalled by
  **semantic similarity** (local embeddings), so the agent doesn't relearn a
  project every time.

**Runtime capabilities (all on):** self-hosted ✓ · memory ✓ · outcomes ✓ ·
multi-agent ✓.

**Observability & cost.** Every turn and tool result is an immutable
`RunStep`/`RunEvent` on the trace; token usage is captured per run and surfaced
via the API + SDK (cost derived from a current pricing table). Runs execute in
the **background** and are **cancellable** (the adapter aborts in-flight work);
runs orphaned by a restart are reaped.

### 3.2 The kanban & collaboration platform

The product surface agents and humans share:

- **Projects, Tasks, Sprints, Epics, Milestones**; task types, priorities,
  statuses, status history.
- **Assignment** — human, a named agent, or an **agent pool** (atomic claim);
  agent pickup gated by a **Definition-of-Ready**.
- **Comments** (incl. structured story-updates), **Activity** audit log,
  **Notifications**, **standups** (daily updates), **client portal** (decisions,
  deliverables, acknowledgments, status signals), **custom fields**.
- **GitHub integration** — inbound webhooks link PRs to tasks; the agent's
  `open_pr` lands in the *same* "Linked PRs" surface.
- **RBAC** — roles, permissions, refresh-token auth, idempotent writes (so an
  agent's retried request never duplicates).

### 3.3 The Platform SDK (typed front door)

The client any agent or integration uses to talk to Lumey — **schema-first**:
one `zod` contract generates a **TypeScript** client *and* a **Python** client
(dependency-free), kept honest by a **drift test**. Typed errors, idempotent
writes, a resilient transport, a resumable `runs.events` stream, and
`runs.usage` (with cost estimation). Both clients verified end-to-end live.

---

## 4. Architecture

```
Kanban task ──► start-run API ──► RuntimeAdapter seam (firewall)
                                   ├─ reference (simulator, default)
                                   └─ native (in-house runtime)
                                        LoopController
                                        ├─ ContextEngine (+ semantic memory)
                                        ├─ ModelClient ─► a LOCAL model (Ollama/vLLM)
                                        ├─ ToolRunner + Sandbox (git worktree)
                                        └─ delegate ─► worker sub-agents
                                        finalize ─► run_tests · git_commit · open_pr ─► PR
```

- **Kernel** — a small module system (`ModuleRegistry`, typed `EventBus`,
  entitlements). Capabilities (comments, notifications, agent-runtime) are
  modules.
- **Two firewalls** make everything swappable: the `RuntimeAdapter` seam (which
  runtime executes) and the `ModelClient` seam (which model). Nothing above a
  seam knows what's behind it.

Illustrated deep-dives:
[runtime guide](docs/architecture/lumey-runtime-sdk-guide.md) ·
[SDK guide](docs/architecture/lumey-sdk-guide.md) ·
[learning guide](docs/learning/THE-LUMEY-LEARNING-GUIDE.md) (concepts from zero).

---

## 5. What's proven (and what isn't)

**Proven live:**
- A `native` run on a local model drove the loop end-to-end with the **Outcomes
  grade→revise loop visible in the trace**.
- **Semantic memory** retrieves by meaning (0.70 same-topic vs 0.37 unrelated).
- Both **SDK clients** (TS + Python) drive real runs against the live backend.
- The **trace UI** renders a run on the task card (verified in-browser).

**Honest limitations:**
- **Small-model tool reliability.** A 3B model *narrates* tool use instead of
  emitting structured tool calls under a complex prompt; a 7B coder is reliable.
  This is a model-quality limit — the runtime is unchanged and model-agnostic.
- **Sequential delegation** (no parallel fan-out yet).
- **Repo/auth via env + project config**; a provisioning UI is pending.
- **Product scope is broad** (full PM + client portal). The schema is lean (no
  dead models) but a leaner *agentic-MVP* scope reduction is available as a
  product decision (see `docs/architecture/schema-audit.md`).

---

## 6. Engineering quality

- **1,114 backend + 39 SDK tests green**, **zero dead exports**, typecheck clean
  across `backend` / `frontend` / `sdk` — enforced at **every commit**.
- **Security by construction** — sandbox isolation, path containment, guardrails
  at the tool boundary, secret/token redaction, immutable audit trace, idempotent
  writes.
- **Performance for local models** — flash-attention + KV-cache tuning,
  keep-alive, a startup **model warm-up**, and prefix-stable prompts
  (see `docs/architecture/local-model-performance.md`).
- Built **MoSCoW-scoped, milestone by milestone**, tested + documented + committed
  each step. Full log: [`CHANGELOG.md`](CHANGELOG.md).

## 7. Tech stack & layout

- **Monorepo** (npm workspaces): `shared` · `sdk` · `backend` · `frontend`.
- **Backend:** TypeScript (strict), Express, Prisma + PostgreSQL (34 models),
  Vitest. **Frontend:** React + Vite + Tailwind (obsidian dark theme).
- **SDK:** TypeScript core (zod) + generated Python (`urllib`, dependency-free).
- **Models:** local via Ollama (`qwen2.5-coder:7b`, `nomic-embed-text`, …).
- **Repo:** `Exargen-AI/lumey` (private), `~/LUMEY/lumey`.

## 8. Roadmap (next)

1. **Parallel multi-agent fan-out** + a plan→synthesize orchestration step.
2. **Repo provisioning UI** + per-project model/embedding settings.
3. **Richer guardrailed tools** and finer-grained tool-use steering for small
   models.
4. **Optional scope-reduction** to a lean agentic-kanban MVP (a product call).

---

*Single source of truth for the build: [`CHANGELOG.md`](CHANGELOG.md). Per-module
detail: [`docs/modules/`](docs/modules/).*
