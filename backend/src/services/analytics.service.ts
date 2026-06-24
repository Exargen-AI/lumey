import { TaskStatus, HealthStatus } from '@prisma/client';
import prisma from '../config/database';
import { toDateOnlyString } from '../utils/date';

export async function getPortfolioMetrics() {
  const [totalActiveTasks, blockedProjects, totalProjects] = await Promise.all([
    prisma.task.count({ where: { status: { not: TaskStatus.DONE } } }),
    prisma.project.count({ where: { healthStatus: HealthStatus.RED } }),
    prisma.project.count(),
  ]);

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [thisWeek, lastWeek] = await Promise.all([
    prisma.task.count({ where: { status: TaskStatus.DONE, updatedAt: { gte: oneWeekAgo } } }),
    prisma.task.count({ where: { status: TaskStatus.DONE, updatedAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
  ]);

  // Team utilization
  const engineers = await prisma.user.findMany({
    where: { role: { in: ['ENGINEER', 'PRODUCT_MANAGER'] }, isActive: true },
    select: {
      id: true,
      assignedTasks: { where: { status: { not: TaskStatus.DONE } }, select: { id: true } },
    },
  });

  const utilization = { overloaded: 0, balanced: 0, available: 0 };
  engineers.forEach((e) => {
    const count = e.assignedTasks.length;
    if (count > 10) utilization.overloaded++;
    else if (count >= 3) utilization.balanced++;
    else utilization.available++;
  });

  return {
    totalActiveTasks,
    tasksCompletedThisWeek: thisWeek,
    tasksCompletedLastWeek: lastWeek,
    blockedProjects,
    totalProjects,
    teamUtilization: utilization,
  };
}

export async function getHealthOverview() {
  const counts = await prisma.project.groupBy({ by: ['healthStatus'], _count: true });
  return {
    GREEN: counts.find((c) => c.healthStatus === 'GREEN')?._count || 0,
    YELLOW: counts.find((c) => c.healthStatus === 'YELLOW')?._count || 0,
    RED: counts.find((c) => c.healthStatus === 'RED')?._count || 0,
  };
}

export async function getPhaseDistribution() {
  const counts = await prisma.project.groupBy({ by: ['phase'], _count: true });
  return counts.map((c) => ({ phase: c.phase, count: c._count }));
}

export async function getTeamUtilization() {
  // 2026-05-22 Pankaj bug: the previous role filter was
  // `['ENGINEER', 'PRODUCT_MANAGER']` only — which EXCLUDED admins
  // who also do task work (e.g. Pankaj as SUPER_ADMIN, Preetham as
  // SUPER_ADMIN). The team-utilization board is meant to surface
  // everyone who has active task workload, regardless of platform
  // role. The right filter is "every HUMAN user who isn't a client"
  // — clients don't pick up internal tasks, agents have their own
  // dashboards, and CLIENT is the only role that shouldn't show on
  // the team board.
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['ENGINEER', 'PRODUCT_MANAGER', 'ADMIN', 'SUPER_ADMIN'] },
      isActive: true,
      userType: 'HUMAN',
    },
    select: {
      id: true, name: true, role: true,
      assignedTasks: {
        where: { status: { not: TaskStatus.DONE } },
        select: { projectId: true, project: { select: { id: true, name: true } } },
      },
    },
  });

  return users.map((user) => {
    const projectMap = new Map<string, { projectId: string; projectName: string; taskCount: number }>();
    user.assignedTasks.forEach((task) => {
      const existing = projectMap.get(task.projectId);
      if (existing) {
        existing.taskCount++;
      } else {
        projectMap.set(task.projectId, {
          projectId: task.project.id,
          projectName: task.project.name,
          taskCount: 1,
        });
      }
    });

    return {
      userId: user.id,
      userName: user.name,
      // Include role so the FE can group / badge appropriately
      // (admins-also-doing-work look different from pure engineers).
      role: user.role,
      projects: Array.from(projectMap.values()),
      totalTasks: user.assignedTasks.length,
    };
  });
}

