# Changelog — Lumey (Command Center v2.0)

An enterprise-grade, modular, **agentic** software-engineering platform: AI agents
pick up kanban tasks, write & test code, open PRs, and tag humans for review —
with an in-house runtime and SDK built **from scratch, no external agent SDK**.

This log is the single source of truth for *what we've built and why*. Milestones
ship incrementally — each one tested, documented, committed, and (from M2.9 on)
pushed to `Exargen-AI/lumey`. Per-module detail lives in
[`docs/modules/`](docs/modules/); the build plan + decision record is
[`docs/architecture/in-house-sdk-and-runtime.md`](docs/architecture/in-house-sdk-and-runtime.md);
illustrated guides:
[runtime](docs/architecture/lumey-runtime-sdk-guide.md) ·
[SDK](docs/architecture/lumey-sdk-guide.md).

Format note: ✅ done · ⏳ next. Commit hashes in parentheses.

---

## Foundation (M0–M1) — the kernel & first modules

- **M0 — Kernel** ✅ `496341c` — `ModuleRegistry` (dependency-graph validation,
  entitlement gating, mount + boot), `EventBus` (typed in-process pub/sub),
  `ConfigEntitlements`; **comments** as the first capability module.
- **M1 — Modules & agent control plane** ✅ `929cdf5`, `8819622`, `52bbc48` —
  **notifications** as the 2nd module (subscribes to `comment.created`); the
  agent **Definition-of-Ready** gate; **mixed assignment** (human / named agent /
  agent pool, atomic claim).
- Lean-down to the agentic core ✅ `82c9e21`, `fe9bbe7` — removed
  Exargen-specific features; zero dead code.

## Part A — the Agent Runtime (in-house, behind a seam)

The engine that *executes* a run. Built from scratch as the `native` runtime
behind a stable `RuntimeAdapter` seam, with a deterministic `reference` simulator
covering the UI throughout.

- **M2.1 — Run model** ✅ `e624ff0` — `AgentRun`/`RunStep`/`RunEvent`, a validated
  lifecycle state machine, and a runtime-neutral run service emitting the trace.
- **M2.2 — RuntimeAdapter seam** ✅ `cef1eb7` — the firewall + the `reference`
  adapter (deterministic simulator) + registry + orchestrator. Decision to build
  in-house locked in (`b1031de`).
- **M2.3 — Start-run API + live trace UI** ✅ `86da916` — dispatch an agent and
  watch the run trace; verified in-browser.
- **M2.4 — ModelClient** ✅ `3478505` — model-agnostic inference over raw HTTP
  (OpenAI-compatible; local *or* frontier), typed errors, retry/timeout, tool
  calls, streaming. No vendor SDK.
- **M2.5 — ToolRunner + Sandbox** ✅ `c7301d6` — the agent's guarded, isolated
  hands: git-worktree workspace (path-contained, bounded exec), guardrailed
  tools, errors-as-data.
- **M2.6 — ContextEngine** ✅ `e3a9c9f` — token efficiency: prefix-stable
  assembly, context editing, budget compaction.
- **M2.7 — LoopController → `native` adapter** ✅ `2312927` — composes Model +
  Tools + Sandbox + Context into the agentic loop with step/token safety rails;
  the in-house runtime executes end to end.
- **M2.8 — Finalize tools + repo-aware workspace** ✅ `6aabe5c` — `run_tests`,
  `git_commit` onto a per-run branch; runs operate on a real checkout.
- **M2.9 — open_pr + PR linking** ✅ `f65c762` — the GitProvider seam +
  `referenceGitProvider`; opens a PR and links it to the task (Linked PRs).
- **M2.10 — real `github` provider** ✅ `65ec146` — pushes the branch + opens a
  real PR via the REST API; token redacted from output.
- **M2.11 — run usage & cost** ✅ `232fa5a` — token usage captured on the run,
  surfaced via API + SDK; cost derived from a current pricing table.
