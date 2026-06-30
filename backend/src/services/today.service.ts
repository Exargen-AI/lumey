import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { checkPermission, canViewProjectInternal } from './rbac.service';

/**
 * Activity feed — the combined "what's happening?" surface.
 *
 * Returns two sections in one round-trip:
 *
 *   1. **Today** — every task that transitioned INTO `DONE` during the
 *      given day, grouped by project, with the comment(s) the engineer
 *      left on that task that same day surfaced inline.
 *   2. **This week** — two sub-sections:
 *      - `inFocus`: tasks currently in IN_PROGRESS or IN_REVIEW. The
 *        team's working set right now. Sorted by most-recent status
 *        change so things that just started bubble up.
 *      - `shippedGroups`: tasks that closed in the last 7 days
 *        EXCLUDING the today window (de-duplicated with section 1).
 *        Same shape as the today groups so the FE can reuse the
 *        renderer.
 *
 * Day window interpretation:
 *   - The client sends YYYY-MM-DD + `tzOffsetMinutes` (JS
 *     `getTimezoneOffset` convention — minutes WEST of UTC).
 *   - We compute UTC bounds [startUtc, endUtc) covering the client's
 *     local day. Same logic powers the week window (just expanded
 *     to 7 days back).
 *
 * Role scoping (applied consistently to every section):
 *   - `project.view_all` (super admin) → see every project
 *   - `task.view_internal` (admin / PM / engineer) → see every project
 *      they're a member of
 *   - otherwise (client) → only their projects + only client-visible
 *      tasks
 *
 * Optional filters:
 *   - `mine=true` — only tasks the caller themselves moved into DONE
 *     (used by the engineer "just my work" view). Doesn't apply to
 *     `inFocus` — that's always the team's set.
 *   - `projectId=<uuid>` — scope to a single project (the client
 *     portal passes this).
 */

export interface ActivityFeedComment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string } | null;
}

export interface ActivityFeedTask {
  id: string;
  title: string;
  taskNumber: number;
  taskType: string;
  priority: string;
  storyPoints: number | null;
  project: { id: string; name: string; slug: string };
  /** When the task hit DONE (for shipped sections) OR last status change (for inFocus). */
  timestamp: string;
  /** Current status — relevant for inFocus where the section mixes IN_PROGRESS + IN_REVIEW. */
  status: string;
  /** Who moved it. Null when the changing user is no longer in the system. */
  actor: { id: string; name: string; role: string } | null;
  comments: ActivityFeedComment[];
}

export interface ActivityFeedGroup {
  project: { id: string; name: string; slug: string };
  tasks: ActivityFeedTask[];
}

/** A single row from the activity log, hydrated for FE rendering.
 *  Covers every mutation the platform records (created_task, moved_task,
 *  created_comment, review_requested, …). The FE renders these in a
 *  chronological feed; `action` drives the icon + label, `task`/`details`
 *  carry the context. */
export interface ActivityEvent {
  id: string;
  /** Action string from the Activity table — e.g. 'moved_task',
   *  'created_comment', 'review_approved'. Maps 1:1 to ACTION_CONFIG on
   *  the FE. */
  action: string;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
  /** Immutable audit attribution: who acted, captured when the action happened. */
  actorType: 'HUMAN' | 'AGENT';
  project: { id: string; name: string; slug: string } | null;
  /** For task-targeted events, the resolved task. Null when the target
   *  isn't a task (or the task is no longer visible to this user). */
  task: { id: string; title: string; taskNumber: number } | null;
  /** Raw details payload (often includes `title`, `from`/`to` status,
   *  etc.). FE reads action-specific fields; unknown ones are ignored. */
  details: Record<string, unknown> | null;
}

