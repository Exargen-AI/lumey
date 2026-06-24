import { TaskStatus } from '@prisma/client';
import prisma from '../config/database';
import { toDateOnlyString } from '../utils/date';

interface DailyUpdateInput {
  summary: string;
  blockers?: string;
  plans?: string;
  hoursWorked?: number;
  tasks?: {
    taskId: string;
    note?: string;
    statusBefore: TaskStatus;
    statusAfter: TaskStatus;
  }[];
}

export async function submitDailyUpdate(userId: string, input: DailyUpdateInput) {
  // Validate required fields
  if (!input.summary?.trim()) throw new Error('Summary is required');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Verify task ownership if tasks are provided
  if (input.tasks?.length) {
    const taskIds = input.tasks.map((t) => t.taskId);
    const ownedTasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, assigneeId: userId },
      select: { id: true },
    });
    const ownedIds = new Set(ownedTasks.map((t) => t.id));
    const unauthorized = taskIds.filter((id) => !ownedIds.has(id));
    if (unauthorized.length > 0) {
      throw new Error(`Not authorized to update tasks: ${unauthorized.join(', ')}`);
    }
  }

  // Use transaction for atomic operation
  return prisma.$transaction(async (tx) => {
    const dailyUpdate = await tx.dailyUpdate.upsert({
      where: { userId_date: { userId, date: today } },
      update: {
        summary: input.summary.trim(),
        blockers: input.blockers?.trim() || null,
        plans: input.plans?.trim() || null,
        hoursWorked: input.hoursWorked ?? null,
      },
      create: {
        userId,
        date: today,
        summary: input.summary.trim(),
        blockers: input.blockers?.trim() || null,
        plans: input.plans?.trim() || null,
        hoursWorked: input.hoursWorked ?? null,
      },
    });

    // Delete old task entries and recreate atomically
    await tx.dailyUpdateTask.deleteMany({ where: { dailyUpdateId: dailyUpdate.id } });

    if (input.tasks?.length) {
      await tx.dailyUpdateTask.createMany({
        data: input.tasks.map((t) => ({
          dailyUpdateId: dailyUpdate.id,
          taskId: t.taskId,
          note: t.note?.trim() || null,
          statusBefore: t.statusBefore,
          statusAfter: t.statusAfter,
        })),
      });

      // Apply status changes to tasks
      for (const t of input.tasks) {
        if (t.statusBefore !== t.statusAfter) {
          await tx.task.update({
            where: { id: t.taskId },
            data: { status: t.statusAfter },
          });
          await tx.taskStatusHistory.create({
            data: { taskId: t.taskId, fromStatus: t.statusBefore, toStatus: t.statusAfter, changedBy: userId },
          });
        }
      }
    }

    return tx.dailyUpdate.findUnique({
      where: { id: dailyUpdate.id },
      include: {
        tasks: { include: { task: { select: { id: true, title: true, status: true, projectId: true, project: { select: { name: true } } } } } },
      },
    });
  });
}

export async function getMyDailyUpdates(userId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [updates, total] = await Promise.all([
    prisma.dailyUpdate.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      skip,
      take: limit,
      include: {
        tasks: { include: { task: { select: { id: true, title: true, project: { select: { name: true } } } } } },
      },
    }),
    prisma.dailyUpdate.count({ where: { userId } }),
  ]);
  return { updates, total, page, limit };
}

export async function getMyStreak(userId: string) {
  const updates = await prisma.dailyUpdate.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    select: { date: true },
    take: 365,
  });

  // Build a 30-day heatmap (oldest → newest) marking each day as
  // submitted or not. Lets the frontend render a GitHub-contribution-style
  // activity grid without a second round-trip.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const submittedByDay = new Set<string>();
  for (const u of updates) {
    const d = new Date(u.date); d.setHours(0, 0, 0, 0);
    submittedByDay.add(d.toISOString().slice(0, 10));
  }
  const recentDays: Array<{ date: string; submitted: boolean }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    recentDays.push({
      date: key,
      submitted: submittedByDay.has(key),
    });
  }

  if (!updates.length) return { currentStreak: 0, longestStreak: 0, recentDays };

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  // `today` already declared above for recentDays computation
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if most recent update is today or yesterday
  const mostRecent = new Date(updates[0].date);
  mostRecent.setHours(0, 0, 0, 0);

  if (mostRecent.getTime() !== today.getTime() && mostRecent.getTime() !== yesterday.getTime()) {
    return { currentStreak: 0, longestStreak: calcLongest(updates), recentDays };
  }

  // Count current streak
  currentStreak = 1;
  for (let i = 1; i < updates.length; i++) {
    const curr = new Date(updates[i - 1].date);
    const prev = new Date(updates[i].date);
    curr.setHours(0, 0, 0, 0);
    prev.setHours(0, 0, 0, 0);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      currentStreak++;
    } else {
      break;
    }
  }

  return { currentStreak, longestStreak: Math.max(currentStreak, calcLongest(updates)), recentDays };
}

