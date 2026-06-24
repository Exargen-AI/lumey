# Lumey v2.0 — SDK / Runtime Decision (CTO review)

> ## ⛳ FOUNDER DECISION (supersedes the recommendation below)
>
> **Build everything in-house, from scratch — no external agent SDK or hosted
> runtime.** Lumey owns both the agent runtime *and* the platform SDK. We still
> call models (local + frontier), but all orchestration, tool execution,
> sandboxing, context management, and the SDK surface are ours.
>
> The one thing kept from the CTO review is the **`RuntimeAdapter` firewall** —
> it's exactly what makes building in-house low-risk: our runtime is just the
> first *real* adapter behind it. The "buy the loop" recommendation below is
> **not adopted**.
>
> **Full technical build plan:**
> [`docs/architecture/in-house-sdk-and-runtime.md`](../architecture/in-house-sdk-and-runtime.md).

**Status: superseded — kept for the rationale + the firewall design.** Captures
the CTO-level review of the agent-runtime and SDK strategy.

---

## The decision in one line

**Buy the loop, own the plane, firewall the seam.** Adopt the Claude Agent SDK
(Anthropic Managed Agents) as the *first* coding-runtime, but build a runtime-neutral
`RuntimeAdapter` interface and event schema **in Phase 1** so we're never welded to one
vendor. Pour the "top-notch" investment into the **Lumey Platform SDK** — the durable
asset we actually own and sell.

---

## 1. Build vs. buy the runtime → buy, with a firewall

Building our own coding loop, sandbox, leak-proof git auth, PR creation, secret vaulting,
and per-step telemetry is 4–6 months of **undifferentiated** work Anthropic already
operates better than we will at our size. None of it is our moat. Our moat is the
**knowledge graph, the correction→training loop, modular packaging, and the on-prem
story**. So buy the loop.

**Lock-in is real but bounded — and concentrated in the wrong place if we're careless.**
The danger isn't the loop (loops are commoditizing). The danger is wiring
platform-specific concepts (Outcomes, Vaults, `tool_confirmation`, `span.model_request_end`)
*directly into our domain tables and SDK*. That's an architecture choice we control, not a
vendor we're hostage to. The exit strategy is a `RuntimeAdapter` — with it, lock-in
degrades from "rewrite the platform" to "write a new adapter (~weeks)."

---

## 2. Alternatives — accept / reject

- **Raw Messages API + our own loop** — *Reject for v1; keep as the portability backstop.*
  Max control, but rebuilds everything we're trying to skip. Build it behind the adapter in
  Phase 5 as the vendor-neutral / fully-local fallback.
- **OpenHands (open-source, self-hostable)** — *Accept as the second adapter, later.* It
  runs the loop on **your** infra — the real air-gap answer Managed Agents can't give. This
  is the **on-prem/sovereign runtime**, and the strongest reason the adapter seam must
  exist on day one.
- **LangGraph / orchestration frameworks** — *Reject as the runtime.* Wrong layer — it
  orchestrates, it doesn't sandbox+execute+PR. We already have our own event-bus/module
  orchestration.
- **Other hosted runtimes (Devin-class, etc.)** — *Reject.* More lock-in, less control, and
  most don't expose the per-step telemetry our observability pillar needs.

**Verdict:** Managed Agents for the frontier coding path now; OpenHands as the
self-hosted adapter for air-gapped buyers; raw-API loop as the portability backstop.

---

## 3. What "top-notch" means for the **Lumey Platform SDK**

This is the SDK we own and sell — where excellence matters:

- **TypeScript-first, schema-first.** One source of truth (Zod/JSON-Schema or protobuf) →
  generated TS **and Python** clients. Python parity is non-negotiable (ML/serving +
  third-party agents live there). No hand-maintained type drift.
- **Thin over a stable, versioned contract.** Version the *contract*, not just the package
  (`/v1`, additive-only, deprecation windows). Seniors trust an SDK that promises not to
  break them.
- **Guardrails enforced server-side, surfaced by the SDK.** The SDK is convenience;
  enforcement must be on the server behind it — or a third-party agent just doesn't use our
  SDK and bypasses everything.
- **First-class streaming.** Async iterators, resumable from a cursor, backpressure-aware,
  typed discriminated-union event kinds. This is the observability spine.
- **Actionable errors.** Typed (`BudgetExceededError`, `ApprovalRequiredError`,
  `ClarificationPendingError`), each carrying `runId`/`traceId`, retryable-vs-terminal
  flags, **idempotency keys on all writes** (agents crash and resume constantly).
- **Runtime-neutral schemas for third-party agents.** `RunEvent`/`Outcome`/`ReviewRequest`
  never mention Anthropic concepts. *That neutrality is simultaneously the lock-in firewall
  AND the extensibility story — one design decision buys both.*
- **DX that earns "excellent":** TTHW < 10 min, copy-paste quickstart that produces a real
  traced run, local mock/replay mode (test without burning tokens), schema-generated docs.

---

## 4. The load-bearing seam — `RuntimeAdapter`

Built in Phase 1, **before** any table is shaped by Anthropic's wire format:

```ts
interface RuntimeAdapter {
  startRun(compiledContext, outcome, repo): RunHandle           // managed | openhands | local
  events(runHandle): AsyncIterable<RunEvent>                    // normalized to OUR schema
  approve(runHandle, decision): void                            // → tool_confirmation / native
  cancel(runHandle): void
  capabilities(): { selfHosted, memory, outcomes, multiAgent }  // honest feature flags
}
```

Anthropic's `span.*` / `model_usage` / `tool_confirmation` get **translated into** our
`RunEvent` / `TokenUsage` / `ApprovalGate` at the adapter boundary — never above it.
`capabilities()` lets the platform degrade gracefully when a runtime lacks a feature.

---

## 5. Top 3 risks & mitigations

1. **Air-gap story can't ship on Managed Agents** (self-hosted sandboxes still run the loop
   on Anthropic's side). → Stand up the **OpenHands adapter** as the on-prem runtime; don't
   sell "air-gapped" on Anthropic. Validate ZDR/retention with the regulated ICP (**G4**)
   before committing the sovereign narrative.
2. **Accidental schema lock-in.** → Hard rule, enforced as a review gate: **no
   Anthropic-specific field names above the adapter, ever.** This single discipline *is* the
   exit strategy.
3. **Local coding model treated as shippable.** → Hold the line: local models do auxiliary
   (triage/extract/KG) now; local *coding* is research behind the shadow router, gated on
   data showing parity. Don't let sales promise it early.

---

## 6. What this asks of you

- **Approve** standing on the Claude Agent SDK as adapter #1, with the `RuntimeAdapter`
  seam built in Phase 1 (not "later").
- **Confirm** the investment goes into the Lumey Platform SDK (TS + Python, schema-first),
  not a homegrown loop.
- **Decide G4 (buyer)** — it determines whether the OpenHands/on-prem adapter is Phase-2
  urgent or a later fast-follow.
