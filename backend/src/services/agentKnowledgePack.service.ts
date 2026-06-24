import prisma from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';

// Slice 2 of the agent platform: a single endpoint that bundles every piece
// of project context an agent needs to act on a task. Designed so the runtime
// can fetch ONE response per task (instead of hitting 5 endpoints) and
// drop the bundle straight into the agent's prompt.
//
// Shape decisions:
//   - `project`: identity + status. Phase + healthStatus tell the agent
//     where the project is in its lifecycle.
//   - `recentActivity`: last 30 days, capped at 100 entries. Newest first.
//     Lets the agent see "what's been happening here lately" without
//     blowing the prompt budget.
//   - `currentSprintTasks`: tasks in the project's currently ACTIVE sprint
//     (status === 'ACTIVE'), if any. Tells the agent the team's current
//     focus. Empty if no active sprint.
//   - `decisions`: 20 most recent decisions, regardless of status. The
//     architectural-context payload — by far the most important field for
//     making the agent's choices match the team's prior thinking.
//   - `skills`: empty array in v1. The spec keeps skills filesystem-based;
//     the field exists so the response shape doesn't break when a future
//     slice moves skill loading into Command Center.
//
// Authorization: agent-only (userType === 'AGENT'), and the agent must be a
// `ProjectMember` of the project. Both checks happen here so the route
// layer stays minimal.

const RECENT_ACTIVITY_DAYS = 30;
const RECENT_ACTIVITY_LIMIT = 100;
const DECISIONS_LIMIT = 20;
// Project Documents — metadata-only listing. 50 doc metadata rows is
// ~8KB of prompt — small enough to surface every doc on a busy project
// without blowing the budget. If a project legitimately needs more, we'll
// switch to a paginated `cc docs list` from the agent side.
const DOCUMENTS_LIMIT = 50;

interface SkillMetadata {
  name: string;
  description: string;
}

export interface AgentKnowledgePack {
  project: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    clientDescription: string | null;
    category: string;
    phase: string;
    healthStatus: string;
    autoHealth: boolean;
    tags: string[];
    startDate: Date | null;
    targetDate: Date | null;
    members: Array<{
      userId: string;
      name: string;
      email: string;
      role: string;
      userType: string;
    }>;
    // GitHub integration info, denormalized for agent runtime convenience.
    // Null if the project hasn't been linked to a GitHub repo via the
    // existing /projects/:id/integrations/github admin flow.
    github: {
      repoOwner: string;
      repoName: string;
      sshUrl: string;     // git@github.com:owner/name.git
      httpsUrl: string;   // https://github.com/owner/name.git
    } | null;
  };
  skills: SkillMetadata[];
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    actor: { id: string; name: string };
    createdAt: Date;
    details: unknown;
  }>;
  currentSprint: {
    id: string;
    name: string;
    number: number;
    goal: string | null;
    startDate: Date;
    endDate: Date;
  } | null;
  currentSprintTasks: Array<{
    id: string;
    taskNumber: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    storyPoints: number | null;
    assignee: { id: string; name: string } | null;
    dueDate: Date | null;
    isBlocked: boolean;
    blockerNote: string | null;
    // 2026-05-23 Layer 2 enhancement: AC included so agents see the
    // Done definition without an extra fetch. Shape is `unknown` here
    // because acceptanceCriteria is `Json` on the Task model; runtime
    // consumers should treat it as `Array<{ text: string, done: boolean }>`.
    acceptanceCriteria: unknown;
  }>;
  myAssignedTasks: Array<{
    id: string;
    taskNumber: number;
    title: string;
    status: string;
    priority: string;
    sprintId: string | null;
    dueDate: Date | null;
    acceptanceCriteria: unknown;
    isBlocked: boolean;
    blockerNote: string | null;
  }>;
  decisions: Array<{
    id: string;
    title: string;
    rationale: string;
    alternatives: string | null;
    status: string;
    tags: string[];
    createdAt: Date;
  }>;
  /**
   * Project documents (S3-backed reference material). Metadata only.
   * Agent fetches body via:
   *   `cc docs fetch <project-slug> <docId>`
   * which under the hood calls
   *   `GET /agents/me/projects/<slug>/documents/<docId>/download`
   * and follows the returned presigned URL.
   */
  documents: Array<{
    id: string;
    title: string;
    description: string | null;
    category: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: Date;
  }>;
  // Quick stats so the agent doesn't have to re-derive them.
  stats: {
    totalTasks: number;
    tasksByStatus: Record<string, number>;
    activeMemberCount: number;
  };
}

