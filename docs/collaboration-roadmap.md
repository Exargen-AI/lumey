# Kanban Collaboration & Agent-Friendliness Roadmap

_Status doc for the "make the board top-notch, collaborative, and agent-friendly
without the client knowing" initiative. Last updated 2026-06-19._

This tracks the work that came out of the honest board review. It is the source
of truth for **what has shipped, what is in flight, and what remains** — keep it
updated as PRs land.

---

## PR ledger

| PR | Title | Base | Status |
|----|-------|------|--------|
| [#212](https://github.com/Exargen-AI/exargen-command-center/pull/212) | Client notification bell + role-aware assign link | `main` | ✅ Merged |
| [#213](https://github.com/Exargen-AI/exargen-command-center/pull/213) | Story-update comments + author edit (1st attempt) | `feat/client-notification-bell` | ⚠️ Merged to the **wrong base** — superseded by #214 |
| [#214](https://github.com/Exargen-AI/exargen-command-center/pull/214) | Story-update comments + author edit (re-target) | `main` | 🟡 Open — ready to merge |
| [#215](https://github.com/Exargen-AI/exargen-command-center/pull/215) | `moveTask` optimistic lock | `main` | 🟡 Open — ready to merge |
| [#216](https://github.com/Exargen-AI/exargen-command-center/pull/216) | SSE live board sync + presence | `feat/move-task-optimistic-lock` (stacked on #215) | 🟡 Open — ready to merge |

### ⚠️ Merge order (avoid repeating the #213 mistake)

1. Merge **#214** (independent, base `main`).
2. Merge **#215** (independent, base `main`).
3. After #215 lands, confirm **#216**'s base auto-retargets to `main`, then merge **#216**.
   - Do **not** merge #216 while its base still reads `feat/move-task-optimistic-lock` — that is exactly how #213 landed on the wrong branch.

---

## ✅ Done

### Client collaboration plumbing
- **Client notification bell** (#212, merged). The client portal had no bell; added `NotificationBell` to `ClientLayout`. `notifyTaskAssigned` is role-aware — a CLIENT assignee gets "A task needs your input" linking to `/client/projects/:projectId/tasks/:taskId` instead of the engineer-only `/eng/my-tasks`.
- **Story-update templated comments** (#214, pending merge). Engineers fill the client story template (objective / current task / reason / impact / design change / progress / next step) **in the comment section** — no separate engineer panel. New `Comment.kind` + `Comment.storyData` (migration `20260619000000`); the server renders the `content` body so it can't drift from the structured fields. Renders as a distinct card with a progress bar; the **latest is pinned at the top** so the client never has to dig. Posting (and editing) **notifies the project's clients** via the #212 bell, masked per visibility.
- **Author edit for any comment** (#214). Every comment its author posted can be edited in place — plain comments inline via the rich-text editor, story updates by reopening the template pre-filled. Optimistic-locked (`expectedUpdatedAt`) with an "edited" marker; a story-update edit re-renders the card and re-notifies the client.

### P0 — Liveness (the sprint that flips single-player → collaborative)
- **Drag-to-move optimistic lock** (#215). `moveTask` was the one mutation with no concurrency guard — two people dragging the same card was silent last-write-wins. Added a fail-fast `409` plus a race-safe guarded write (`updateMany` on `updatedAt`) inside the transaction. The board sends each dragged card's `updatedAt` (single + multi-select); on conflict the existing rollback + toast fires.
- **Realtime board sync over SSE** (#216). New `GET /events/projects/:projectId/stream`, cookie-authed (native `EventSource` can't set headers) + Origin-checked + project-membership gated. `emitBoardEvent` fires `task.moved/created/updated` from the task handlers. The frontend `useProjectStream` reconciles the project-scoped queries (gated refetch) and shows a coalesced **"Maria moved 3 cards"** pill.
- **Presence avatars** (#216). Teammates currently viewing a board (`presenceStore` + `PresenceAvatars`), derived from live SSE connections.

### Agent invisibility hardening (carried through every change above)
- SSE payloads are **signal-only** — no task data on the wire, so the stream can't leak a task a viewer shouldn't see; the client re-pulls through the already-gated REST layer.
- The hub masks **per subscriber**: a CLIENT never receives an event about a non-client-visible change, and an **agent actor renders as "Internal team."** Presence is internal-only.
- Unit-tested as the security boundary: `sseHub.test.ts` (client gating, agent masking, self-flag, presence dedupe/internal-only) and `authenticateStream.test.ts` (Origin 403; cookie/token/tokenVersion 401; happy path).

---

## 🟡 In flight / needs action

- **Merge #214, #215, #216** in the order above.
- **Browser-verify P0** — not yet verified live (login wall; no creds in the agent session). Open the same board in **two logged-in windows** (incognito to dodge the PWA service-worker cache): a drag in one should reflect in the other within ~1s, with the activity pill + presence avatars. Confirm a CLIENT window never shows an agent name or a non-client-visible change.

---

## 🔭 To do

### P0 follow-ups (small)
- **SSE for bulk + delete.** Today only single `task.moved/created/updated` events emit (a multi-card drag fires N singles that the client coalesces). The bulk-action-bar ops (`bulkUpdateTasks`, `bulkDeleteTasks`) and single delete don't broadcast yet, so those changes don't live-propagate. Add `tasks.bulk` / `task.deleted` emits (delete needs the deleted task's `projectId` + `clientVisible`, captured before the row is gone).

### P1 — Conversation + findability
- **Comment threading** — `Comment.parentId` + reply UI; collapses long threads into readable conversations.
- **Reactions** — emoji on comments (and story updates).
- **Comment live-append** — extend the SSE hub with `comment.created/updated` events so a new comment shows without a refetch. _Builds directly on the #216 hub._
- **Saved views** — persist a filter + sort + grouping combo per user/project (filters currently reset on reload).
- **Board search** — full-text search across title/description (today's filters are metadata-only).
- **Sort-within-column** — by priority / due date / age (currently fixed `sortOrder, createdAt`).
- **Swimlanes** — group rows by assignee / sprint / epic, not just status columns.

### P2 — Scale + craft (fine < ~500 tasks, will bite at 2–5k)
- **Column virtualization** (TanStack Virtual) — every card is in the DOM today.
- **Keyset/cursor pagination** — replace offset pagination (deep offsets get slow).
- **Fractional rank (LexoRank)** — true drag-reorder *within* a column; the frontend currently never sends `sortOrder`, so the server always appends.
- **Mobile drag** (dnd-kit `TouchSensor`), **undo last move**, **better bulk partial-failure retry** (per-task detail + retry-failed-subset).

### Agent-friendliness (from the review — structural, not per-surface)
- **`serializeForViewer(payload, viewer)` boundary** — strip `userType` and any `agent*` field for client viewers at **one** serialization point, so invisibility stops depending on every filter being remembered feature-by-feature. (Today `today.service.ts` ships `userType` on actor/author objects to clients — only ever `HUMAN` because agent rows are filtered, but one missed filter = `AGENT` in the client's network tab.)
- **Mask, don't drop, agent-authored client updates.** `listTaskComments` currently *drops* agent-authored comments for clients — so an agent's story update never reaches the client at all. To let agents post client-facing progress "as Internal team," mask the author instead of dropping the row.
- **Counts leak check** — confirm `useTaskCounts` (server `groupBy`) uses the same visibility filter as the board, so a client never sees a column total that exceeds the cards they can see.
- **Agent task lifecycle** — agents can pick work (`next-task`) but can't **create tasks** or **request human review** (they re-poll); no agent task-state (working/paused/declined/retry); an **inactive agent can still be assigned** (`ensureAssignableProjectMember` checks `isActive`, not `agentActive`); the audit log doesn't carry `actor.userType`, so "what did the agents do this week" isn't answerable.

---

## Operating principles for this initiative
- **Land in small vertical slices**, each green (tests + typecheck + build) with its own PR.
- **Agent invisibility is structural** — enforced at the data/serialization boundary and unit-tested, never UI-only hiding.
- **A human owns every client-visible deliverable** — the agent DONE-gate (`enforceAgentDoneGate`) stays sacred.
