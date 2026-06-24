# Agent-Friendliness Audit — 2026-05-23

**Question Pankaj asked:** *"is this platform agentic friendly?"*

**Short answer:** Yes, substantially. The platform was built agent-aware from day one. There's already a first-class concept of agent users, a dedicated knowledge-pack endpoint optimized for prompt-budget, budget accounting, and a structural safety boundary that prevents agents from approving their own work. The gaps are mostly polish, not architecture.

This doc walks through what works, what's missing, and ranks the gaps.

---

## What's already in place

### 1. First-class agent identity (✅ solid)

`User` model carries dedicated agent fields:

```
userType         : 'HUMAN' | 'AGENT'    // structural identity
agentRole        : String?              // free-text role for the agent's prompt
agentSystemPromptPath : String?         // points at a markdown file
agentBudgetMonthlyUsdCents : Int?       // ceiling (null = unlimited)
agentBudgetUsedUsdCents    : Int        // rolling sum
agentActive      : Boolean              // enable/disable
```

JWT carries `ut: 'agent' | 'human'` (auth.service.ts:131) so every downstream middleware can see "this request is from an agent" without a DB round-trip.

**Implication:** agents and humans hit the same endpoints. The system distinguishes them where it matters (e.g., agents can't approve reviews, agents auto-skip the onboarding compliance gate).

### 2. Safety invariants on agent actions (✅ solid + tested)

`enforceAgentDoneGate` (task.service.ts:97) — agents may NOT transition tasks to DONE. Structural check, not just permission-based. Even if RBAC accidentally grants `task.transition.done` to an agent, the userType check refuses.

> *"The structural userType check — even if the permission grants drift, an agent never lands a task in DONE. This is the invariant Slice 1 of the agent platform commits to."*

This is well-designed: agents do the work, humans approve it. Pinned by the task.service.test.ts suite + auditBugs.test.ts.

### 3. Dedicated knowledge-pack endpoint (✅ solid, was untested)

`agentKnowledgePack.service.ts` (`getKnowledgePackForAgent`) bundles every piece of context an agent needs to act on a task into ONE response:

- Project identity + phase + health
- Project members (with userType so the agent knows who else is an agent)
- GitHub repo info (so the runtime can clone before spawning the container)
- Recent activity (last 30 days, capped at 100 entries)
- Active sprint + tasks
- The agent's own assigned tasks (sorted by priority + due date)
- 20 most recent decisions
- 50 most recent project documents (metadata only)

**Critical design choice:** the agent calls ONE endpoint per task rather than 5-6. Optimized for the prompt-budget loop. Audited for safety: agent must be a project member (Layer 2 auth in the service), AND userType must be 'AGENT' (Layer 1). Humans cannot accidentally drain this endpoint as a back-door to fast project context.

### 4. Budget accounting (✅ now tested in this PR)

`incrementAgentBudget` (agent.service.ts) — runtime calls this once per task with the cents spent on Claude API for that task. Atomic increment on `User.agentBudgetUsedUsdCents`. Audit log per increment. Refuses non-agents. Sanity-caps at $1000 per increment to catch runtime bugs.

Returns `over: boolean` so the runtime can refuse to spawn the next container.

**14 new regression tests in this PR pin every invariant.**

### 5. Identity masking for clients (✅ solid)

`displayAssignee` helper + `project.service.ts:384` (`hideAgents` option) replace agent identities with "Internal team" when a CLIENT viewer is looking. Pankaj's 2026-05-22 policy.

**Why this matters for agentic-friendliness:** an agent can be assigned to a client-facing task without exposing "your work is being done by AI." The decision to disclose AI involvement is left to product / contract, not enforced UI-side.

### 6. Rate limiting tuned for the agent runtime (✅ solid)

`rateLimiter.ts:4-15` — production cap is 200/15min on /auth/login specifically because each agent container does its own login. The comment explicitly mentions the runtime as the driver of this choice.

`apiLimiter` is 100/min — that's tight enough to catch a runaway agent but loose enough for a multi-agent workload.

### 7. Hard armor on agent fields (✅ solid + tested)

`user.service.ts:289-311` — fields like `userType`, `agentRole`, `agentSystemPromptPath`, `agentBudgetMonthlyUsdCents`, `agentActive` can only be touched by SUPER_ADMIN. Non-SUPER_ADMIN edits silently drop these fields. Pinned by the user.service.superAdmin.test.ts suite.

**Implication:** an ADMIN cannot spin up agent users. Only SUPER_ADMIN can. Limits blast radius if an ADMIN account is compromised.

---

## Gaps ranked by impact

### Gap A — No OpenAPI / Swagger spec (Medium)

There's no machine-readable schema for the REST API. Agent developers building integrations have to read the source. For a tool calling Claude SDK or another LLM, an OpenAPI doc would let the agent self-discover endpoints + request shapes + response shapes.

**Effort:** medium. Could be auto-generated from the zod schemas (they're already declarative).

**Workaround today:** agent developers read `backend/src/routes/*.ts` directly. Works but ties them to source-code access.

### Gap B — No first-class idempotency keys (Medium)

Most mutating endpoints don't accept an `Idempotency-Key` header. Agents need this to safely retry on network failure without creating duplicate tasks / comments / etc.

There ARE feature-specific idempotency mechanisms:
- Signing is idempotent by (enrollment, document, version)
- Re-acknowledgment is idempotent
- `Task.taskNumber` is unique per project so dup-creates would fail at DB level

But `POST /projects/:id/tasks` has no idempotency-key support. An agent that gets a 504 mid-create can't safely retry without checking whether the task landed first.

**Effort:** medium. Add an `Idempotency-Key` middleware + per-endpoint dedup table.

### Gap C — No webhook / event subscription for agents (Medium)

The system has internal notifications (the bell icon) but no outbound webhooks. An agent that wants to react to "a comment landed on my task" has to poll. The runtime apparently does this already (rate limiter comment mentions a "headless poller").

**Effort:** medium-high. Pub/sub infrastructure + per-subscription delivery semantics.

**Workaround today:** polling. Inefficient but works.

### Gap D — `agent.service` knowledge-pack service was untested (✅ fixed in this PR)

`agentKnowledgePack.service.ts` had zero tests until now. This PR adds 14 tests on `agent.service.ts` (incrementAgentBudget). Knowledge-pack tests will land in a follow-up — they need a fair bit of mock setup for the parallel Promise.all reads.

### Gap E — No agent-specific API key auth (Low)

Agents currently auth via the same JWT + refresh-token flow as humans. The runtime burns one /auth/login per container boot. Long-running headless agents could benefit from longer-lived API keys (revocable per-agent) instead.

The CMS public routes (`/cms/public/*`) already have an `apiKey` pattern using a `cms_<hex>` token — same shape could be reused for agent auth.

**Effort:** low-medium. Reuse the CMS pattern. Worth it only when login-spam from the runtime starts hitting the rate limiter.

### Gap F — Knowledge pack doesn't include task acceptance criteria (Low)

`agentKnowledgePack.service.ts` includes task status / priority / assignee / due-date — but NOT the AC items. Agents working on a task can't see "what does Done look like for this task" without an extra fetch.

**Effort:** small. Add `acceptanceCriteria` to the per-task select. Worth doing.

### Gap G — No agent "current task" or "what should I do next" endpoint (Low)

Agents have to query their own assigned tasks (`myAssignedTasks` in the knowledge pack), filter by status, pick one. A dedicated "next" endpoint that returns ONE task (priority-ordered, unblocked, sprint-active) would simplify the runtime's task-picking logic.

**Effort:** small-medium. Useful but not blocking.

---

## What this audit is NOT saying

- The platform is NOT "agent-native" in the sense of MCP / tool-calling. It's a REST API that agents can drive — same as humans.
- We're NOT claiming the platform is safe for autonomous agents at scale. Budget accounting + the agent-Done-gate + the SUPER_ADMIN armor are real but the broader safety surface (sandboxed actions, rollback, supervisor approvals for sensitive operations) hasn't been audited here.

---

## Recommended next steps if you want to lean harder into agent-first

In priority order:

1. **Add `acceptanceCriteria` to the knowledge pack** (1 hour). Quick win, big quality-of-life for agents that need to know when a task is done.
2. **Test `agentKnowledgePack.service.ts`** (~2 hours). The largest agent surface with the most logic. Currently the only untested agent service after this PR closes `agent.service.ts`.
3. **OpenAPI auto-generation from zod schemas** (~4-6 hours). Hits agent developers' biggest friction. Bonus: the FE could consume the same spec for type-safe API clients.
4. **Idempotency-Key middleware on POST endpoints** (~3-4 hours). Once agents are retrying in production, this becomes load-bearing.
5. **Per-agent API keys** (~3-4 hours). Only worth it when login-rate-limiting actually bites.
6. **Outbound webhooks** (~1+ day). Useful but bigger lift; agents can poll for now.

---

## Bottom line

The platform's agent-readiness is **B+ today.** The architecture is right (first-class identity, structural safety boundaries, budget accounting, dedicated knowledge endpoint, identity masking for clients). The gaps are mostly polish — OpenAPI, idempotency keys, webhooks, plus a few low-effort knowledge-pack additions.

Nothing about this platform actively works *against* agents. The agent runtime that's apparently driving the production traffic is well-served. Future agent integrations from outside that runtime have a slightly rougher path (source-code-reading, no idempotency, polling) but no architectural showstoppers.
