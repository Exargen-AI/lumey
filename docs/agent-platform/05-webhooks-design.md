# Outbound Webhooks — Design (NOT YET IMPLEMENTED)

**Status:** Design only. No code in this proposal.
**Owner:** Platform.
**Decision pending:** when to build.

## Why we'd want this

Today the agent runtime polls `/agents/me/next-task` on a fixed interval. Polling has three costs:

1. **Latency.** A task that becomes available 30 seconds after the last poll waits up to one full poll interval before the agent picks it up. For a 60-second poll, average latency is 30s; worst case is 60s.

2. **Wasted requests.** Most polls return `{ data: null }`. We log them, rate-limit them, run queries against them — for nothing.

3. **Coupling between agent count and infrastructure load.** Adding more agents multiplies the poll rate. At 20 agents polling every 30s, that's 40 RPM dedicated to "is there work?" — and most of those return null.

Webhooks invert this: the platform pushes an event to the agent when something changes (new task assigned, comment lands, sprint completed). The agent's poll loop becomes "subscribe once, sleep until pinged."

## What we'd build

### A `WebhookSubscription` table

```prisma
model WebhookSubscription {
  id            String   @id @default(uuid())
  userId        String                          // owning agent (or human, in principle)
  url           String                          // POST destination
  secret        String                          // HMAC-signing secret
  events        String[]                        // ["task.assigned", "task.commented", ...]
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  lastDeliveredAt    DateTime?
  consecutiveFailures Int      @default(0)
  pausedReason  String?                         // e.g., "10 consecutive failures, paused 2026-05-25"

  user          User     @relation(...)

  @@index([userId])
  @@index([active])
  @@map("webhook_subscriptions")
}
```

### Event types we'd ship

| Event | Fires when | Payload |
|---|---|---|
| `task.assigned` | A task's `assigneeId` becomes the agent | `{ task: {...} }` |
| `task.unassigned` | A task's `assigneeId` is cleared from the agent | `{ taskId, previousAssigneeId }` |
| `task.commented` | New comment on a task the agent is assigned to | `{ taskId, comment: {...} }` |
| `task.review_requested` | A task the agent assigned is reviewed (changes requested) | `{ taskId, decision, comment }` |
| `task.status_changed` | A task the agent is on changes status | `{ taskId, fromStatus, toStatus, by }` |
| `sprint.started` | Sprint on a project the agent is on starts | `{ sprintId, projectId }` |
| `sprint.completed` | Sprint on a project the agent is on completes | `{ sprintId, projectId, stats }` |
| `budget.threshold` | Agent crosses 80% / 95% / 100% of monthly budget | `{ usedUsdCents, monthlyUsdCents, thresholdPct }` |

Each event has the same envelope:

```json
{
  "id": "evt_xxx",
  "type": "task.assigned",
  "createdAt": "2026-05-23T12:00:00Z",
  "data": { ... }
}
```

### Delivery semantics