- **M2.12 — per-project repo config** ✅ `29646f7` — PRs target each project's
  own repo (resolved from its GitHub integration); `defaultBranch`.
- **M2.13 — workspace clone management** ✅ `57cb3d0` — clone the project repo
  into a per-project cache, worktree from it; token never persisted to disk.
- **M2.14 — background execution** ✅ `caaa263` — runs execute detached (request
  returns QUEUED immediately); error isolation; adapter-aware cancel via
  `adapterId`; restart reaper.
- **M2.15 — GitHub App installation-token auth** ✅ `581db93` — short-lived,
  auto-rotating tokens (RS256 JWT → installation token, cached) preferred over a
  PAT.
- **M2.16 — cross-run memory** ✅ `9705890` — the runtime recalls prior project
  learnings into a stable context preamble and records run summaries;
  `capabilities().memory = true`.
- **M2.17 — Outcomes** ✅ — the agent grades its result vs the acceptance
  criteria and revises before requesting review (bounded by `maxRevisions`);
  `capabilities().outcomes = true`.
- **M2.18 — multi-agent** ✅ — the lead `delegate`s focused sub-objectives to
  worker sub-agents (orchestrator-worker / hub-and-spoke) with **isolated
  context**, the shared sandbox, bounded budget, and no-recursion guardrails;
  `capabilities().multiAgent = true`. **Native caps now all on: self-hosted ✓ ·
  memory ✓ · outcomes ✓ · multi-agent ✓.**
- **M2.19 — semantic RAG (local embeddings)** ✅ — memory recall upgraded from
  recency to **cosine similarity over local embeddings** (`nomic-embed-text` via
  Ollama, 768-dim): an `EmbeddingClient` (raw HTTP, local-only) + `lib/vector`
  (cosine / rank); the native adapter embeds the task to recall *relevant*
  learnings and embeds the summary on record. Degrades to recency when no
  embedding model is set. Verified live (0.70 same-meaning vs 0.37 unrelated).

## Part B — the Platform SDK (in-house, schema-first)

The typed client agents & integrations use to talk to Lumey. One contract →
TypeScript *and* generated Python, with a drift guard.

- **M3.1 — SDK TypeScript core** ✅ `a8ace1b` — schema-first contract (zod →
  inferred types), typed errors, idempotent writes, resilient transport,
  `tasks.next` / `runs.start|list|get|cancel`; verified end-to-end live.
- **M3.2 — Python codegen + more** ✅ `0b5b1d7` — generated dependency-free
  Python client; operations manifest + drift guard; resumable `runs.events`
  stream; illustrated SDK guide.
- **Run usage in the SDK** ✅ (with M2.11) — token fields + `runs.usage` with
  cost estimation; Python regenerated.

## Live verification

- **First live `native` run on a local model** — Ollama + `qwen2.5-coder:7b`,
  wired via `LUMEY_LOCAL_MODEL` (no code change — just config, proving the
  model-agnostic seam). A real run drove the loop end to end and the **Outcomes
  grade→revise loop was visible in the trace** (self-grade FAIL → revise →
  self-grade PASS → request review). Confirmed: small local models narrate tool
  use under complex prompts (a model-quality limit, not a runtime one) — a
  frontier model resolves it via the same seam.
- **Fix surfaced by the run:** local models default to a **300s** request
  deadline (a 7B cold-load alone is ~30–60s); env-override `LUMEY_MODEL_TIMEOUT_MS`.

## Enterprise hardening — Phase 1 (Glass Cockpit)

Plan: [`docs/planning/ENTERPRISE-PLAN.md`](docs/planning/ENTERPRISE-PLAN.md).

- **P1.1 — SSE live run trace** ✅ — runs are no longer a polled black box. A
  **single-use, ~30s, run-scoped stream ticket** (minted over the Bearer-authed
  `POST …/stream-ticket`) authenticates a browser `EventSource` (which can't send
  headers); `GET …/stream` forwards the run's `run.*` bus facts **signal-only**
  (the client refetches the authoritative detail), with heartbeats + idempotent
  teardown on disconnect/terminal/cap. Frontend `useRunStream` live-invalidates
  the React Query caches + shows a "● live" pill; re-mints on reconnect (the
  ticket is single-use). Verified live end-to-end (events streamed as they
  happened; ticket replay → 401).
