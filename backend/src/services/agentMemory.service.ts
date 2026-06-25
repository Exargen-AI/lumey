/**
 * Cross-run agent memory — record durable learnings from a run and recall the
 * most relevant ones into a later run's context (RAG), so the agent doesn't
 * relearn the same project every time. Scoped by project. Recall is **semantic**
 * (cosine similarity over local embeddings) when a query vector is supplied, and
 * falls back to **recency** when it isn't — so memory works with or without an
 * embedding model configured.
 */
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { rankBySimilarity } from '../lib/vector';

/** How many recent memories to consider as candidates for semantic ranking. */
const SEMANTIC_CANDIDATES = 100;

export interface MemoryInput {
  readonly projectId: string;
  readonly kind: string;
  readonly content: string;
  readonly sourceRunId?: string;
  /** Optional semantic embedding of `content` (from a local embedding model). */
  readonly embedding?: number[];
}

export async function recordMemory(input: MemoryInput) {
  const content = input.content.trim();
  if (!content) return null; // nothing worth remembering
  return prisma.agentMemory.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      content,
      sourceRunId: input.sourceRunId ?? null,
      embedding: input.embedding ? (input.embedding as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * Recall a project's memories: semantically ranked by cosine similarity to
 * `queryEmbedding` when given (RAG), else most-recent-first.
 */
export async function recallMemories(
  projectId: string,
  opts: { limit?: number; queryEmbedding?: number[] } = {},
) {
  const limit = opts.limit ?? 10;
  if (opts.queryEmbedding && opts.queryEmbedding.length) {
    const candidates = await prisma.agentMemory.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: SEMANTIC_CANDIDATES,
    });
    const embedded = candidates
      .filter((m) => Array.isArray(m.embedding))
      .map((m) => ({ item: m, vector: m.embedding as number[] }));
    // Rank the embedded ones; if none are embedded yet, fall back to recency.
    return embedded.length ? rankBySimilarity(opts.queryEmbedding, embedded, limit) : candidates.slice(0, limit);
  }
  return prisma.agentMemory.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** The project a task belongs to (for scoping memory), or null. */
export async function projectIdForTask(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  return task?.projectId ?? null;
}