- **HMAC-SHA256 signature** in `X-Webhook-Signature` header. The receiver verifies with the secret it was given at subscription time. Same pattern as Stripe, GitHub, Slack.
- **At-least-once delivery.** Receiver MUST be idempotent — same event id may arrive twice. (The platform uses the same `Idempotency-Key` table we built in PR #155 to dedup.)
- **Retry policy.** Exponential backoff: 1s, 5s, 30s, 5min, 30min, 6h, 24h. After 10 consecutive failures, the subscription is auto-paused with `pausedReason` populated. Re-enable via a `PATCH /webhooks/:id` endpoint.
- **Timeout.** 10s per delivery attempt. Slow receivers get retried, not blocked.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/me/webhooks` | Create a subscription. Body: `{ url, events: [...] }`. Returns the new id + the HMAC secret (shown ONCE — no re-fetch). |
| `GET` | `/agents/me/webhooks` | List my subscriptions. |
| `PATCH` | `/agents/me/webhooks/:id` | Update `url`, `events`, or `active`. |
| `DELETE` | `/agents/me/webhooks/:id` | Permanently delete. |
| `POST` | `/agents/me/webhooks/:id/test` | Send a test event to confirm the receiver works. |

All auth: agent-only (humans use the in-app bell instead). All idempotent via Idempotency-Key.

### Worker

A background process (single Node worker, no new infra) pulls undelivered events from an outbox table (`webhook_deliveries`), tries each, updates counters. Outbox pattern so a database transaction that emits an event commits atomically with the state change it describes.

```prisma
model WebhookDelivery {
  id              String   @id @default(uuid())
  subscriptionId  String
  eventType       String
  eventData       Json
  createdAt       DateTime @default(now())
  deliveredAt     DateTime?
  attemptCount    Int      @default(0)
  lastAttemptAt   DateTime?
  lastError       String?
  nextRetryAt     DateTime?

  subscription    WebhookSubscription @relation(...)

  @@index([subscriptionId])
  @@index([nextRetryAt])
  @@map("webhook_deliveries")
}
```

## What's hard about this

This is the reason it's a design doc, not a PR:

### 1. The worker is a new operational surface

Today the platform is stateless request/response. Adding a worker means:

- Where does it run? (Same process? A separate `node worker.js`? Cron? PaaS background job?)
- How do we observe its health? Lag, failure rate, queue depth.
- How do we deploy it? Rolling deploy, etc.

A simple approach: run the worker in-process behind a `setInterval`. Cheap, no new infra. Downside: same process as the API; CPU contention.

A robust approach: dedicated worker process. Requires PaaS-level orchestration (Railway Workers, similar). More moving parts.

We should pick one before building.

### 2. Outbox vs direct emit

Outbox-pattern:
- Pro: deliveries commit with the state change. No orphan events.
- Con: every mutation now writes to the outbox. Storage growth.

Direct-emit:
- Pro: simpler. No new table.
- Con: a crash between commit and emit drops the event. Need at-least-once via the worker's retry table anyway.

I lean outbox. The storage cost is modest (events table is ~200 bytes/row, retention is short — deliver + delete).

### 3. Multi-tenant receiver concerns

If we ever let CLIENTS register webhooks (not just agents), the events leak the data they describe. Need to scope: a CLIENT's webhook only fires for tasks they have project membership for. The fan-out logic gets non-trivial.

For v1 (agent-only), this is moot — agents already see what they're assigned to.

### 4. Receiver-side abuse

A buggy receiver can:
- Hold the request for the full 10s timeout → ties up the worker
- Return 500 forever → fills the retry queue

The auto-pause after 10 failures handles the second. The first needs per-receiver-domain concurrency limits (Node `p-limit` style).

### 5. Security

Receiver URLs are user-controlled. Without restrictions, an attacker who can register a webhook can:
- SSRF us at private endpoints (e.g., `http://169.254.169.254/...` for AWS metadata)
- Use us as a port scanner ("does this internal IP respond to POST?")

Defense:
- DNS resolution check — refuse private + loopback addresses
- Only `https://` allowed (no `http://`, no other protocols)
- Optional allow-list of receiver domains, set by SUPER_ADMIN

## Effort estimate

| Piece | Effort |
|---|---|
| Prisma models (`WebhookSubscription` + `WebhookDelivery`) | 2 hours |
| CRUD endpoints | 3 hours |
| Event-emission helpers (refactor mutations to emit events) | 6-8 hours |
| Worker (in-process for v1) | 4 hours |
| HMAC signing + verification helper | 2 hours |
| SSRF defenses | 2 hours |
| Retry / pause logic | 3 hours |
| Tests | 6 hours |
| Docs + OpenAPI registration | 2 hours |
| **Total** | **~32 hours / 4 days** |

## Decision

**Build when:**

1. We have a real agent runtime that polls aggressively enough that polling cost matters (current usage is small).
2. We have at least one external integration that wants events (a Slack notification, a stand-alone log aggregator, etc.).
3. We've budgeted 4 days of focused platform work.

**Don't build yet because:**

1. Polling is fine for our current scale.
2. No external integrations are blocked on this.
3. The Idempotency-Key infrastructure we just built (PR #155) is the prerequisite that webhooks rely on for receiver dedup — that's already in place, so when the time comes, this is a single-PR ship.

## Open questions

- **Should we let humans subscribe to webhooks too?** (Imagine: a Slack bot that pings me when a task I'm reviewing gets new comments.) Solvable but out of scope for an agent-control v1.
- **Should events carry the full resource or just an id?** Stripe sends the full object so receivers don't need a second fetch. We probably want this too.
- **Retention on `webhook_deliveries`?** A few days post-delivery, then cleanup sweep. Same shape as the Idempotency-Key sweep.
