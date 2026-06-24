import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';
import { logActivity } from './activity.service';

export async function listDecisions(projectId: string, filters: any = {}) {
  const where: any = { projectId };

  if (filters.status) where.status = filters.status;
  if (filters.search) {
    // Cap the search term — `contains` against a 50K rationale ILIKE on a
    // huge user-supplied string is a cheap DoS surface (QA finding #49).
    // 200 chars is plenty for any real user query.
    const term = String(filters.search).slice(0, 200);
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { rationale: { contains: term, mode: 'insensitive' } },
    ];
  }

  return prisma.decision.findMany({
    where,
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    // Pagination floor — default 100, cap 500. Prevents the same unbounded
    // dump pattern we fixed on tasks.
    take: Math.min(Math.max(parseInt(String(filters.limit ?? '100'), 10) || 100, 1), 500),
  });
}

export async function createDecision(projectId: string, data: any, userId: string) {
  const decision = await prisma.decision.create({
    data: { ...data, projectId, createdById: userId },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  await logActivity({
    userId, projectId, action: 'created_decision',
    targetType: 'decision', targetId: decision.id,
    details: { title: decision.title },
  });

  return decision;
}

export async function updateDecision(decisionId: string, data: any, userId: string) {
  const existing = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!existing) throw new NotFoundError('Decision');

  const decision = await prisma.decision.update({
    where: { id: decisionId },
    data,
    include: { createdBy: { select: { id: true, name: true } } },
  });

  await logActivity({
    userId, projectId: existing.projectId, action: 'updated_decision',
    targetType: 'decision', targetId: decisionId,
    details: { title: decision.title },
  });

  return decision;
}

export async function deleteDecision(decisionId: string, userId: string) {
  const decision = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new NotFoundError('Decision');

  await prisma.decision.delete({ where: { id: decisionId } });

  await logActivity({
    userId, projectId: decision.projectId, action: 'deleted_decision',
    targetType: 'decision', targetId: decisionId,
    details: { title: decision.title },
  });
}