- **P1.2 — run pause/resume** ✅ — control follows visibility: a human can now
  **suspend a run in place and resume it**, not just kill it. A new `PAUSED`
  lifecycle state (`RUNNING ↔ PAUSED`) backs a **cooperative** suspend — a
  `PauseController` parks the agentic loop at its next *turn boundary* with the
  transcript + sandbox kept alive in memory, so resume continues exactly where it
  left off (a cancel still wins over a pause, so it never strands the loop).
  Orchestrator `pauseRun`/`resumeRun` flip the loop flag then move the DB
  (RUNNING-first on resume, so every later transition stays legal); guarded to a
  run that is RUNNING, **in-flight on this server**, and on a runtime that can
  suspend (the fire-and-forget `reference` adapter declines). The boot reaper now
  also fails interrupted `PAUSED` runs (their state is in-memory only). Wired
  through the SDK enum + Python, and the FE (Pause/Resume buttons + a "Paused"
  pill). Verified by mock-model loop tests (parks → resumes; cancel beats pause)
  + lifecycle/orchestrator/reaper units.

## Enterprise hardening — Phase 2 (Human-in-the-Loop)

Plan: [`docs/planning/ENTERPRISE-PLAN.md`](docs/planning/ENTERPRISE-PLAN.md) ·
module guide: [`docs/modules/HUMAN-IN-THE-LOOP.md`](docs/modules/HUMAN-IN-THE-LOOP.md).

- **P2.1 — clarification round-trip** ✅ — the first *two-way* collaboration: the
  agent can **ask a human a question mid-run and continue with the answer**. A new
  lead-only `ask_human` **control tool** is intercepted by the loop (never
  dispatched to the sandbox): it opens a `RunClarificationRequest` (PENDING),
  parks the run on **AWAITING_INPUT** via a `ClarificationController` (transcript
  + sandbox alive in memory, like pause but carrying an answer back), and on a
  human answer injects it as the tool result and resumes (AWAITING_INPUT →
  RUNNING). The human answers over `POST …/clarifications/:id/answer`, which wakes
  the parked loop **first** then persists ANSWERED (so a dead/raced run is
  rejected before it's marked answered); a cancel while waiting resolves the wait
  and finishes CANCELLED. The boot reaper now also fails interrupted
  AWAITING_INPUT runs and cancels their open questions. FE: the run card shows the
  agent's question with an inline answer box (live via the SSE invalidation).
  Verified by mock-model loop tests (ask → park → answer → resume; cancel-while-
  waiting → CANCELLED) + service/orchestrator units; backend boots with the new
  routes registered (401/403 gated, not 404).
- **P2.2 — approval gate** ✅ — a human checkpoint *before* the agent does
  something outward. Before a high-risk tool call (default `open_pr`, configurable
  via `LUMEY_APPROVAL_TOOLS`) the loop opens a `RunApprovalRequest` and parks on
  AWAITING_INPUT: **approve** → the action runs; **reject** → it is refused with an
  `ok:false` result carrying the reason, and the agent continues and picks another
  path. The gate lives in the loop's per-call execution (`runTools`), so *any*
  tool can be gated. Built on a shared `Rendezvous<T>` parking primitive — the
  clarification controller was refactored onto it too, so there's one mechanism,
  not two. `POST …/approvals/:id/{approve,reject}` wakes the loop first then
  persists the decision (raced/dead run rejected before being marked decided); the
  reaper cancels open approvals on restart. FE: an Approve/Reject panel (with
  reason) on the run card, live. Verified by mock-model loop tests (approve→runs;
  reject→refuses + feeds reason back; cancel-while-waiting→CANCELLED) +
  service/orchestrator units; backend boots with the routes registered.
- **P2.3 — HITL Inbox** ✅ — the cross-task view that makes the collaboration loop
  usable at team scale: one place listing **every run waiting on a human** —
  PENDING clarifications *and* approvals — oldest-wait first, each with its
  project/task context and an inline action (answer / approve / reject). Backend
  `runInbox.service` + `GET /api/v1/inbox`, scoped server-side to what the viewer
  may see (agent work → gated by the agent-visibility allowlist, then by
  `project.view_all` or project membership). FE `/agent-inbox` page + a sidebar
  entry; acting resumes the run and drops the item. Verified by service units
  (visibility gate, oldest-first merge, project scoping) + **live in the browser**
  (real data: the date-library question + the `open_pr` approval, both
  actionable). First feature shown via the new local-demo loop.

## Enterprise hardening — Phase 3 (SDLC graph)

Module guide: [`docs/modules/SDLC-GRAPH.md`](docs/modules/SDLC-GRAPH.md).

- **P3.1 — run → commits → PR → checks pipeline** ✅ — turns "a PR was opened"
  into a living view of the agent's delivery from edit to merge, on the task card.
  New `RunCommit` / `RunPullRequest` / `RunCheck` entities populated from two
  sources: the agent's finalize tools as they fire (`git_commit` records a commit;
  `open_pr` records the PR alongside the existing task link) and **GitHub
  webhooks** — a new `check_run` branch attaches CI status to the run's PR (matched
  by run branch, scoped to the project, idempotent on the check id), and the
  `pull_request` webhook now also keeps the run PR's state current. All idempotent
  so replays/retries never duplicate. `GET …/runs/:runId/sdlc` assembles the
  chain; a polished **Delivery pipeline** strip on the run card renders
  `commits → PR (state badge) → checks` with status colours (green pass / red
  fail / amber running), each clickable to GitHub, live via the SSE invalidation.
  Verified by service units (record/assemble + the `check_run` mapping & scoping)
  + **live in the browser** (commits → PR #142 → 4 CI checks: 2 passed · 1 failed ·
  1 running).