export interface ActivityFeedResponse {
  date: string;
  today: {
    /** Highlight: tasks that closed today (existing DONE-with-comments
     *  list). Surfaces as a callout strip at the top of the Today
     *  section — the moment-of-celebration. */
    doneTasks: ActivityFeedGroup[];
    /** Full activity log for the day — every comment, status change,
     *  blocker, review request, sign-off, etc. Chronological, newest
     *  first. */
    events: ActivityEvent[];
  };
  thisWeek: {
    /** Date range covered (inclusive start, exclusive end). */
    startDate: string;
    endDate: string;
    /** Tasks currently IN_PROGRESS or IN_REVIEW, scoped to visibility. */
    inFocus: ActivityFeedTask[];
    /** Tasks that landed in DONE during the week, EXCLUDING today (de-duped with `today.doneTasks`). */
    shippedGroups: ActivityFeedGroup[];
  };
}

/** Caller-options shared by the public entry points. */
export interface ActivityFeedOptions {
  date?: string;
  tzOffsetMinutes?: number;
  mine?: boolean;
  projectId?: string;
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

interface VisibilityScope {
  canViewAll: boolean;
  canViewInternal: boolean;
  /** Permission to see decisions. CLIENT lacks `decision.view`; if we
   *  don't gate decision-targeted activity events on this, the
   *  `created_decision` row's `details.title` leaks to clients in the
   *  project (same shape as the milestone leak fixed earlier — see the
   *  per-event hydration comments below). */
  canViewDecisions: boolean;
  /** Null when canViewAll === true (no scoping needed). */
  allowedProjectIds: string[] | null;
}

async function computeVisibility(
  userId: string,
  userRole: UserRole,
  projectId?: string,
): Promise<VisibilityScope> {
  // 2026-06-02: per-project visibility. When the feed is scoped to a single
  // project (the client portal's Activity page always passes `projectId`),
  // a CLIENT granted full access on THAT project — or any staff role —
  // sees its internal tasks + decisions via `canViewProjectInternal`. For
  // the cross-project (internal-team) feed with no `projectId`, fall back
  // to the role-level grant, so a base/per-project CLIENT never gets a
  // blanket internal feed across projects.
  const canViewAll = await checkPermission(userRole, 'project.view_all');
  let canViewInternal: boolean;
  let canViewDecisions: boolean;
  if (projectId) {
    const full = await canViewProjectInternal({ id: userId, role: userRole }, projectId);
    canViewInternal = full;
    canViewDecisions = full;
  } else {
    [canViewInternal, canViewDecisions] = await Promise.all([
      checkPermission(userRole, 'task.view_internal'),
      checkPermission(userRole, 'decision.view'),
    ]);
  }
  if (canViewAll) {
    return { canViewAll, canViewInternal, canViewDecisions, allowedProjectIds: null };
  }
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return {
    canViewAll,
    canViewInternal,
    canViewDecisions,
    allowedProjectIds: memberships.map((m) => m.projectId),
  };
}

/** Expand a YYYY-MM-DD + tz offset into a UTC window covering the local day. */
function localDayWindow(dateStr: string, tzOffsetMinutes: number): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(Date.parse(dateStr + 'T00:00:00Z') + tzOffsetMinutes * 60_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3_600_000);
  return { startUtc, endUtc };
}

/**
 * Build a `task` where-clause from the visibility scope. Returns null if
 * the scope is fully blocked (user belongs to no projects + isn't a
 * super admin). The caller short-circuits to empty results in that case.
 */
function visibilityTaskWhere(
  scope: VisibilityScope,
  opts: { projectId?: string },
): { taskWhere: Record<string, any> } | null {
  const taskWhere: Record<string, any> = {};
  if (opts.projectId) {
    taskWhere.projectId = opts.projectId;
  } else if (scope.allowedProjectIds) {
    if (scope.allowedProjectIds.length === 0) return null;
    taskWhere.projectId = { in: scope.allowedProjectIds };
  }
  if (!scope.canViewInternal) {
    taskWhere.clientVisible = true;
  }
  return { taskWhere };
}

