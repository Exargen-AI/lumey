# Lumey — Command Center v2.0

**A kanban-native, agentic software-engineering platform.** Humans and AI agents
work from one board: an agent picks up a task, works in an isolated git workspace,
writes and tests code, opens a pull request, and hands it to a human for review —
while you watch it happen live, stay in control, and keep a tamper-evident record
of everything it did.

Built **in-house, from scratch — no external agent SDK** — to be useful for a small
internal team *today* and sellable to an enterprise tomorrow.

> Monorepo: TypeScript · React + Vite + Tailwind · Express + Prisma + Postgres ·
> a from-scratch agent runtime + a schema-first SDK.

![The Fleet console — every agent run across the system](docs/modules/images/fleet.png)

---

## Why Lumey

Three things set it apart, and every design decision protects them:

1. **Kanban-native agent execution.** Agents and humans share one board. Agents
   are real users with roles; the **done-gate keeps a human accountable** for what
   ships.
2. **Sovereign, local-first models.** Every run goes through one OpenAI-compatible
   `ModelClient` seam, routed across **three tiers — local (Ollama/llama.cpp) →
   self-hosted OSS (vLLM/TGI) → frontier (controlled)**. Your hardware, your data,
   your choice; frontier is the opt-in last resort. Any OpenAI-compatible model
   drops in with zero code — including GLM-4.6.
3. **An in-house runtime with an immutable trace.** No vendor agent framework. The
   loop, tools, sandbox, context engine, memory, and multi-agent delegation are
   all ours — which is what makes the live trace, the governance receipts, and the
   policy engine possible.

---

## What you can do

A run is **observable, controllable, collaborative, and auditable** end to end:

| Capability | What it means |
|---|---|
| **Live trace** | watch a run stream its steps over SSE — no polling, no black box |
| **Pause / resume** | suspend a run at a safe point with its work intact, then continue |
| **Clarifications** | the agent can ask a question mid-run and wait for your answer |
| **Approval gate** | a human checkpoint before a risky action (e.g. opening a PR) |
| **HITL inbox** | one cross-task list of every run waiting on a human |
| **Delivery pipeline** | the run's `commits → PR → CI checks`, live, on the task card |
| **Run receipt** | a tamper-evident record of exactly what each run did |
| **Agent policy** | per-agent least-privilege: allowed tools, token/step budgets, kill-switch |
| **Audit attribution** | every activity logged as human- or agent-driven (immutable) |
| **Fleet console** | the cross-system view: active runs, lifecycle, per-agent rollups |
| **Model routing** | the 3-tier provider registry + per-agent model selection |

Each is documented — with screenshots — in [`docs/modules/`](docs/modules/):
[Human-in-the-loop](docs/modules/HUMAN-IN-THE-LOOP.md) ·
[SDLC graph](docs/modules/SDLC-GRAPH.md) ·
[Governance](docs/modules/GOVERNANCE.md) ·
[Model routing](docs/modules/MODEL-ROUTING.md) ·
[Fleet](docs/modules/FLEET.md) ·
[Agent runtime](docs/modules/AGENT-RUNTIME.md).

The run card brings the SDLC + governance story together:

![A run card: policy, delivery pipeline, and a verified receipt](docs/modules/images/run-sdlc-receipt.png)

---

## Architecture

A monorepo (npm workspaces) behind **two stable seams** that keep the platform
vendor-neutral:

```
shared/     types + role/permission constants used by both sides
sdk/        the in-house Platform SDK (schema-first: zod → TS + generated Python)
backend/    Express + Prisma + Postgres + the agent runtime
frontend/   Vite + React + TanStack Query + Tailwind
docs/       module guides (with screenshots), architecture, planning, learning
```

- **`RuntimeAdapter`** — the firewall between Lumey and whatever executes a run.
  A deterministic `reference` simulator covers the UI with no model at all; the
  in-house **`native`** runtime executes real runs (ModelClient + ToolRunner +
  Sandbox + ContextEngine + LoopController, plus memory, Outcomes self-grading,
  and multi-agent `delegate`).
