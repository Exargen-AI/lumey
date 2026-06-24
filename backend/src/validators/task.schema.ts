import { z } from 'zod';
import { TaskStatus, TaskPriority, TaskType } from '@prisma/client';

// Same window we apply on Project — keeps analytics safe from year-9999 typos
// and still wide enough for any realistic project plan.
const MIN_DATE = new Date('1990-01-01T00:00:00Z').getTime();
const MAX_DATE = new Date('2100-12-31T23:59:59Z').getTime();

const taskDate = z.string().refine((value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = Date.parse(value + 'T00:00:00Z');
    return !Number.isNaN(t) && t >= MIN_DATE && t <= MAX_DATE;
  }
  const t = Date.parse(value);
  return !Number.isNaN(t) && t >= MIN_DATE && t <= MAX_DATE;
}, 'Invalid or out-of-range date (must be between 1990 and 2100)');

export const createTaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(200),
    // 10K cap on description — same DoS reasoning as Project.description
    // (QA finding #18). HTML inflates fast in TipTap output, so 10K of HTML
    // is a much smaller plain-text body, which is fine for descriptions.
    description: z.string().max(10_000).optional(),
    taskType: z.nativeEnum(TaskType).default(TaskType.FEATURE),
    status: z.nativeEnum(TaskStatus).default(TaskStatus.BACKLOG),
    priority: z.nativeEnum(TaskPriority).default(TaskPriority.P2),
    storyPoints: z.number().int().min(1).max(100).nullable().optional(),
    sprintId: z.string().uuid().nullable().optional(),
    epicId: z.string().uuid().nullable().optional(),
    milestoneId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().uuid().optional(),
    dueDate: taskDate.optional(),
    labels: z.array(z.string().max(50)).max(20).optional().default([]),
    // Subtasks + AC use the SAME `{ id, text, done }` shape as the
    // dedicated PATCH endpoints (updateSubtasksSchema, updateAcceptanceCriteriaSchema).
    // The earlier create-only `title` field was a divergence — frontends
    // already use `text` everywhere via the ChecklistItem interface, so
    // sending a `title` payload would have failed against the AC update
    // endpoint. (Team feedback #4: aligning so the same in-memory items
    // can be sent inline on create OR via the dedicated PATCH on edit
    // without reshape gymnastics.)
    subtasks: z.array(z.object({ id: z.string(), text: z.string().max(500), done: z.boolean() })).max(50).optional().default([]),
    acceptanceCriteria: z.array(z.object({ id: z.string(), text: z.string().max(500), done: z.boolean() })).max(50).optional().default([]),
    customFields: z.record(z.string(), z.unknown()).optional(),
    clientVisible: z.boolean().optional().default(false),
    // Whether this is a client-submitted task request. Clients set true
    // via their portal kanban; the service forces clientVisible=true and
    // status=BACKLOG when set. Internal users may pass false (default) or
    // true if they're entering a task on a client's behalf — either way
    // the service re-derives based on the actor's role for safety.
    clientRequested: z.boolean().optional().default(false),
    // Optional product scoping (PR C feature #6). Service verifies the
    // product belongs to the same project — a body-supplied productId
    // from another project gets rejected so we never silently link a
    // task to the wrong scope.
    productId: z.string().uuid().nullable().optional(),
  }),
});

export const updateTaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    taskType: z.nativeEnum(TaskType).optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(TaskPriority).optional(),
    storyPoints: z.number().int().min(1).max(100).nullable().optional(),
    sprintId: z.string().uuid().nullable().optional(),
    epicId: z.string().uuid().nullable().optional(),
    milestoneId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    // Mixed assignment: open the task to an agent capability pool (free-form
    // role, matched against User.agentRole). Ignored once assigneeId is set.
    agentPoolRole: z.string().max(50).nullable().optional(),
    dueDate: taskDate.nullable().optional(),
    labels: z.array(z.string().max(50)).max(20).optional(),
    // Same shape as create — see note above. Aligned with the PATCH
    // /tasks/:id/subtasks endpoint to keep the wire format consistent.
    subtasks: z.array(z.object({ id: z.string(), text: z.string().max(500), done: z.boolean() })).max(50).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    isBlocked: z.boolean().optional(),
    blockerNote: z.string().max(2_000).nullable().optional(),
    clientVisible: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    // Re-scoping a task to a different product (or to none). Service
    // verifies the product belongs to the same project before persisting.
    productId: z.string().uuid().nullable().optional(),
    // 2026-05-15 optimistic-locking audit. ISO timestamp of the
    // task's `updatedAt` as the caller last read it. When supplied,
    // the service refuses the write if the server has moved on
    // (someone else's edit landed first). Optional — older clients
    // that don't send it keep last-write-wins behavior. Strict ISO
    // shape so a malformed value fails fast at the validator
    // rather than producing a `new Date('Invalid Date')` mismatch
    // that masquerades as a conflict.
    expectedUpdatedAt: z.string().datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' }).optional(),
  }),
});