/** Hydrate raw transition rows into the FE-facing task shape + comment list. */
async function hydrateTransitions(
  transitions: Array<{
    taskId: string;
    changedAt: Date;
    user: { id: string; name: string; role: string; userType?: string | null } | null;
    task: any;
  }>,
  commentWindow: { gte: Date; lt: Date },
  // 2026-06-01 — when false, drop feed entries whose actor is an AI
  // agent and strip agent-authored comments, so agent work never
  // surfaces to an unauthorised viewer.
  canSeeAgents: boolean = true,
): Promise<ActivityFeedTask[]> {
  if (transitions.length === 0) return [];

  // De-dup by taskId — a task can bounce in/out of DONE within the same
  // window; keep the most recent transition row.
  const byTask = new Map<string, (typeof transitions)[number]>();
  for (const row of transitions) {
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, row);
  }
  let unique = [...byTask.values()];
  // Drop transitions performed BY an agent (and on agent-assigned
  // tasks) for unauthorised viewers.
  if (!canSeeAgents) {
    unique = unique.filter(
      (row) =>
        row.user?.userType !== 'AGENT' &&
        row.task?.assignee?.userType !== 'AGENT',
    );
  }

  const taskIds = unique.map((r) => r.taskId);
  const comments = await prisma.comment.findMany({
    where: {
      taskId: { in: taskIds },
      createdAt: { gte: commentWindow.gte, lt: commentWindow.lt },
    },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, role: true, userType: true } } },
  });

  const commentsByTask = new Map<string, typeof comments>();
  for (const c of comments) {
    if (!c.taskId) continue;
    const arr = commentsByTask.get(c.taskId) ?? [];
    arr.push(c);
    commentsByTask.set(c.taskId, arr);
  }

  return unique.map((row) => ({
    id: row.task.id,
    title: row.task.title,
    taskNumber: row.task.taskNumber,
    taskType: row.task.taskType,
    priority: row.task.priority,
    storyPoints: row.task.storyPoints,
    project: row.task.project,
    timestamp: row.changedAt.toISOString(),
    status: row.task.status,
    actor: row.user,
    comments: (commentsByTask.get(row.taskId) ?? [])
      // Strip agent-authored comments for unauthorised viewers.
      .filter((c) => canSeeAgents || (c.author as any)?.userType !== 'AGENT')
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        author: c.author,
      })),
  }));
}

