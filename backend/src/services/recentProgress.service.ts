import { TaskStatus } from '@prisma/client';
import type { RecentProgressItem, RecentProgressResponse } from '@exargen/shared';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';

/**
 * "Shipped this week" — top-N client-visible tasks that transitioned to
 * DONE within a rolling N-day window. Used by the highlight-reel card on
 * the client project status page.
 *
 * Implementation notes:
 *
 * - We could read `Task.updatedAt` as a proxy for completion time, but
 *   that's wrong: editing a description on a long-done task bumps
 *   updatedAt and would re-surface it in "this week." Reading from
 *   `task_status_history` with `toStatus = DONE` gives the *moment* the
 *   transition happened — which is what "shipped" actually means.
 *
 * - If a task was un-DONE then re-DONE inside the window, we take the
 *   most-recent DONE-transition as completedAt. The rare flip-flop case
 *   shouldn't surface as two ships.
 *
 * - Ranking is greedy: size first (bigger ships matter), priority as
 *   tiebreak, recency as the final tiebreak. Predictable + cheap.
 */

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 20;

// Priority order: P0 (highest) → P3 (lowest). Used for tie-break sort.
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export async function getRecentProgress(
  projectId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
  limit: number = DEFAULT_LIMIT,
): Promise<RecentProgressResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new NotFoundError('Project');

  const clampedDays = Math.max(1, Math.min(windowDays | 0, 90));
  const clampedLimit = Math.max(1, Math.min(limit | 0, MAX_LIMIT));
  const since = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000);

  // Pull every DONE-transition in the window, joined to its task so we
  // can filter on clientVisible + read the task's current points/priority/
  // type. We collapse multiple transitions per task (flip-flop case) by
  // taking the most-recent one as completedAt.
  const transitions = await prisma.taskStatusHistory.findMany({
    where: {
      toStatus: 'DONE' as TaskStatus,
      changedAt: { gte: since },
      task: { projectId, clientVisible: true, status: 'DONE' as TaskStatus },
    },
    select: {
      changedAt: true,
      task: {
        select: {
          id: true,
          title: true,
          storyPoints: true,
          priority: true,
          taskType: true,
        },
      },
    },
    orderBy: { changedAt: 'desc' },
  });

  // Collapse to one row per task (keep the latest DONE-transition).
  // Map preserves insertion order, and we iterated newest-first, so the
  // first occurrence wins.
  const byTaskId = new Map<string, { changedAt: Date; task: typeof transitions[0]['task'] }>();
  for (const t of transitions) {
    if (!byTaskId.has(t.task.id)) byTaskId.set(t.task.id, t);
  }

  const flat = [...byTaskId.values()];
  const totalThisWindow = flat.length;

  // Rank for highlight reel: size DESC, priority asc (P0 < P3 in rank),
  // recency DESC.
  flat.sort((a, b) => {
    const sizeA = a.task.storyPoints ?? 0;
    const sizeB = b.task.storyPoints ?? 0;
    if (sizeA !== sizeB) return sizeB - sizeA;
    const prA = PRIORITY_RANK[a.task.priority] ?? 99;
    const prB = PRIORITY_RANK[b.task.priority] ?? 99;
    if (prA !== prB) return prA - prB;
    return b.changedAt.getTime() - a.changedAt.getTime();
  });

  const items: RecentProgressItem[] = flat.slice(0, clampedLimit).map((row) => ({
    taskId: row.task.id,
    title: row.task.title,
    completedAt: row.changedAt.toISOString(),
    storyPoints: row.task.storyPoints,
    priority: row.task.priority as RecentProgressItem['priority'],
    taskType: row.task.taskType as RecentProgressItem['taskType'],
  }));

  return { items, totalThisWindow, windowDays: clampedDays };
}