## Enterprise hardening — Phase 4 (Governance)

Module guide: [`docs/modules/GOVERNANCE.md`](docs/modules/GOVERNANCE.md).

- **P4.1 — RunReceipt** ✅ — the governance answer to "prove what this run
  *actually* did". When a run comes to rest (AWAITING_REVIEW or terminal) a bus
  subscriber issues a **tamper-evident receipt**: an immutable snapshot — identity,
  outcome, timing, token usage, and the work it produced (steps + step-type
  breakdown, commits, PR, checks passed/failed) — hashed into a `digest`
  (**HMAC-SHA256** when `LUMEY_RECEIPT_SECRET` is set, SHA-256 otherwise) over a
  canonical (key-sorted) serialization, so any later edit to the stored snapshot
  is detectable. Upserted each rest, so a resume-then-rest refreshes it. Cost is
  deliberately absent — the platform measures **tokens** (the honest, model-
  agnostic unit; local-first). `GET …/runs/:runId/receipt` returns the receipt
  with a recomputed-on-read **`verified`** flag. FE: a "Run receipt" certificate
  panel on the run card (Verified/Tampered badge, key facts, copyable digest).
  Verified by service units (snapshot assembly + **tamper detection**: edit the
  content → `verified:false`) + **live in the browser** (Verified · sha256 ·
  23,552 tokens · 4m 12s · 2 commits · PR #142 · checks 2✓ 1✗).

- **P4.2 — AgentPolicy + Budget + circuit breaker** ✅ — the receipt's mirror
  image: it proves what a run *did*; the policy controls what an agent is
  *allowed* to do. A per-agent `AgentPolicy` carries a **kill-switch** (a disabled
  agent can't start runs — enforced in `startRun`), a **tool allowlist** (least
  privilege: the native adapter filters the advertised toolset to it, and the
  loop refuses any denied call with an unmistakable "Blocked by policy: x" trace
  entry — defence in depth), and **per-run token/step ceilings** (the circuit
  breaker, fed into the loop budget). Absent ⇒ unrestricted (backward-compatible).
  `GET/PUT /agents/:id/policy` (read = `user.view`, write = `user.edit`). FE: a
  "Governed by policy" panel on the run card (tool count + caps + model chips,
  allowlist), and the blocked-tool step renders in the live trace. Verified by
  service units (defaults/mapping/validation) + loop units (denied tool → blocked
  step, allowed tool runs) + orchestrator unit (kill-switch) + **live in the
  browser** (bash blocked; 9 tools · 60k token cap · 18 step cap).

- **P4.3 — Activity.actorType (audit attribution)** ✅ — closes Phase 4: every
  activity-log entry now records whether a **HUMAN or an AGENT** performed it,
  captured at write time in `logActivity` (derived from the actor, or passed
  explicitly from a known agent path). This is the **immutable audit fact** — kept
  deliberately distinct from the actor's *current* `user.userType` (used for
  access-masking): it stays correct even if the user is later retyped or deleted,
  and is **indexed** so "every agent-initiated action" is a cheap compliance
  query (no join). Backfilled for existing agent rows. The activity feed surfaces
  it as a "🤖 agent" badge next to the actor. Verified by service units
  (explicit / derived / default-on-missing / transactional) + **live in the
  browser** (Lumey Agent · agent · commented on / moved a task).