/** Group a flat task list by project, sorted by descending story-point total. */
function groupByProject(tasks: ActivityFeedTask[]): ActivityFeedGroup[] {
  const map = new Map<string, ActivityFeedGroup>();
  for (const t of tasks) {
    const pid = t.project.id;
    if (!map.has(pid)) map.set(pid, { project: t.project, tasks: [] });
    map.get(pid)!.tasks.push(t);
  }
  const groups = [...map.values()];
  groups.sort((a, b) => {
    const aPts = a.tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const bPts = b.tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    if (aPts !== bPts) return bPts - aPts;
    if (a.tasks.length !== b.tasks.length) return b.tasks.length - a.tasks.length;
    return a.project.name.localeCompare(b.project.name);
  });
  // Within each group, sort tasks by recency (newest first).
  for (const g of groups) {
    g.tasks.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  return groups;
}

/* ────────────────────────────────────────────────────────────────────
   Public entry points
   ──────────────────────────────────────────────────────────────────── */

/**
 * Combined Today + This-Week activity payload.
 * Single round-trip for the FE; the renderer splits the two sections.
 */
export async function getActivityFeed(
  userId: string,
  userRole: UserRole,
  opts: ActivityFeedOptions = {},
  // 2026-06-01: agent-visibility allowlist flag. Default true so test
  // fixtures that don't pass it keep seeing every actor; the handler
  // passes the real per-user value.
  canViewAgents: boolean = true,
): Promise<ActivityFeedResponse> {
  const tz = Number.isFinite(opts.tzOffsetMinutes) ? Number(opts.tzOffsetMinutes) : 0;
  const dateStr = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
    ? opts.date
    : new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10);

  const { startUtc: todayStart, endUtc: todayEnd } = localDayWindow(dateStr, tz);
  // Week window = 6 prior local days + the focal day. We compute end as
  // todayEnd (so it captures today through to local midnight) and start
  // as todayStart - 6 days. Frontend renders today + earlier-this-week
  // as separate sections so the overlap is conceptual, not duplicated.
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 3_600_000);
  const weekEnd = todayEnd;

  const scope = await computeVisibility(userId, userRole, opts.projectId);
  const v = visibilityTaskWhere(scope, { projectId: opts.projectId });

  if (!v) {
    // No projects visible — return an empty but structurally complete payload
    // so the FE doesn't have to handle a separate null case.
    return {
      date: dateStr,
      today: { doneTasks: [], events: [] },
      thisWeek: {
        startDate: weekStart.toISOString().slice(0, 10),
        endDate: weekEnd.toISOString().slice(0, 10),
        inFocus: [],
        shippedGroups: [],
      },
    };
  }

  const taskInclude = {
    id: true,
    title: true,
    taskNumber: true,
    status: true,
    priority: true,
    taskType: true,
    storyPoints: true,
    clientVisible: true,
    project: { select: { id: true, name: true, slug: true } },
    // 2026-06-01 — assignee userType so the activity feed can drop
    // entries for agent-assigned tasks for unauthorised viewers.
    assignee: { select: { userType: true } },
  } as const;

  // Activity-log query for today's events. We scope by projectId IN
  // allowedProjectIds (or no scope if super-admin) AND by createdAt
  // window. Visibility of task-related rows is enforced after fetch:
  // we resolve each task id and drop the event if the user can't see
  // the task. Cap at 200 — busy days don't need infinite scroll
  // (TODO: paginate if a single team trips this regularly).
  const activityWhere: Record<string, any> = {
    createdAt: { gte: todayStart, lt: todayEnd },
  };
  if (opts.projectId) {
    activityWhere.projectId = opts.projectId;
  } else if (scope.allowedProjectIds) {
    // null projectId (org-level events like 'logged_in', 'reset_password')
    // belong to no project — exclude from scoped views. Super-admin sees
    // them because allowedProjectIds is null there.
    activityWhere.projectId = { in: scope.allowedProjectIds };
  }
  if (opts.mine) {
    activityWhere.userId = userId;
  }

  // Fire today + week-shipped + in-focus + activity queries in parallel
  // — none depend on the others.
  const [todayTransitions, weekTransitions, inFocusTasks, rawActivities] = await Promise.all([
    prisma.taskStatusHistory.findMany({
      where: {
        toStatus: 'DONE',
        changedAt: { gte: todayStart, lt: todayEnd },
        ...(opts.mine && { changedBy: userId }),
        task: v.taskWhere,
      },
      orderBy: { changedAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true, role: true, userType: true } },
        task: { select: taskInclude },
      },
    }),
    prisma.taskStatusHistory.findMany({
      where: {
        toStatus: 'DONE',
        // Week MINUS today — today section already covers the focal day.
        changedAt: { gte: weekStart, lt: todayStart },
        ...(opts.mine && { changedBy: userId }),
        task: v.taskWhere,
      },
      orderBy: { changedAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true, role: true, userType: true } },
        task: { select: taskInclude },
      },
    }),
    // In-focus = tasks currently active. Status filter at the task level;
    // we read the task's `updatedAt` as the "last touched" timestamp
    // (cheap proxy; the dedicated TaskStatusHistory join would be more
    // precise but adds a query for marginal benefit on this surface).
    prisma.task.findMany({
      where: {
        ...v.taskWhere,
        status: { in: ['IN_PROGRESS', 'IN_REVIEW'] },
        ...(opts.mine && { OR: [{ assigneeId: userId }, { creatorId: userId }] }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: {
        ...taskInclude,
        updatedAt: true,
        assignee: { select: { id: true, name: true, role: true, userType: true } },
        reviewer: { select: { id: true, name: true, role: true, userType: true } },
      },
    }),
    prisma.activity.findMany({
      where: activityWhere,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true, role: true, userType: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    }),
  ]);

  // Hydrate today + this-week-shipped via shared helper.
  const todayTasks = await hydrateTransitions(todayTransitions, {
    gte: todayStart,
    lt: todayEnd,
  }, canViewAgents);
  const shippedTasks = await hydrateTransitions(weekTransitions, {
    gte: weekStart,
    lt: todayStart,
  }, canViewAgents);

  // Shape in-focus tasks to the same FE-facing structure as the shipped
  // tasks. We pick the assignee as the actor for IN_PROGRESS (they're
  // doing it) and the reviewer for IN_REVIEW (they own the next step).
  const inFocus: ActivityFeedTask[] = inFocusTasks
    // 2026-06-01 — drop agent-assigned in-focus tasks for unauthorised
    // viewers (the assignee/reviewer actor is the agent).
    .filter(
      (t) =>
        canViewAgents ||
        ((t.assignee as any)?.userType !== 'AGENT' &&
          (t.reviewer as any)?.userType !== 'AGENT'),
    )
    .map((t) => {
    const actor = t.status === 'IN_REVIEW'
      ? (t.reviewer ?? null)
      : (t.assignee ?? null);
    return {
      id: t.id,
      title: t.title,
      taskNumber: t.taskNumber,
      taskType: t.taskType,
      priority: t.priority,
      storyPoints: t.storyPoints,
      project: t.project,
      timestamp: t.updatedAt.toISOString(),
      status: t.status,
      actor: actor as ActivityFeedTask['actor'],
      comments: [], // no inline comments on the focus list — keeps it scannable
    };
  });

  // ─── Hydrate activity events ────────────────────────────────────
  //
  // Per-entity visibility gates. Every entity type that has its own
  // privacy model needs to be filtered here independently — the
  // `projectId` scoping at the query layer only proves the viewer
  // belongs to the project, not that they're allowed to see THIS
  // entity. Each row's `details.title` is forwarded verbatim to the
  // FE, so a missed filter = title leak.
  //
  // Coverage of entity types that emit activity rows:
  //
  //   • **task** — `clientVisible` column on the row. Filter by
  //     `clientVisible AND viewer.view_internal`. Existing logic.
  //
  //   • **milestone** — `clientVisible` column. Same shape as task.
  //     Added in the 2026-05-15 hardening pass (the bug found in PR
  //     #117 — admins could create internal milestones whose titles
  //     leaked to clients via `created_milestone` activity rows).
  //
  //   • **decision** — no `clientVisible` column; visibility is
  //     gated entirely by the `decision.view` permission. CLIENT
  //     role does NOT have this permission (see
  //     `shared/src/constants/roles.ts`), so without this filter the
  //     `created_decision`/`updated_decision`/`deleted_decision`
  //     activity rows' `details.title` leaked to CLIENT viewers in
  //     the project. Same-shape leak as milestone — found by the
  //     audit accompanying the milestone fix and closed in this PR
  //     (Phase 2.6b).
  //
  //   • **deliverable** — no `clientVisible`, no permission gate.
  //     Inherently client-facing by design (CLIENT has
  //     DELIVERABLE_SIGN_OFF, deliverable rows ARE the client
  //     sign-off workflow). Activity rows pass through; the audience
  //     of the event matches the audience of the entity. Audited
  //     2026-05-15 — no fix needed.
  //
  //   • **document** — no `clientVisible`. CLIENT has DOCUMENT_READ
  //     for all docs on projects they belong to. Same-audience as
  //     entity. Audited 2026-05-15 — no fix needed.
  //
  //   • **role** (RBAC `updated_rbac`) — `logActivity` does NOT set
  //     `projectId` (org-level event). The activity query filters
  //     by `projectId: { in: allowedProjectIds }`, which **excludes
  //     null projectIds**. So non-super-admins never see RBAC events
  //     even before any per-entity check — structurally safe.
  //
  //   • **project** (project-level events like
  //     `updated_project_health`) — same audience as entity.
  //     `projectId` scoping is sufficient.
  //
  // When adding a new entity that emits activity rows: audit it
  // against this list. If its visibility is anything stricter than
  // "everyone in the project", add a filter here.
  const taskTargetedActivityIds = rawActivities
    .filter((a) => a.targetType === 'task' && a.targetId)
    .map((a) => a.targetId as string);
  const milestoneTargetedActivityIds = rawActivities
    .filter((a) => a.targetType === 'milestone' && a.targetId)
    .map((a) => a.targetId as string);

  const taskInfoMap = new Map<string, { id: string; title: string; taskNumber: number; clientVisible: boolean }>();
  if (taskTargetedActivityIds.length > 0) {
    const taskRows = await prisma.task.findMany({
      where: { id: { in: taskTargetedActivityIds } },
      select: { id: true, title: true, taskNumber: true, clientVisible: true },
    });
    for (const t of taskRows) taskInfoMap.set(t.id, t);
  }

  /** Milestone id → clientVisible. Missing key = milestone deleted. */
  const milestoneVisibilityMap = new Map<string, boolean>();
  if (milestoneTargetedActivityIds.length > 0) {
    const milestoneRows = await prisma.milestone.findMany({
      where: { id: { in: milestoneTargetedActivityIds } },
      select: { id: true, clientVisible: true },
    });
    for (const m of milestoneRows) milestoneVisibilityMap.set(m.id, m.clientVisible);
  }

  const events: ActivityEvent[] = [];
  for (const a of rawActivities) {
    // 2026-06-01 — drop activity rows authored by an AI agent for
    // unauthorised viewers (no agent action surfaces in the feed).
    if (!canViewAgents && (a.user as any)?.userType === 'AGENT') continue;
    let taskHydrated: ActivityEvent['task'] = null;
    if (a.targetType === 'task' && a.targetId) {
      const t = taskInfoMap.get(a.targetId);
      // Drop the event if we couldn't resolve the task (deleted) or
      // the user can't see it (non-internal + private task).
      if (!t) continue;
      if (!scope.canViewInternal && !t.clientVisible) continue;
      taskHydrated = { id: t.id, title: t.title, taskNumber: t.taskNumber };
    }
    if (a.targetType === 'milestone' && a.targetId) {
      const isVisible = milestoneVisibilityMap.get(a.targetId);
      // `isVisible !== true` covers two cases that must both drop:
      //   - undefined: milestone has been deleted (defensive — without
      //     this, a deleted milestone's name still leaks through
      //     `details.title` on the original create/update event).
      //   - false: milestone is intentionally internal-only.
      // Admins (with view_internal) see both — they're auditing.
      if (!scope.canViewInternal && isVisible !== true) continue;
    }
    if (a.targetType === 'decision') {
      // Decisions have no `clientVisible` column — they're either
      // entirely visible to a role (admin/PM/engineer have
      // `decision.view`) or entirely hidden (CLIENT). Filter by
      // permission rather than by entity-level flag.
      if (!scope.canViewDecisions) continue;
    }
    events.push({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      actor: a.user,
      actorType: a.actorType,
      project: a.project,
      task: taskHydrated,
      details: (a.details as Record<string, unknown> | null) ?? null,
    });
  }

  return {
    date: dateStr,
    today: {
      doneTasks: groupByProject(todayTasks),
      events,
    },
    thisWeek: {
      startDate: weekStart.toISOString().slice(0, 10),
      endDate: weekEnd.toISOString().slice(0, 10),
      inFocus,
      shippedGroups: groupByProject(shippedTasks),
    },
  };
}

/**
 * @deprecated Use `getActivityFeed`. Kept as a thin shim so any external
 * consumers (or unmerged branches) don't break before we land this PR.
 * Returns ONLY the today section in the legacy `{ date, groups }` shape.
 */
export async function getDoneToday(
  userId: string,
  userRole: UserRole,
  opts: ActivityFeedOptions = {},
): Promise<{ date: string; groups: ActivityFeedGroup[] }> {
  const feed = await getActivityFeed(userId, userRole, opts);
  return { date: feed.date, groups: feed.today.doneTasks };
}
