import { DeliverableStatus } from '@prisma/client';
import prisma from '../config/database';
import { LIST_QUERY_CAP } from '../constants/listLimits';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';

export async function listDeliverables(projectId: string) {
  return prisma.deliverable.findMany({
    where: { projectId },
    include: {
      signedOffBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: LIST_QUERY_CAP,
  });
}

export async function getDeliverable(deliverableId: string) {
  const d = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    include: {
      signedOffBy: { select: { id: true, name: true, role: true } },
      project: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!d) throw new NotFoundError('Deliverable');
  return d;
}

export async function createDeliverable(projectId: string, data: any, userId: string) {
  if (!data.title?.trim()) throw new ValidationError('Title is required');

  const maxOrder = await prisma.deliverable.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const deliverable = await prisma.deliverable.create({
    data: {
      projectId,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      acceptanceCriteria: data.acceptanceCriteria?.trim() || null,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      sortOrder: (maxOrder._max.sortOrder || 0) + 1,
    },
    include: {
      signedOffBy: { select: { id: true, name: true, role: true } },
    },
  });

  await logActivity({
    userId,
    projectId,
    action: 'created_deliverable',
    targetType: 'deliverable',
    targetId: deliverable.id,
    details: { title: deliverable.title },
  });

  return deliverable;
}

// Status transitions are constrained — sign-off is a one-way door.
const VALID_TRANSITIONS: Record<DeliverableStatus, DeliverableStatus[]> = {
  PENDING:     ['IN_PROGRESS', 'DELIVERED'],
  IN_PROGRESS: ['PENDING', 'DELIVERED'],
  DELIVERED:   ['IN_PROGRESS', 'SIGNED_OFF', 'REJECTED'],
  REJECTED:    ['IN_PROGRESS'],
  SIGNED_OFF:  [], // terminal — cannot be changed
};

export async function updateDeliverable(deliverableId: string, data: any, userId: string) {
  const existing = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!existing) throw new NotFoundError('Deliverable');

  if (existing.status === DeliverableStatus.SIGNED_OFF) {
    throw new ForbiddenError('A signed-off deliverable cannot be modified — it is part of the legal acceptance record.');
  }

  // Validate status transition if status is changing
  if (data.status && data.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status as DeliverableStatus];
    if (!allowed.includes(data.status as DeliverableStatus)) {
      throw new ValidationError(`Cannot transition from ${existing.status} to ${data.status}.`);
    }
  }

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = String(data.title).trim();
  if (data.description !== undefined) updateData.description = data.description ? String(data.description).trim() : null;
  if (data.acceptanceCriteria !== undefined) updateData.acceptanceCriteria = data.acceptanceCriteria ? String(data.acceptanceCriteria).trim() : null;
  if (data.targetDate !== undefined) updateData.targetDate = data.targetDate ? new Date(data.targetDate) : null;
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === DeliverableStatus.DELIVERED && !existing.deliveredAt) {
      updateData.deliveredAt = new Date();
    }
    if (data.status !== DeliverableStatus.DELIVERED && data.status !== DeliverableStatus.SIGNED_OFF) {
      // moving back from delivered → clear deliveredAt
      if (existing.deliveredAt) updateData.deliveredAt = null;
    }
  }

  const updated = await prisma.deliverable.update({
    where: { id: deliverableId },
    data: updateData,
    include: {
      signedOffBy: { select: { id: true, name: true, role: true } },
    },
  });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'updated_deliverable',
    targetType: 'deliverable',
    targetId: deliverableId,
    details: {
      title: updated.title,
      ...(data.status && data.status !== existing.status ? { from: existing.status, to: data.status } : {}),
    },
  });

  return updated;
}

export async function deleteDeliverable(deliverableId: string, userId: string) {
  const existing = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!existing) throw new NotFoundError('Deliverable');

  if (existing.status === DeliverableStatus.SIGNED_OFF) {
    throw new ForbiddenError('A signed-off deliverable cannot be deleted — it is part of the legal acceptance record.');
  }

  await prisma.deliverable.delete({ where: { id: deliverableId } });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'deleted_deliverable',
    targetType: 'deliverable',
    targetId: deliverableId,
    details: { title: existing.title },
  });
}

export async function markDelivered(deliverableId: string, userId: string) {
  const existing = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!existing) throw new NotFoundError('Deliverable');

  if (existing.status === DeliverableStatus.SIGNED_OFF) {
    throw new ForbiddenError('Already signed off.');
  }
  if (existing.status === DeliverableStatus.DELIVERED) {
    throw new ValidationError('Already marked as delivered.');
  }

  const updated = await prisma.deliverable.update({
    where: { id: deliverableId },
    data: {
      status: DeliverableStatus.DELIVERED,
      deliveredAt: new Date(),
    },
    include: { signedOffBy: { select: { id: true, name: true, role: true } } },
  });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'marked_deliverable_delivered',
    targetType: 'deliverable',
    targetId: deliverableId,
    details: { title: updated.title },
  });

  return updated;
}

export async function signOffDeliverable(deliverableId: string, userId: string) {
  const existing = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!existing) throw new NotFoundError('Deliverable');

  if (existing.status === DeliverableStatus.SIGNED_OFF) {
    throw new ValidationError('Already signed off.');
  }
  if (existing.status !== DeliverableStatus.DELIVERED) {
    throw new ValidationError('Deliverable must be marked as delivered before sign-off.');
  }

  // Sign-off is irreversible — record who and when, immutable.
  const updated = await prisma.deliverable.update({
    where: { id: deliverableId },
    data: {
      status: DeliverableStatus.SIGNED_OFF,
      signedOffAt: new Date(),
      signedOffById: userId,
      rejectionNote: null,
    },
    include: { signedOffBy: { select: { id: true, name: true, role: true } } },
  });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'signed_off_deliverable',
    targetType: 'deliverable',
    targetId: deliverableId,
    details: { title: updated.title },
  });

  return updated;
}

export async function rejectDeliverable(deliverableId: string, note: string, userId: string) {
  const existing = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!existing) throw new NotFoundError('Deliverable');

  if (existing.status !== DeliverableStatus.DELIVERED) {
    throw new ValidationError('Only delivered items can be rejected.');
  }

  const updated = await prisma.deliverable.update({
    where: { id: deliverableId },
    data: {
      status: DeliverableStatus.REJECTED,
      rejectionNote: note?.trim() || null,
      deliveredAt: null,
    },
    include: { signedOffBy: { select: { id: true, name: true, role: true } } },
  });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'rejected_deliverable',
    targetType: 'deliverable',
    targetId: deliverableId,
    details: { title: updated.title, note },
  });

  return updated;
}
