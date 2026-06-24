import prisma from '../config/database';
import { logActivity } from './activity.service';

export async function listStatusUpdates(projectId: string) {
  return prisma.statusUpdate.findMany({
    where: { projectId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createStatusUpdate(projectId: string, data: any, userId: string) {
  const statusUpdate = await prisma.statusUpdate.create({
    data: {
      projectId,
      authorId: userId,
      signal: data.signal,
      note: data.note || null,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  // Update project health if signal differs — but ONLY if the project isn't
  // in autoHealth mode (QA finding #31). When autoHealth is on, the
  // project's health is computed from blockers/velocity/etc., and a manual
  // status update overriding that silently was confusing — admins thought
  // their health rules were broken. Manual override now requires switching
  // autoHealth off first.
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (project && !project.autoHealth && project.healthStatus !== data.signal) {
    await prisma.project.update({
      where: { id: projectId },
      data: { healthStatus: data.signal },
    });
  }

  await logActivity({
    userId, projectId, action: 'created_status_update',
    targetType: 'project', targetId: projectId,
    details: { signal: data.signal, note: data.note },
  });

  return statusUpdate;
}