## Enterprise hardening — Phase 5 (Fleet & model routing)

Module guide: [`docs/modules/MODEL-ROUTING.md`](docs/modules/MODEL-ROUTING.md).

- **P5.1 — 3-option model router** ✅ — the sovereign, local-first model strategy
  made first-class, all behind the one `ModelClient` seam. A provider registry
  reads the deployment env into three tiers — **LOCAL** (Ollama/llama.cpp, air-gap,
  zero cost, the default direction) → **SELF_HOSTED** (OSS on vLLM/TGI) →
  **FRONTIER** (a controlled, opt-in gateway, API-key-gated) — and routes each run:
  an agent's **policy model** (`AgentPolicy.model`, P4.2) wins if its tier is
  configured, else the default tier, else the first configured in priority order
  (sovereign first, frontier last). Pure, tested selection; the native adapter now
  builds its model via `modelClientForContext({ preferredModel })`. `GET
  /models/providers` returns **redacted** descriptors (status + which is default,
  never a key or credentialed URL). FE: a polished **Models** admin page (the three
  tiers, configured/default badges, model + endpoint). Verified by provider/router
  units (priority order, backend-hint fallback, preferred-model match, credential
  redaction) + factory routing units + **live in the browser** (all three tiers
  configured, local default, no key leak).

- **P5.2 — Fleet dashboard** ✅ — finishes Phase 5: the operator's cross-system
  view of the agent fleet. `fleet.service` aggregates `AgentRun` into a rollup —
  active/total/24h counts, total tokens, lifecycle distribution by status, and a
  **per-agent** breakdown (runs · active · failed · tokens) — plus a recent-runs
  list (task/agent/model/tokens), filterable by status. `GET /fleet/overview` +
  `/fleet/runs`, scoped server-side (agent-visibility + project membership, like
  the inbox). FE: a polished **Fleet** admin page (stat cards, lifecycle strip,
  agents table, runs table) that polls to stay roughly live. Verified by service
  units (visibility gate, project scoping, aggregation math) + **live in the
  browser** (14 runs · 12 active · 2 failed · 39,401 tokens).
- **Docs: screenshots are now committed assets, not prose.** Added a reproducible
  Playwright capture script (`docs/scripts/capture-screenshots.mjs`) that drives
  the running app and saves real PNGs into `docs/modules/images/`, embedded with
  detailed captions across the module guides (Fleet, Models, SDLC, Governance,
  HITL). Re-runnable whenever the UI changes — the docs show the actual product.

## Health (current)

1225 backend tests + 39 SDK tests green · typecheck clean (backend + frontend +
sdk) · zero dead exports · green at every commit.
