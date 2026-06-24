# Lumey v2.0 — Feature Backlog

**From a lean kanban core → a first-class agentic engineering platform** where software
agents and humans work the same board as teammates you can watch, steer, and trust.

> Companion to `ARCHITECTURE.md` (the *why/shape*) and `V2-ENGINEERING-PLAN.md` (the
> *how*). This is the prioritized *what to build*.

**Legend** — Priority: **P0** = v1 non-negotiable · **P1** = fast-follow · **P2** = later.
Status: `exists` (already in the lean core) · `extend` (build on what's there) · `new`.
Phase maps to the roadmap in `ARCHITECTURE.md §9`.

## What the lean core already gives us (leverage, don't rebuild)
Agents as first-class users (`userType=AGENT`) · agent control plane (`next-task`,
`knowledge-pack`, budget) · the **IN_REVIEW human-only gate** · kanban/tasks/epics/
sprints/decisions · comments · notifications · GitHub integration (webhook task-linking)
· generic standups/updates (agents + humans) · client portal · TriageInbox · RBAC.

---

## ⭐ The v1 non-negotiables (the demo that proves Lumey)
1. **Live agent run + trace on the card** (E1) — watch an agent work, not just its result.
2. **The "agent needs you" loop** (E2) — review gate UI + blocking clarification inbox.
3. **Mixed human/agent assignment** (E3) — assign a card to a human, a named agent, or "any agent".
4. **Per-run cost + visibility** (E6) — every run is traced and costed.
5. **Client-portal agentic transparency** (E10) — clients watch agents build their software.

---

## E1 · Agent Runtime & Live Visibility  *(keystone — Phase 1)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 1.1 | `AgentRun` / `RunStep` / `RunEvent` data model + event stream | P0 | new |
| 1.2 | Live run trace surfaced on the kanban card (plan → edit → test → PR) | P0 | new |
| 1.3 | Run-status badges on cards (queued · working · in-PR · blocked · needs-review) | P0 | extend |
| 1.4 | "Watch the agent work" real-time feed (open a card, see live steps) | P0 | new |
| 1.5 | Run history + replay per task | P1 | new |

## E2 · Human ↔ Agent Collaboration Loop  *(Phase 1–2)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 2.1 | In-app PR review gate UI — approve / request-changes (gate exists, needs UI) | P0 | extend |
| 2.2 | "Agent needs you" inbox — agent asks a question, **blocks**, human answers, run resumes | P0 | new |
| 2.3 | Approval gates — agent requests permission before risky actions (prod, delete, migrate) | P1 | new |
| 2.4 | Steering — pause / redirect / cancel a run mid-flight | P1 | new |
| 2.5 | Feedback capture — human edit-distance on agent diffs → quality signal | P2 | new |

## E3 · Work Items, Agent-Native  *(Phase 1)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 3.1 | Mixed assignment: human / specific agent / "any available agent" + reassign mid-flight | P0 | extend |
| 3.2 | Acceptance criteria as a **machine-checkable rubric** (maps to Claude Agent SDK Outcomes) | P0 | extend |
| 3.3 | Definition-of-done + auto-grade against the rubric | P1 | new |

## E4 · Teams & Fleet  *(Phase 2 / 4)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 4.1 | Mixed human + agent staffing per project | P1 | extend |
| 4.2 | Fleet view — every agent, what it's doing now, queue depth, utilization, who's blocked | P1 | new |
| 4.3 | Agent specialties (coder · reviewer · tester · triager) + route by capability | P1 | new |
| 4.4 | Agent profiles + **graduated autonomy** (trust earned from PR-acceptance / rework rate) | P2 | new |

## E5 · Orchestration  *(Phase 4)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 5.1 | Orchestrator agent — decompose an epic → tasks → assign (self-populating board) | P1 | new |
| 5.2 | Triggers — on PR-merge / issue-created / schedule → spawn agent work | P1 | new |
| 5.3 | Workflow templates — fix-bug · add-feature · write-tests · upgrade-dep | P2 | new |

## E6 · Observability, Cost & Quality  *(Phase 1–2)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 6.1 | Token + cost per run/task; rollups per project/agent/day | P0 | extend |
| 6.2 | Budgets + **enforcement** (auto-pause at ceiling) — usage exists, enforcement doesn't | P1 | extend |
| 6.3 | ROI dashboard — PRs shipped · hours saved · $ spent | P1 | new |
| 6.4 | CI / test status on cards | P1 | extend |
| 6.5 | Quality metrics — rework rate, PR-acceptance rate, edit-distance | P2 | new |

## E7 · Knowledge & Context  *(Phase 3)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 7.1 | Knowledge graph (Postgres nodes/edges) fed by the event stream + repo/docs | P1 | new |
| 7.2 | Context compiler — minimal-sufficient context from the graph (token efficiency) | P1 | new |
| 7.3 | Per-project agent memory + org playbooks/skills (self-codifying) | P2 | extend |

## E8 · Safety & Provenance  *(woven into every phase)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 8.1 | Guardrail policy — allowlist of paths/repos/commands an agent may touch | P0 | new |
| 8.2 | Secret-scan agent diff before commit (reuse `.gitleaks.toml`) | P0 | extend |
| 8.3 | Circuit breakers (cost/runaway), deadlock + poison-task escalation | P1 | new |
| 8.4 | Provenance/audit — every line traceable to run → model → reviewer | P2 | new |

## E9 · Agent Onboarding & Access  *(Phase 1)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 9.1 | Grant an agent scoped access to a repo/project (the *granting* flow) | P0 | new |
| 9.2 | Knowledge-pack extension — richer per-task compiled context | P1 | extend |

## E10 · Client Portal — Agentic Transparency  *(Phase 2 — KEEP + enhance)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 10.1 | Live agent-driven progress for clients (watch their feature get built) | P0 | extend |
| 10.2 | Client-visible PRs/decisions + human-approval checkpoint surfaced | P1 | extend |

## E11 · Intake & Auto-Triage  *(Phase 2)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 11.1 | Natural-language request → agent-drafted kanban card (wire an agent into TriageInbox) | P1 | extend |
| 11.2 | Inbound issue / webhook → auto-triaged card | P2 | new |

## E12 · Inter-Agent Coordination  *(Phase 4)*
| # | Feature | Pri | Status |
|---|---|---|---|
| 12.1 | Task handoff with distilled context (design-agent → implement-agent) | P1 | new |
| 12.2 | Agent message bus / shared blackboard (pooled context) | P2 | new |
| 12.3 | Real-time presence — humans + agents visible on the same card | P2 | new |

---

## Build order (recommended)
**Phase 0** (now) — kernel + module scaffolding (registry · event bus · entitlements).
**Phase 1 keystone** — E1 + E3.1/3.2 + E2.1/2.2 + E6.1 + E9.1 (live run, mixed assignment,
review/clarify loop, cost, agent access) — this is the proving demo.
**Phase 2** — E2.3–2.4, E6.2–6.4, E10, E11.1, E4.1.
**Phase 3** — E7 (knowledge graph + context compiler).
**Phase 4** — E5, E4.2–4.4, E12.
**Phase 5** — local serving + correction→training loop (see `V2-ENGINEERING-PLAN.md`).
Safety (E8) is woven into every phase, not bolted on.
