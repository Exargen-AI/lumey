import type { ClientActionItem, ClientActionsResponse } from '@exargen/shared';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';

/**
 * Aggregate "items waiting on the client" for one project. Two sources
 * (deliverables in DELIVERED, decisions in PROPOSED) — merged + sorted
 * oldest-first so the most urgent item is at the top of the callout.
 *
 * Why a separate service from the existing deliverable / decision routes:
 * the callout needs both streams in a single response (single React Query
 * cache key, single network round-trip, predictable sort order). Keeping
 * the merge on the server also means the client view never sees an item
 * the underlying entity service is hiding (e.g. via permission filters).
 */
export async function getClientActions(projectId: string): Promise<ClientActionsResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new NotFoundError('Project');

  // Two parallel reads — both small (a project typically has < 20 items in
  // these states combined). No reason to serialize them.
  const [deliverables, decisions] = await Promise.all([
    prisma.deliverable.findMany({
      where: { projectId, status: 'DELIVERED' },
      select: { id: true, title: true, deliveredAt: true, createdAt: true },
    }),
    prisma.decision.findMany({
      where: { projectId, status: 'PROPOSED' },
      select: { id: true, title: true, createdAt: true },
    }),
  ]);

  const now = Date.now();

  const deliverableItems: ClientActionItem[] = deliverables.map((d) => {
    // Prefer deliveredAt (when the team actually handed it over); fall back
    // to createdAt for legacy rows where deliveredAt wasn't recorded.
    const since = d.deliveredAt ?? d.createdAt;
    return {
      kind: 'DELIVERABLE',
      id: d.id,
      title: d.title,
      since: since.toISOString(),
      waitingDays: daysSince(since.getTime(), now),
    };
  });

  const decisionItems: ClientActionItem[] = decisions.map((d) => ({
    kind: 'DECISION',
    id: d.id,
    title: d.title,
    since: d.createdAt.toISOString(),
    waitingDays: daysSince(d.createdAt.getTime(), now),
  }));

  // Merge + sort oldest-first (largest waitingDays first). Ties broken by
  // title for deterministic ordering, which matters for React keys and
  // test snapshots.
  const items = [...deliverableItems, ...decisionItems].sort((a, b) => {
    if (b.waitingDays !== a.waitingDays) return b.waitingDays - a.waitingDays;
    return a.title.localeCompare(b.title);
  });

  return { items, count: items.length };
}

function daysSince(thenMs: number, nowMs: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((nowMs - thenMs) / msPerDay));
}
