# Notifications module (M1)

The second kernel module, and the first **cross-module reaction on the event
bus**. It proves the modular architecture end-to-end: one module announces a
fact, another reacts, neither imports the other's internals.

Code: `backend/src/modules/notifications/` · event contract:
`backend/src/modules/comments/events.ts`.

## What it does

1. **Mounts the notification routes** (`/api/v1/notifications…`) via the kernel
   registry, gated by the `notifications` entitlement.
2. **Subscribes to `comment.created`** and fans out a task-subscriber
   notification — work that previously lived inline in the comment service.

## The first domain event

`comment.created` is owned by the **comments** module (it's the producer's
contract) and published by the comment service for *every* comment:

```ts
// comment.service.ts (producer)
void bus.publish<CommentCreatedEvent>({
  type: 'comment.created',
  commentId, projectId, projectName,
  taskId, milestoneId, authorId, authorName,
  contentSnippet, mentionedUserIds,   // mentioned users → dedupe in the fan-out
});
```

```ts
// modules/notifications (consumer)
init: (ctx) => ctx.bus.subscribe<CommentCreatedEvent>('comment.created', fanOutTaskComment),
```

**Why this is the right shape**

- The comment service no longer knows that notifications exist — it announces a
  past-tense fact and moves on. Disable the notifications module and comments
  keep working; the event simply has no subscriber.
- `enhances: ['comments']` is a **soft** relation (informational), not a hard
  `dependsOn` — notifications runs fine without comments; it just receives no
  comment events. So neither module can break the other's boot.
- Publish is **fire-and-forget** (`void`) — a notification must never fail or
  slow the post, and the bus isolates subscriber errors.

## Scope (MoSCoW)

- **Must / Should (done):** notifications as a registered module; the
  `comment.created` contract; the task-subscriber fan-out moved to a bus
  subscriber; behaviour preserved; tests; this doc.
- **Could → Won't (this increment):** move the **mention** and **story-update**
  client notifications onto the bus too. Kept inline in the comment service to
  bound the change; they migrate in a later increment, each with its own event.

## Tests

`backend/src/modules/notifications/notifications.module.test.ts`:

- **Fan-out unit** — excludes author + mentioned users; no-op for non-task
  comments; no notify when there are no subscribers; skips cleanly if the task
  was deleted.
- **Kernel wiring** — boot the module, publish `comment.created` on the
  registry's bus, assert the subscriber reacts.
- **Entitlement mount gate** — `401` when enabled (route exists), `404` when
  disabled.

The integration test (`ccFeatures.integration.test.ts`) now asserts the comment
route's new responsibility — that it **publishes** `comment.created` with the
author + mentioned users — while the fan-out behaviour is covered here.

## Next

The remaining comment notifications (mentions, story-updates) move onto the bus;
observability and the knowledge graph will subscribe to `comment.created` (and
peers) without the comment service changing.