export async function getKnowledgePackForAgent(
  userId: string,
  userType: 'HUMAN' | 'AGENT',
  projectSlug: string,
): Promise<AgentKnowledgePack> {
  // Layer 1 of auth: this endpoint is for agents. Humans have richer UI
  // surfaces for the same data and should not pay the bundling cost.
  if (userType !== 'AGENT') {
    throw new ForbiddenError('Knowledge pack is an agent-only endpoint');
  }

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true, userType: true, isActive: true },
          },
        },
      },
      // The GitHub integration record carries owner/repo. The agent-runtime
      // host poller needs this to know what repo to clone before spawning
      // the container; surfacing it here means the runtime hits one
      // endpoint per task instead of a separate admin-only endpoint.
      githubIntegration: {
        select: { repoOwner: true, repoName: true },
      },
    },
  });
  if (!project) throw new NotFoundError('Project');

  // Layer 2 of auth: agent must be a member of this project.
  const membership = project.members.find((m) => m.userId === userId);
  if (!membership) {
    throw new ForbiddenError('You are not a member of this project');
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

  // Parallelize the independent reads. Each one's bounded so the worst case
  // is small even on a busy project.
  const [activity, activeSprint, decisions, allTasks, myTasks, documents] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId: project.id, createdAt: { gte: cutoff } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_ACTIVITY_LIMIT,
    }),
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    }),
    prisma.decision.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: DECISIONS_LIMIT,
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId: project.id, assigneeId: userId, status: { not: 'DONE' } },
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      select: {
        id: true,
        taskNumber: true,
        title: true,
        status: true,
        priority: true,
        sprintId: true,
        dueDate: true,
        // 2026-05-23 Layer 2 enhancement: include AC so the agent's
        // "what should I do next" view shows the Done definition.
        acceptanceCriteria: true,
        isBlocked: true,
        blockerNote: true,
      },
    }),
    // Project Documents — metadata only. The agent uses `cc docs fetch
    // <project-slug> <doc-id>` to download the body when a doc looks
    // relevant. We deliberately don't include URLs here — they'd expire
    // before the agent got to them, and embedding fresh per-doc URLs in
    // every KP fetch would multiply API calls. Capped at DOCUMENTS_LIMIT
    // for prompt budget; if a project has more, the agent can paginate
    // via a future list endpoint.
    prisma.projectDocument.findMany({
      where: { projectId: project.id, status: 'READY' },
      orderBy: { uploadedAt: 'desc' },
      take: DOCUMENTS_LIMIT,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        uploadedAt: true,
      },
    }),
  ]);

  // Sprint tasks (only if there's an active sprint).
  //
  // 2026-05-23 Layer 2 enhancement: include `acceptanceCriteria` per task
  // so the agent knows "what does Done look like" without an extra fetch.
  // Pre-this-PR, agents had to GET /tasks/:id separately to read AC,
  // which doubled the request count per work cycle. AC is a small JSON
  // array per task — typical projects have 0-5 items per task, so the
  // prompt budget overhead is bounded.
  const currentSprintTasks = activeSprint
    ? await prisma.task.findMany({
        where: { sprintId: activeSprint.id },
        orderBy: [{ status: 'asc' }, { priority: 'asc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          taskNumber: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          storyPoints: true,
          dueDate: true,
          isBlocked: true,
          blockerNote: true,
          acceptanceCriteria: true,
          assignee: { select: { id: true, name: true } },
        },
      })
    : [];

  // Build status histogram (with zero defaults so consumer code doesn't have
  // to .?? everything).
  const tasksByStatus: Record<string, number> = {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  let totalTasks = 0;
  for (const row of allTasks) {
    tasksByStatus[row.status] = row._count._all;
    totalTasks += row._count._all;
  }

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      clientDescription: project.clientDescription,
      category: project.category,
      phase: project.phase,
      healthStatus: project.healthStatus,
      autoHealth: project.autoHealth,
      tags: project.tags,
      startDate: project.startDate,
      targetDate: project.targetDate,
      members: project.members
        .filter((m) => m.user.isActive)
        .map((m) => ({
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.user.role,
          userType: m.user.userType,
        })),
      github: project.githubIntegration
        ? {
            repoOwner: project.githubIntegration.repoOwner,
            repoName: project.githubIntegration.repoName,
            // Both forms surfaced so the runtime can pick whichever auth it has.
            sshUrl:   `git@github.com:${project.githubIntegration.repoOwner}/${project.githubIntegration.repoName}.git`,
            httpsUrl: `https://github.com/${project.githubIntegration.repoOwner}/${project.githubIntegration.repoName}.git`,
          }
        : null,
    },
    // v1: skills live on the agent's filesystem (~/.claude/skills + per-agent
    // skills under /context/skills). Returning [] now keeps the response
    // shape stable for when a future slice surfaces skill metadata from CC.
    skills: [],
    recentActivity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      actor: a.user,
      createdAt: a.createdAt,
      details: a.details,
    })),
    currentSprint: activeSprint
      ? {
          id: activeSprint.id,
          name: activeSprint.name,
          number: activeSprint.number,
          goal: activeSprint.goal,
          startDate: activeSprint.startDate,
          endDate: activeSprint.endDate,
        }
      : null,
    currentSprintTasks: currentSprintTasks.map((t) => ({
      id: t.id,
      taskNumber: t.taskNumber,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      storyPoints: t.storyPoints,
      assignee: t.assignee,
      dueDate: t.dueDate,
      isBlocked: t.isBlocked,
      blockerNote: t.blockerNote,
      acceptanceCriteria: t.acceptanceCriteria,
    })),
    myAssignedTasks: myTasks,
    decisions: decisions.map((d) => ({
      id: d.id,
      title: d.title,
      rationale: d.rationale,
      alternatives: d.alternatives,
      status: d.status,
      tags: d.tags,
      createdAt: d.createdAt,
    })),
    // Metadata-only document index. Agent runs `cc docs fetch
    // <project-slug> <doc-id>` when a doc looks relevant from this list.
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      category: d.category,
      filename: d.filename,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
    })),
    stats: {
      totalTasks,
      tasksByStatus,
      activeMemberCount: project.members.filter((m) => m.user.isActive).length,
    },
  };
}
