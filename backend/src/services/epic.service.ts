import { EpicStatus, TaskStatus } from '@prisma/client';
import prisma from '../config/database';
import { LIST_QUERY_CAP } from '../constants/listLimits';
import { NotFoundError } from '../utils/errors';

function rollupTasks(tasks: { status: TaskStatus; storyPoints: number | null }[]) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === TaskStatus.DONE).length;
  const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  const donePoints = tasks
    .filter((t) => t.status === TaskStatus.DONE)
    .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  return {
    totalTasks,
    doneTasks,
    totalPoints,
    donePoints,
    progressPct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
  };
}

export async function createEpic(projectId: string, data: { title: string; description?: string; color?: string }) {
  return prisma.epic.create({
    data: {
      projectId,
      title: data.title,
      description: data.description || null,
      color: data.color || '#6366f1',
    },
    include: { _count: { select: { tasks: true } } },
  });
}

export async function getProjectEpics(projectId: string) {
  const epics = await prisma.epic.findMany({
    where: { projectId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      tasks: { select: { status: true, storyPoints: true } },
    },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: LIST_QUERY_CAP,
  });

  return epics.map((e) => {
    const { tasks, ...epic } = e;
    return { ...epic, ...rollupTasks(tasks) };
  });
}

/**
 * Detail view for the slide-over panel — epic + all its tasks (lightweight,
 * suitable for a list inside the panel) + the rollup totals.
 */
export async function getEpicDetail(epicId: string) {
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    include: {
      tasks: {
        select: {
          id: true,
          taskNumber: true,
          title: true,
          status: true,
          priority: true,
          storyPoints: true,
          isBlocked: true,
          assignee: { select: { id: true, name: true } },
          sprint: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ status: 'asc' }, { priority: 'asc' }, { taskNumber: 'asc' }],
      },
    },
  });
  if (!epic) throw new NotFoundError('Epic');

  const rollup = rollupTasks(epic.tasks);
  return { ...epic, ...rollup };
}

export async function updateEpic(epicId: string, data: { title?: string; description?: string; color?: string; status?: EpicStatus }) {
  return prisma.epic.update({
    where: { id: epicId },
    data,
    include: { _count: { select: { tasks: true } } },
  });
}

export async function deleteEpic(epicId: string) {
  // Unassign tasks from epic before deleting — the cascade is intentional
  // ergonomics: deleting an epic shouldn't delete its work, just orphan it.
  await prisma.task.updateMany({ where: { epicId }, data: { epicId: null } });
  return prisma.epic.delete({ where: { id: epicId } });
}
