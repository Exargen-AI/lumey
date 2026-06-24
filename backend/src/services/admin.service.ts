import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { env } from '../config/env';

export async function clearSeedData() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Clearing seed data is disabled in production');
  }

  // Find the seed users we're about to delete so we can also remove rows in
  // tables that have a User FK without `isSeedData` (daily_updates, time_entries,
  // notifications, timesheet_weeks, task_status_history, cms_blogs). Without
  // these, the final user.deleteMany hits a P2003 FK constraint violation.
  const seedUsers = await prisma.user.findMany({
    where: { isSeedData: true, role: { not: UserRole.SUPER_ADMIN } },
    select: { id: true },
  });
  const seedUserIds = seedUsers.map((u) => u.id);

  // Delete in FK-safe order — child rows first.
  await prisma.activity.deleteMany({ where: { user: { isSeedData: true } } });
  await prisma.comment.deleteMany({ where: { isSeedData: true } });
  await prisma.statusUpdate.deleteMany({ where: { author: { isSeedData: true } } });
  await prisma.decision.deleteMany({ where: { isSeedData: true } });
  await prisma.milestone.deleteMany({ where: { isSeedData: true } });
  await prisma.task.deleteMany({ where: { isSeedData: true } });
  await prisma.projectMember.deleteMany({ where: { project: { isSeedData: true } } });
  await prisma.project.deleteMany({ where: { isSeedData: true } });

  // Tables that reference users but don't have an isSeedData flag — clear by userId.
  if (seedUserIds.length > 0) {
    await prisma.taskStatusHistory.deleteMany({ where: { changedBy: { in: seedUserIds } } });
    await prisma.dailyUpdate.deleteMany({ where: { userId: { in: seedUserIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: seedUserIds } } });
  }

  await prisma.user.deleteMany({ where: { isSeedData: true, role: { not: UserRole.SUPER_ADMIN } } });
}

export async function getSystemStats() {
  const [users, projects, tasks, activities] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.project.count(),
    prisma.task.count(),
    prisma.activity.count(),
  ]);

  return { users, projects, tasks, activities };
}

export async function exportData() {
  const [users, projects, tasks, milestones, decisions, comments] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true } }),
    prisma.project.findMany(),
    prisma.task.findMany(),
    prisma.milestone.findMany(),
    prisma.decision.findMany(),
    prisma.comment.findMany(),
  ]);

  return { users, projects, tasks, milestones, decisions, comments };
}