- **`ModelClient`** — model-agnostic inference over raw HTTP (OpenAI-compatible),
  fronted by the [3-tier router](docs/modules/MODEL-ROUTING.md). No vendor SDK.

Deep dives: [the in-house SDK + runtime decision record](docs/architecture/in-house-sdk-and-runtime.md)
· [runtime guide](docs/architecture/lumey-runtime-sdk-guide.md) ·
[SDK guide](docs/architecture/lumey-sdk-guide.md) ·
[the colorful learning guide](docs/learning/THE-LUMEY-LEARNING-GUIDE.md).

---

## Quick start (local dev)

```bash
# 1. Install (workspaces)
npm install

# 2. Env — copy + edit
cp backend/.env.example backend/.env       # set DATABASE_URL, JWT secrets, (optional) model tiers
cp frontend/.env.example frontend/.env

# 3. Database — apply schema + seed
cd backend
npx prisma migrate deploy                  # fresh DB; for an iterating dev DB use: npx prisma db push
npm run db:seed
cd ..

# 4. Run — backend (:3000) + frontend (:5173) in two terminals
npm run dev:backend
npm run dev:frontend
```

Seeded admin: `admin@exargen.in` / `Admin@1234` — **rotate before any real user
logs in** (see [docs/ADMIN_PLAYBOOK.md](docs/ADMIN_PLAYBOOK.md)).

### Connect your models

Configure any subset of the three tiers in `backend/.env` (see the **Agent
runtime** section of [`.env.example`](backend/.env.example)). For example, to run
local-first with **GLM-4.6** as a controlled frontier fallback:

```bash
LUMEY_LOCAL_MODEL=qwen2.5-coder:14b                 # tier 1 — sovereign default
LUMEY_FRONTIER_MODEL=glm-4.6                         # tier 3 — controlled
LUMEY_FRONTIER_URL=https://api.z.ai/api/paas/v4      # any OpenAI-compatible endpoint
LUMEY_FRONTIER_API_KEY=<your key>
```

The **Models** page shows what's configured; set an agent's policy model to route
that agent to a specific tier. No code changes — the seam is OpenAI-compatible.

![The Models page — local, self-hosted, and frontier tiers](docs/modules/images/models.png)

---

## Quality & status

```bash
npm run typecheck     # backend + frontend + sdk
npm run test:unit     # backend + frontend + sdk
npm run lint          # eslint
npm run dead-code     # ts-prune — no unused exports
```

**1225 backend + 126 frontend + 39 SDK tests** green; typecheck + lint clean; zero
dead exports. **Phases 1–5 of the [enterprise plan](docs/planning/ENTERPRISE-PLAN.md)
are complete** — Glass Cockpit (live trace + controls), Human-in-the-Loop, SDLC
graph, Governance, and Fleet & Model Routing. The full, dated build log is
[`CHANGELOG.md`](CHANGELOG.md); the current product state is
[`PRODUCT.md`](PRODUCT.md).

Docs screenshots are committed assets, regenerated by a Playwright script
([`docs/scripts/capture-screenshots.mjs`](docs/scripts/capture-screenshots.mjs))
that drives the running app — so the docs always show the actual product.

---

## Security & enterprise hygiene

pino structured logging with redaction · JWT alg-pinned + server-side token
revocation · brute-force lockout · helmet/HSTS/CSP/CORS · rate limiting · gitleaks
in CI · HMAC-verified GitHub webhooks · GitHub App short-lived tokens · path-
contained, shell-free sandboxed tool execution · least-privilege agent policies ·
tamper-evident run receipts · immutable agent/human audit attribution. The agent
visibility allowlist keeps agent work out of unauthorised views, server-side. CI
gates every PR with gitleaks, `npm audit`, and a CycloneDX SBOM. The full model +
disclosure policy is in [`SECURITY.md`](SECURITY.md).

Deploying? See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (Railway + Vercel) and the
admin runbook [`docs/ADMIN_PLAYBOOK.md`](docs/ADMIN_PLAYBOOK.md).