function calcLongest(updates: { date: Date }[]): number {
  if (!updates.length) return 0;
  let longest = 1;
  let streak = 1;
  for (let i = 1; i < updates.length; i++) {
    const curr = new Date(updates[i - 1].date);
    const prev = new Date(updates[i].date);
    curr.setHours(0, 0, 0, 0);
    prev.setHours(0, 0, 0, 0);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 1;
    }
  }
  return longest;
}

export async function getMyProductivityStats(userId: string, daysBack = 7) {
  const now = new Date();
  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [tasksCompletedThisWeek, tasksCompletedLastWeek, tasksByStatus, totalCompleted] = await Promise.all([
    prisma.task.count({
      where: { assigneeId: userId, status: 'DONE', updatedAt: { gte: oneWeekAgo } },
    }),
    prisma.task.count({
      where: { assigneeId: userId, status: 'DONE', updatedAt: { gte: twoWeeksAgo, lt: oneWeekAgo } },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { assigneeId: userId },
      _count: true,
    }),
    prisma.task.count({
      where: { assigneeId: userId, status: 'DONE' },
    }),
  ]);

  // Daily completion counts for the last N days. Previously this fired
  // one task.count per day in a sequential loop — N round-trips per call
  // (QA finding #24). Replaced with a single bucket-by-day query that
  // returns at most `daysBack` rows and is filled into the calendar in JS.
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - (daysBack - 1));
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setHours(23, 59, 59, 999);

  const completedRows = await prisma.task.findMany({
    where: { assigneeId: userId, status: 'DONE', updatedAt: { gte: windowStart, lte: windowEnd } },
    select: { updatedAt: true },
  });
  const completedByDay = new Map<string, number>();
  for (const row of completedRows) {
    const key = toDateOnlyString(row.updatedAt);
    completedByDay.set(key, (completedByDay.get(key) || 0) + 1);
  }
  const dailyCompletionCounts: { date: string; count: number }[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const key = toDateOnlyString(dayStart);
    dailyCompletionCounts.push({ date: key, count: completedByDay.get(key) || 0 });
  }

  // 4-week rolling average
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const completedLast4Weeks = await prisma.task.count({
    where: { assigneeId: userId, status: 'DONE', updatedAt: { gte: fourWeeksAgo } },
  });
  const avgTasksPerWeek = Math.round((completedLast4Weeks / 4) * 10) / 10;

  // Streak
  const streak = await getMyStreak(userId);

  const statusMap: Record<string, number> = {};
  tasksByStatus.forEach((s) => { statusMap[s.status] = s._count; });

  // ─── Project breakdown: where did my energy go this period? ───
  // "Touched" = I'm the assignee AND the task was updated within the lookback
  // window. Maps cleanly to "what I worked on" without needing a status-history
  // join. Used by the Studio Portfolio "My time this week" donut.
  const touchedThisPeriod = await prisma.task.findMany({
    where: { assigneeId: userId, updatedAt: { gte: startDate } },
    select: { projectId: true, project: { select: { id: true, name: true } } },
  });
  const projectBreakdownMap = new Map<string, { projectId: string; projectName: string; tasks: number }>();
  for (const t of touchedThisPeriod) {
    const cur = projectBreakdownMap.get(t.projectId);
    if (cur) cur.tasks += 1;
    else projectBreakdownMap.set(t.projectId, { projectId: t.project.id, projectName: t.project.name, tasks: 1 });
  }
  const projectBreakdown = Array.from(projectBreakdownMap.values()).sort((a, b) => b.tasks - a.tasks);

  return {
    tasksCompletedThisWeek,
    tasksCompletedLastWeek,
    dailyCompletionCounts,
    tasksByStatus: statusMap,
    totalCompleted,
    avgTasksPerWeek,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    projectBreakdown,
  };
}

export async function getTeamDailyUpdates(date: string, projectId?: string) {
  // Parse YYYY-MM-DD as LOCAL midnight to match how submit stores dates
  // (`new Date(); setHours(0,0,0,0)` is local midnight). `new Date("YYYY-MM-DD")`
  // parses as UTC, which caused a 24h drift in non-UTC timezones — making
  // "today's standup" show empty for users in EDT/IST/etc.
  const [y, m, d] = date.split('-').map(Number);
  const targetDate = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);

  const where: any = { date: targetDate };
  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    where.userId = { in: members.map((m) => m.userId) };
  }

  return prisma.dailyUpdate.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, role: true } },
      tasks: { include: { task: { select: { id: true, title: true, project: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTodayStatus(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const update = await prisma.dailyUpdate.findUnique({
    where: { userId_date: { userId, date: today } },
    select: { id: true, createdAt: true },
  });
  return { submitted: !!update, submittedAt: update?.createdAt || null };
}