export const moveTaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    status: z.nativeEnum(TaskStatus),
    sortOrder: z.number().int().optional(),
    // Optimistic-locking guard for drag-to-move (2026-06). ISO timestamp
    // of the card's `updatedAt` as the dragging client last saw it; the
    // service rejects the move with 409 if someone else moved the card
    // first. Optional — older clients keep last-write-wins.
    expectedUpdatedAt: z.string().datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' }).optional(),
  }),
});

export const reorderTaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    sortOrder: z.number().int(),
  }),
});

// ─── Bulk ops ────────────────────────────────────────────────────────────
//
// Cap batch size at 200 — UI selects of >200 are almost always a misclick
// and the per-task auth round-trip cost grows linearly. The board fetch
// caps at 500 anyway, so 200 covers "everything in a column" comfortably.
const MAX_BULK = 200;

// Each field is independently optional; whichever the client sends is the
// "patch". `null` is meaningful for sprintId/epicId/assigneeId (= unset).
// blockerNote pairs with isBlocked: setting isBlocked=false also wipes the
// note in the service layer.
const bulkChangeSchema = z.object({
  sprintId: z.string().uuid().nullable().optional(),
  epicId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  // Bulk status moves. The service runs the same state-machine + AC done-gate
  // + assignee gate per task (partial failure for illegal/unowned moves).
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  isBlocked: z.boolean().optional(),
  blockerNote: z.string().max(2_000).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' },
);

export const bulkUpdateTasksSchema = z.object({
  body: z.object({
    taskIds: z.array(z.string().uuid()).min(1, 'taskIds cannot be empty').max(MAX_BULK, `Max ${MAX_BULK} tasks per request`),
    change: bulkChangeSchema,
  }),
});

export const bulkDeleteTasksSchema = z.object({
  body: z.object({
    taskIds: z.array(z.string().uuid()).min(1, 'taskIds cannot be empty').max(MAX_BULK, `Max ${MAX_BULK} tasks per request`),
  }),
});

// Shared shape for sub-tasks + acceptance-criteria — both stored on Task as
// JSON arrays of these items. The service layer also enforces a max of 50
// items and trims/validates text length.
const checklistItemSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  text: z.string().min(1, 'Item text is required').max(500),
  done: z.boolean().default(false),
});

export const updateSubtasksSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    subtasks: z.array(checklistItemSchema).max(50),
  }),
});

export const updateAcceptanceCriteriaSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    acceptanceCriteria: z.array(checklistItemSchema).max(50),
  }),
});

// ─── Review workflow ─────────────────────────────────────────────────
//
// `requestReview` accepts a reviewer (project member, possibly the
// client) and an optional note that lands as a Comment on the task.
// `decideReview` accepts a decision; REQUEST_CHANGES additionally
// requires a non-empty comment (the service enforces this too — see
// task.service.decideReview — but front-loading the rejection here
// gives a faster, friendlier validation error).

export const requestReviewSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reviewerId: z.string().uuid('Pick a reviewer'),
    // Same 5000-char cap as a regular comment (comment.service enforces).
    note: z.string().trim().max(5000).optional(),
  }),
});

export const decideReviewSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    decision: z.enum(['APPROVE', 'REQUEST_CHANGES']),
    comment: z.string().trim().max(5000).optional(),
  }).refine(
    (b) => b.decision !== 'REQUEST_CHANGES' || (b.comment && b.comment.length > 0),
    { message: 'A comment is required when requesting changes', path: ['comment'] },
  ),
});

// CC feature PR 2026-05-20 — Nudge a teammate about a task.
//
// Optional `message` so the nudge can be soft ("hey, when you get a
// chance") or pointed ("client is asking for an update on this").
// 500-char cap matches the "short signal, not a comment" intent —
// proper discussion belongs in task comments.
export const nudgeTaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    message: z.string().trim().max(500).optional(),
  }).optional(),
});