export async function getBlockerAging() {
  const blockedTasks = await prisma.task.findMany({
    where: { isBlocked: true },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'asc' },
  });

  return blockedTasks.map((task) => ({
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.project.name,
    blockerNote: task.blockerNote,
    blockedSince: task.updatedAt.toISOString(),
    daysBlocked: Math.floor((Date.now() - task.updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
  }));
}

export async function getVelocityData(weeks: number = 8) {
  const now = new Date();

  // Pre-fetch every project once instead of looking up the name for each
  // (week × project) pair. Was N+1 (8 weeks × ~10 projects = ~80 lookups);
  // now it's 1 fetch + 8 groupBys.
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  // Was N+1 by week — `weeks` sequential groupBys (QA finding #25). Fan
  // them out concurrently instead; total wall time becomes the slowest
  // single query rather than the sum.
  const weekRanges: Array<{ start: Date; end: Date }> = [];
  for (let i = 0; i < weeks; i++) {
    const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    weekRanges.push({ start: weekStart, end: weekEnd });
  }

  const groupResults = await Promise.all(weekRanges.map((r) =>
    prisma.task.groupBy({
      by: ['projectId'],
      where: { status: TaskStatus.DONE, updatedAt: { gte: r.start, lt: r.end } },
      _count: true,
    }),
  ));

  const data: Array<{ week: string; projectId: string; projectName: string; completed: number }> = [];
  for (let i = 0; i < weekRanges.length; i++) {
    const weekStart = weekRanges[i].start;
    for (const t of groupResults[i]) {
      data.push({
        week: toDateOnlyString(weekStart),
        projectId: t.projectId,
        projectName: projectNameById.get(t.projectId) || 'Unknown',
        completed: t._count,
      });
    }
  }

  return data;
}

export async function getProjectAnalytics(projectId: string) {
  const statusCounts = await prisma.task.groupBy({
    by: ['status'],
    where: { projectId },
    _count: true,
  });

  const tasksByStatus: Record<string, number> = {};
  statusCounts.forEach((s) => { tasksByStatus[s.status] = s._count; });

  const overdueTasks = await prisma.task.count({
    where: { projectId, dueDate: { lt: new Date() }, status: { not: TaskStatus.DONE } },
  });

  return { tasksByStatus, overdueTasks };
}

export async function getPMDashboard() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const [
    totalProjects, blockedTasks, healthCounts,
    activeEngineers, todayUpdates
  ] = await Promise.all([
    prisma.project.count(),
    prisma.task.findMany({
      where: { isBlocked: true },
      include: { project: { select: { name: true } }, assignee: { select: { name: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    }),
    prisma.project.groupBy({ by: ['healthStatus'], _count: true }),
    prisma.user.findMany({
      where: { role: { in: ['ENGINEER', 'PRODUCT_MANAGER'] }, isActive: true },
      select: { id: true, name: true, role: true },
    }),
    prisma.dailyUpdate.findMany({
      where: { date: today },
      select: { userId: true },
    }),
  ]);

  // Who submitted EOD today vs who hasn't
  const submittedIds = new Set(todayUpdates.map((u) => u.userId));
  const missingEOD = activeEngineers.filter((e) => !submittedIds.has(e.id));
  const submittedEOD = activeEngineers.filter((e) => submittedIds.has(e.id));

  // Health summary
  const health = {
    GREEN: healthCounts.find((c) => c.healthStatus === 'GREEN')?._count || 0,
    YELLOW: healthCounts.find((c) => c.healthStatus === 'YELLOW')?._count || 0,
    RED: healthCounts.find((c) => c.healthStatus === 'RED')?._count || 0,
  };

  // Projects at risk (YELLOW or RED)
  const atRiskProjects = await prisma.project.findMany({
    where: { healthStatus: { in: ['YELLOW', 'RED'] } },
    select: { id: true, name: true, healthStatus: true, phase: true },
  });

  // Overdue tasks count
  const overdueTasks = await prisma.task.count({
    where: { dueDate: { lt: now }, status: { not: 'DONE' } },
  });

  return {
    totalProjects,
    health,
    atRiskProjects,
    blockedTasks: blockedTasks.map((t) => ({
      id: t.id, title: t.title, projectName: t.project.name,
      assigneeName: t.assignee?.name, blockerNote: t.blockerNote,
      daysBlocked: Math.floor((Date.now() - t.updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
    })),
    overdueTasks,
    eodStatus: {
      total: activeEngineers.length,
      submitted: submittedEOD.length,
      missing: missingEOD.map((e) => ({ id: e.id, name: e.name, role: e.role })),
    },
  };
}

export async function getTaskDistribution() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [byType, byPriority, byPhase, completionRaw] = await Promise.all([
    // Task type distribution (active tasks only)
    prisma.task.groupBy({
      by: ['taskType'],
      where: { status: { not: TaskStatus.DONE } },
      _count: true,
    }),
    // Priority distribution (active tasks only)
    prisma.task.groupBy({
      by: ['priority'],
      where: { status: { not: TaskStatus.DONE } },
      _count: true,
    }),
    // Project phase pipeline
    prisma.project.groupBy({
      by: ['phase'],
      _count: true,
    }),
    // Completion trend (last 30 days) — tasks that moved to DONE
    prisma.task.findMany({
      where: { status: TaskStatus.DONE, updatedAt: { gte: thirtyDaysAgo } },
      select: { updatedAt: true },
    }),
  ]);

  // Build type map
  const typeMap: Record<string, number> = { FEATURE: 0, BUG: 0, CHORE: 0, SPIKE: 0 };
  byType.forEach((t) => { typeMap[t.taskType] = t._count; });

  // Build priority map
  const priorityMap: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  byPriority.forEach((p) => { priorityMap[p.priority] = p._count; });

  // Build phase pipeline
  const phaseOrder = ['IDEA', 'ARCHITECTURE', 'DEVELOPMENT', 'TESTING', 'LIVE', 'MAINTENANCE'];
  const phasePipeline = phaseOrder.map((phase) => ({
    phase,
    count: byPhase.find((p) => p.phase === phase)?._count || 0,
  }));

  // Build completion trend (group by day)
  const trendMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    trendMap.set(toDateOnlyString(d), 0);
  }
  completionRaw.forEach((task) => {
    const dateKey = toDateOnlyString(task.updatedAt);
    if (trendMap.has(dateKey)) {
      trendMap.set(dateKey, (trendMap.get(dateKey) || 0) + 1);
    }
  });
  const completionTrend = Array.from(trendMap.entries()).map(([date, count]) => ({ date, count }));

  return { byType: typeMap, byPriority: priorityMap, phasePipeline, completionTrend };
}

export async function getResourceAllocation() {
  const users = await prisma.user.findMany({
    where: { role: { in: ['ENGINEER', 'PRODUCT_MANAGER'] }, isActive: true },
    select: {
      id: true, name: true, role: true,
      assignedTasks: {
        where: { status: { not: TaskStatus.DONE } },
        select: { id: true, projectId: true, status: true, priority: true, project: { select: { id: true, name: true } } },
      },
      projectMemberships: {
        select: { project: { select: { id: true, name: true } } },
      },
    },
  });

  // Get hours logged this week for each user
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 7);

  const weekEntries = await prisma.timeEntry.findMany({
    where: { date: { gte: monday, lt: sunday } },
    select: { userId: true, projectId: true, hours: true },
  });

  // Build hours map: userId -> projectId -> hours
  const hoursMap = new Map<string, Map<string, number>>();
  weekEntries.forEach((e) => {
    if (!hoursMap.has(e.userId)) hoursMap.set(e.userId, new Map());
    const userMap = hoursMap.get(e.userId)!;
    userMap.set(e.projectId, (userMap.get(e.projectId) || 0) + e.hours);
  });

  // Collect all projects
  const allProjects = new Map<string, string>();
  users.forEach((u) => {
    u.projectMemberships.forEach((m) => allProjects.set(m.project.id, m.project.name));
    u.assignedTasks.forEach((t) => allProjects.set(t.project.id, t.project.name));
  });

  return {
    users: users.map((u) => {
      const userHours = hoursMap.get(u.id) || new Map();
      const totalHoursThisWeek = Array.from(userHours.values()).reduce((sum, h) => sum + h, 0);
      const totalTasks = u.assignedTasks.length;

      // Per-project breakdown
      const projectAllocation = Array.from(allProjects.entries())
        .filter(([pid]) => u.assignedTasks.some((t) => t.projectId === pid) || u.projectMemberships.some((m) => m.project.id === pid))
        .map(([pid, pname]) => ({
          projectId: pid,
          projectName: pname,
          tasks: u.assignedTasks.filter((t) => t.projectId === pid).length,
          hoursThisWeek: userHours.get(pid) || 0,
        }));

      return {
        userId: u.id,
        userName: u.name,
        role: u.role,
        totalTasks,
        totalHoursThisWeek,
        capacityPct: Math.round((totalHoursThisWeek / 40) * 100),
        projects: projectAllocation,
      };
    }),
    projects: Array.from(allProjects.entries()).map(([id, name]) => ({ id, name })),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Studio Portfolio Home — the four-band landing page.
   These functions back the four bands on /dashboard:
     1. getProductHealthGrid    — band 1 (per-product card grid)
     2. getActiveSprintStream   — band 2 (cross-product live work)
     3. getCapacitySnapshot     — band 3 (current sprint commit/done per product)
     4. getAttentionItems       — band 4 (auto-generated alerts to triage)
   ───────────────────────────────────────────────────────────────────────────── */

export async function getProductHealthGrid() {
  const now = new Date();
  const weeks = 8;

  // One trip for projects + their PM lead + active sprint task counts.
  const projects = await prisma.project.findMany({
    include: {
      members: {
        where: { role: 'PRODUCT_MANAGER' },
        include: { user: { select: { id: true, name: true } } },
        take: 1,
      },
      sprints: {
        where: { status: 'ACTIVE' },
        orderBy: { number: 'desc' },
        take: 1,
        include: {
          _count: { select: { tasks: true } },
          tasks: { select: { status: true, storyPoints: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Blocked count per project (1 query, grouped).
  const blockedGroups = await prisma.task.groupBy({
    by: ['projectId'],
    where: { isBlocked: true, status: { not: TaskStatus.DONE } },
    _count: true,
  });
  const blockedByProject = new Map(blockedGroups.map((g) => [g.projectId, g._count]));

  // Velocity sparkline — last 8 weeks of done-task counts per project.
  // 8 groupBy queries (one per week) but batched in parallel.
  const weekRanges: Array<{ start: Date; end: Date }> = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    weekRanges.push({ start, end });
  }
  const weeklyGroups = await Promise.all(
    weekRanges.map(({ start, end }) =>
      prisma.task.groupBy({
        by: ['projectId'],
        where: { status: TaskStatus.DONE, updatedAt: { gte: start, lt: end } },
        _count: true,
      })
    )
  );
  // Index: projectId -> array of 8 weekly counts (oldest first)
  const velocityByProject = new Map<string, number[]>();
  for (const p of projects) velocityByProject.set(p.id, new Array(weeks).fill(0));
  weeklyGroups.forEach((groups, weekIdx) => {
    for (const g of groups) {
      const arr = velocityByProject.get(g.projectId);
      if (arr) arr[weekIdx] = g._count;
    }
  });

  return projects.map((p) => {
    const sprint = p.sprints[0] ?? null;
    const sprintTasks = sprint?.tasks ?? [];
    const tasksTotal = sprintTasks.length;
    const tasksDone = sprintTasks.filter((t) => t.status === TaskStatus.DONE).length;
    const tasksInProgress = sprintTasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const pointsTotal = sprintTasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const pointsDone = sprintTasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const lead = p.members[0]?.user ?? null;

    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      category: p.category,
      phase: p.phase,
      healthStatus: p.healthStatus,
      lead,
      currentSprint: sprint
        ? {
            id: sprint.id,
            name: sprint.name,
            number: sprint.number,
            goal: sprint.goal,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            tasksTotal,
            tasksDone,
            tasksInProgress,
            pointsTotal,
            pointsDone,
          }
        : null,
      blockedCount: blockedByProject.get(p.id) ?? 0,
      velocity: velocityByProject.get(p.id) ?? new Array(weeks).fill(0),
    };
  });
}

export async function getActiveSprintStream() {
  const tasks = await prisma.task.findMany({
    where: {
      sprint: { status: 'ACTIVE' },
      status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW] },
    },
    include: {
      project: { select: { id: true, name: true, slug: true, category: true } },
      sprint: { select: { id: true, name: true, goal: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    take: 200,
  });

  return tasks.map((t) => ({
    id: t.id,
    taskNumber: t.taskNumber,
    title: t.title,
    status: t.status,
    priority: t.priority,
    isBlocked: t.isBlocked,
    storyPoints: t.storyPoints,
    project: t.project,
    sprint: t.sprint,
    assignee: t.assignee,
  }));
}

export async function getCapacitySnapshot() {
  const activeSprints = await prisma.sprint.findMany({
    where: { status: 'ACTIVE' },
    include: {
      project: { select: { id: true, name: true, category: true } },
      tasks: { select: { status: true, storyPoints: true } },
    },
  });

  const perProject = activeSprints.map((s) => {
    const planned = s.tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
    const completed = s.tasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
    return {
      projectId: s.project.id,
      projectName: s.project.name,
      category: s.project.category,
      sprintName: s.name,
      plannedPoints: planned,
      completedPoints: completed,
    };
  });

  const totalPlanned = perProject.reduce((s, p) => s + p.plannedPoints, 0);
  const totalCompleted = perProject.reduce((s, p) => s + p.completedPoints, 0);

  return { perProject, totalPlanned, totalCompleted };
}

export async function getAttentionItems() {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  // "Last workday" — the most recent Mon-Fri before today. On Monday this is
  // Friday; on Tue–Fri it's yesterday. This matches the user's mental model
  // of "did the team submit their last day's EOD?" without nagging on Mon
  // morning about Sunday's missing entry.
  const lastWorkday = new Date(now);
  lastWorkday.setHours(0, 0, 0, 0);
  do {
    lastWorkday.setDate(lastWorkday.getDate() - 1);
  } while (lastWorkday.getDay() === 0 || lastWorkday.getDay() === 6);
  const yesterday = lastWorkday;

  // Bugs reported in the last 24h with no assignee — these are the "got
  // routed?" decisions for the morning triage ritual.
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    blockedAging,
    unassignedInActive,
    activeEngineers,
    yesterdayEODs,
    recentBugs,
    epiclessInActive,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { isBlocked: true, status: { not: TaskStatus.DONE }, updatedAt: { lt: threeDaysAgo } },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        sprint: { status: 'ACTIVE' },
        assigneeId: null,
        status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW] },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        sprint: { select: { id: true, name: true } },
      },
      take: 10,
    }),
    prisma.user.findMany({
      where: { role: { in: ['ENGINEER', 'PRODUCT_MANAGER'] }, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.dailyUpdate.findMany({
      where: { date: yesterday },
      select: { userId: true },
    }),
    prisma.task.findMany({
      where: {
        taskType: 'BUG',
        assigneeId: null,
        createdAt: { gte: oneDayAgo },
        status: { not: TaskStatus.DONE },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        sprint: { status: 'ACTIVE' },
        epicId: null,
        status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW] },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
        sprint: { select: { id: true, name: true } },
      },
      take: 10,
    }),
  ]);

  // `lastWorkday` was already constrained to Mon-Fri above, so we can always
  // surface the missing-EOD alerts.
  const submittedIds = new Set(yesterdayEODs.map((u) => u.userId));
  const missingEOD = activeEngineers.filter((e) => !submittedIds.has(e.id));

  type Severity = 'high' | 'medium' | 'low';
  type AttentionItem = {
    id: string;
    kind: 'BLOCKED_AGING' | 'UNASSIGNED_IN_SPRINT' | 'MISSING_EOD' | 'RECENT_BUG' | 'EPIC_LESS_IN_SPRINT';
    severity: Severity;
    message: string;
    context: Record<string, unknown>;
    action: { label: string; href?: string };
  };
  const items: AttentionItem[] = [];

  for (const t of blockedAging) {
    const days = Math.floor((Date.now() - t.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
    items.push({
      id: `blocked-${t.id}`,
      kind: 'BLOCKED_AGING',
      severity: days > 5 ? 'high' : 'medium',
      message: `${t.project.name} · ${t.title} blocked ${days}d`,
      context: {
        projectId: t.project.id, taskId: t.id, days,
        assignee: t.assignee?.name ?? null, blockerNote: t.blockerNote,
      },
      action: { label: 'Unblock', href: `/projects/${t.project.id}` },
    });
  }
  for (const t of unassignedInActive) {
    items.push({
      id: `unassigned-${t.id}`,
      kind: 'UNASSIGNED_IN_SPRINT',
      severity: 'medium',
      message: `${t.project.name} · ${t.title} unassigned in ${t.sprint?.name ?? 'active sprint'}`,
      context: { projectId: t.project.id, taskId: t.id, sprintName: t.sprint?.name },
      action: { label: 'Assign', href: `/projects/${t.project.id}` },
    });
  }
  // Day label for the "missing EOD" message — "yesterday's" reads cleanly on
  // Tue–Fri; on Monday say "Friday's" for clarity.
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isYesterday = (now.getDate() - lastWorkday.getDate() + 7) % 7 === 1;
  const dayLabel = isYesterday ? "yesterday's" : `${dayNames[lastWorkday.getDay()]}'s`;
  for (const u of missingEOD.slice(0, 5)) {
    items.push({
      id: `eod-${u.id}`,
      kind: 'MISSING_EOD',
      severity: 'low',
      message: `${u.name.split(' ')[0]} hasn't submitted ${dayLabel} EOD`,
      context: { userId: u.id, userName: u.name },
      action: { label: 'Nudge' },
    });
  }
  for (const t of recentBugs) {
    items.push({
      id: `bug-${t.id}`,
      kind: 'RECENT_BUG',
      severity: 'high',
      message: `${t.project.name} · ${t.title} (new bug, unassigned)`,
      context: {
        projectId: t.project.id, taskId: t.id, taskNumber: t.taskNumber,
        reportedBy: t.creator?.name ?? null,
        priority: t.priority,
      },
      action: { label: 'Triage', href: `/projects/${t.project.id}/tasks/${t.id}` },
    });
  }
  for (const t of epiclessInActive) {
    items.push({
      id: `epicless-${t.id}`,
      kind: 'EPIC_LESS_IN_SPRINT',
      severity: 'low',
      message: `${t.project.name} · ${t.title} has no epic in ${t.sprint?.name ?? 'active sprint'}`,
      context: {
        projectId: t.project.id, taskId: t.id, taskNumber: t.taskNumber,
        sprintName: t.sprint?.name,
      },
      action: { label: 'Set epic', href: `/projects/${t.project.id}/tasks/${t.id}` },
    });
  }

  const sevOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  return items;
}
