import { z } from 'zod';

// Story-update payload — the parsed fields of the client-facing story
// template. Only `objective`, `currentTask`, and `progress` are required
// so an engineer can post a quick progress bump; the rest are optional.
export const storyUpdateDataSchema = z.object({
  objective: z.string().min(1, 'Objective is required').max(2000),
  currentTask: z.string().min(1, 'Current task is required').max(2000),
  reason: z.string().max(2000).optional(),
  impact: z.string().max(2000).optional(),
  designChange: z.enum(['none', 'changed']).default('none'),
  designOriginal: z.string().max(2000).optional(),
  designNew: z.string().max(2000).optional(),
  progress: z.number().int().min(0).max(100),
  nextStep: z.string().max(2000).optional(),
});

export const createCommentSchema = z.object({
  body: z
    .object({
      // Optional at the field level because a story_update derives its
      // `content` server-side from `storyData`. The superRefine below
      // enforces "plain ⇒ content required".
      content: z.string().min(1).max(5000).optional(),
      taskId: z.string().uuid().optional(),
      milestoneId: z.string().uuid().optional(),
      kind: z.enum(['plain', 'story_update']).optional(),
      storyData: storyUpdateDataSchema.optional(),
    })
    .superRefine((val, ctx) => {
      if (val.kind === 'story_update') {
        // A story update must carry its structured payload, and it only
        // makes sense on a task (not a milestone/project-level comment).
        if (!val.storyData) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['storyData'],
            message: 'storyData is required for a story_update comment',
          });
        }
        if (val.milestoneId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['milestoneId'],
            message: 'A story_update can only be posted on a task',
          });
        }
      } else if (!val.content || val.content.trim().length === 0) {
        // Plain comment (kind omitted or "plain") still requires a body.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['content'],
          message: 'content is required',
        });
      }
    }),
});

// Cheap UUID guard for routes whose only param is a comment id. Without this,
// `prisma.comment.findUnique({ where: { id: req.params.id } })` would do a DB
// round-trip on every garbage value an attacker tries (QA finding #4).
export const commentIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid comment id') }),
});

export const updateCommentSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid comment id') }),
  // No taskId/milestoneId — those are immutable once a comment is posted.
  // Editing only changes the body; reattaching to a different task would
  // break @-mention notification history and audit consistency.
  body: z
    .object({
      // `content` for a plain comment, `storyData` for a story_update —
      // both optional at the field level; the refine requires one. The
      // service enforces which one matches the comment's kind.
      content: z.string().min(1).max(5000).optional(),
      storyData: storyUpdateDataSchema.optional(),
      // 2026-05-21 optimistic-locking expansion. See milestone.schema for
      // the full rationale. Opt-in.
      expectedUpdatedAt: z
        .string()
        .datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' })
        .optional(),
    })
    .superRefine((val, ctx) => {
      if (!val.content && !val.storyData) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['content'],
          message: 'Provide content (plain comment) or storyData (story update)',
        });
      }
    }),
});
