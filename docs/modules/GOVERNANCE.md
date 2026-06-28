# Governance module (Enterprise Phase 4)

The "control & audit" layer enterprises ask for first: *prove what an agent was
allowed to do, and what it actually did.* This phase starts with the second half
— a **tamper-evident receipt** of every run.

Code: service `backend/src/services/runReceipt.service.ts` · issued by the
`agent-runtime` module's bus subscriber (`modules/agent-runtime/index.ts`) · read
API `…/runs/:runId/receipt` · UI `frontend/src/components/tasks/RunReceiptPanel.tsx`.

## P4.1 — RunReceipt

**What it is.** When a run comes to rest — a terminal state, or AWAITING_REVIEW
(the common "agent finished, over to a human" point) — we snapshot it and hash
the snapshot. The snapshot (`content`) records:

- identity — run / task / agent ids, model;
- outcome — final status + summary;
- timing — started / ended / duration;
- usage — input / output / total **tokens** (cost is deliberately absent: the
  platform measures tokens, the honest model-agnostic unit; local-first);
- work — step count + step-type breakdown, commit count, the PR (id/number/url/
  state), and check results (total / passed / failed).

**Why it's trustworthy.** The `digest` is computed over a **canonical**
(recursively key-sorted) serialization of `content`, so the hash is stable
regardless of JSON key order. It's an **HMAC-SHA256** when a server secret
(`LUMEY_RECEIPT_SECRET`) is configured, plain **SHA-256** otherwise (`algo`
records which). On read, the service recomputes the digest over the stored
snapshot and returns `verified`: `false` means the row was altered after issuance
(or the signing secret changed). True signing-key rotation / external attestation
is a later step; this gives integrity today with one env var.

**Lifecycle.** A bus subscriber on `run.transitioned` issues the receipt on every
rest transition; the write is an **upsert by runId**, so a run that rests,
resumes, and rests again always carries its latest record. Adapter-agnostic — any
runtime that drives the lifecycle gets receipts for free.

## Data model

| Model | Purpose |
|---|---|
| `RunReceipt` | one per run (`@unique runId`): `digest`, `algo`, `content` (Json snapshot), `issuedAt` |

Migration `20260628040000`.

## API

`GET /api/v1/tasks/:id/runs/:runId/receipt` (taskAccess-gated) → the receipt with
its recomputed `verified` flag, or `null` until the run first rests.

## UI

`RunReceiptPanel` on the run card reads like a certificate: a **Verified /
Tampered** badge (+ the algorithm), the key facts (model, tokens, duration, work
with a PR link and check tally), the **digest** (truncated, click-to-copy), and
when it was issued. Self-hides until a receipt exists; refetches on the run's SSE
signal.

## Testing

Service units cover snapshot assembly (steps/commits/checks counts, token usage)
and — the important one — **tamper detection**: issue a receipt, then mutate the
stored `content` and confirm `verified` flips to `false`. Verified live in the
browser against a fixture (Verified · sha256 · 23,552 tokens · 4m 12s · 2 commits
· PR #142 · checks 2✓ 1✗). No live LLM needed.

## Not yet built (Phase 4 remainder)

`AgentPolicy` (per-agent allowed tools / model / budget, enforced in the adapter),
`Budget` + a circuit breaker that trips on overspend, and `Activity.actorType`
(agent vs human, so the activity feed can attribute actions). Receipt **signing
with a rotating key** + an external attestation log are the durable-trust follow-ups.
