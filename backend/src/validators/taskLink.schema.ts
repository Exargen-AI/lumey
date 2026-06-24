import { z } from 'zod';

export const createTaskLinkSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    targetTaskId: z.string().uuid(),
    // SPAWNED_FROM added in PR C — bug task spin-offs. fromTask "was
    // spawned from" toTask. The link picker UI doesn't surface this
    // option directly; the "Spin off task" action wires the link
    // automatically as part of creating the new child task.
    type: z.enum(['BLOCKS', 'RELATES_TO', 'DUPLICATES', 'SPAWNED_FROM']),
  }),
});

export const deleteTaskLinkSchema = z.object({
  params: z.object({ linkId: z.string().uuid() }),
});

/**
 * Spawn-subtask body. Inherits productId + clientVisible from the parent
 * server-side, so the client only needs to send the new task's title +
 * optional description / type. taskType defaults to FEATURE because most
 * bug spin-offs are fix/test/docs tasks, not bugs themselves.
 */
export const spawnSubtaskSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().max(10_000).nullable().optional(),
    taskType: z.enum(['FEATURE', 'BUG', 'CHORE', 'SPIKE']).optional(),
  }),
});
