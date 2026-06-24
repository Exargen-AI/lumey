/**
 * Cross-run agent memory — record durable learnings from a run and recall the
 * most relevant ones into a later run's context, so the agent doesn't relearn
 * the same project every time. Scoped by project; recency-ordered (a real
 * relevance/embedding ranker can replace the ordering later without changing
 * callers).
 */
import prisma from '../config/database';

export interface MemoryInput {
  readonly projectId: string;
  readonly kind: string;
  readonly content: string;
  readonly sourceRunId?: string;
}

export async function recordMemory(input: MemoryInput) {
  const content = input.content.trim();
  if (!content) return null; // nothing worth remembering
  return prisma.agentMemory.create({
    data: { projectId: input.projectId, kind: input.kind, content, sourceRunId: input.sourceRunId ?? null },
  });
}

/** The most recent memories for a project (newest first). */
export async function recallMemories(projectId: string, opts: { limit?: number } = {}) {
  return prisma.agentMemory.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 10,
  });
}

/** The project a task belongs to (for scoping memory), or null. */
export async function projectIdForTask(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  return task?.projectId ?? null;
}
