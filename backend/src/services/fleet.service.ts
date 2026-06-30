/**
 * Fleet service — the cross-system operator view of the agent fleet. Where the
 * HITL inbox answers "what needs me?", this answers "how is the whole fleet
 * doing?": how many runs are in flight, how they're distributed across the
 * lifecycle, throughput in the last 24h, and a per-agent rollup of work + token
 * spend + failures.
 *
 * Visibility mirrors the rest of the agent surface (and the inbox): runs are
 * agent work, so only agent-visible viewers get a fleet at all, and then only
 * for projects they can access (admins with `project.view_all` see everything;
 * everyone else is scoped to their memberships). Enforced server-side.
 */
import prisma from '../config/database';
import { checkPermission } from './rbac.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';
import { RunStatus, type Prisma, type UserRole } from '@prisma/client';

export interface FleetViewer {
  readonly id: string;
  readonly role: UserRole;
  readonly canViewAgents?: boolean | null;
}

/** Non-terminal = still in flight (the fleet's live workload). */
const ACTIVE_STATUSES: RunStatus[] = [
  RunStatus.QUEUED,
  RunStatus.RUNNING,
  RunStatus.PAUSED,
  RunStatus.AWAITING_INPUT,
  RunStatus.AWAITING_REVIEW,
  RunStatus.BLOCKED,
];

export interface FleetOverview {
  totals: { total: number; active: number; succeeded: number; failed: number };
  tokens: number;
  byStatus: { status: RunStatus; count: number }[];
  last24h: { runs: number; tokens: number };
  agents: { agentId: string; name: string; runs: number; active: number; failed: number; tokens: number }[];
}

const EMPTY: FleetOverview = { totals: { total: 0, active: 0, succeeded: 0, failed: 0 }, tokens: 0, byStatus: [], last24h: { runs: 0, tokens: 0 }, agents: [] };

/**
 * Resolve the run-visibility filter for a viewer: `{}` (everything) for an admin
 * with `project.view_all`, a project-scoped filter for a member, or `null` when
 * the viewer can't see the fleet at all (not agent-visible, or no projects).
 */
async function runScope(viewer: FleetViewer): Promise<Prisma.AgentRunWhereInput | null> {
  if (!viewerCanSeeAgents(viewer)) return null;
  if (await checkPermission(viewer.role, 'project.view_all')) return {};
  const memberships = await prisma.projectMember.findMany({ where: { userId: viewer.id }, select: { projectId: true } });
  const projectIds = memberships.map((m) => m.projectId);
  if (projectIds.length === 0) return null;
  return { task: { projectId: { in: projectIds } } };
}

/** Fleet rollup: lifecycle distribution, 24h throughput, and per-agent work. */
export async function getFleetOverview(viewer: FleetViewer): Promise<FleetOverview> {
  const where = await runScope(viewer);
  if (!where) return EMPTY;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byStatusRows, agentRows, recentRows] = await Promise.all([
    prisma.agentRun.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { totalTokens: true } }),
    prisma.agentRun.groupBy({ by: ['agentId', 'status'], where, _count: { _all: true }, _sum: { totalTokens: true } }),
    prisma.agentRun.groupBy({ by: ['status'], where: { ...where, createdAt: { gte: since } }, _count: { _all: true }, _sum: { totalTokens: true } }),
  ]);

  const byStatus = byStatusRows.map((r) => ({ status: r.status, count: r._count._all }));
  const countOf = (s: RunStatus) => byStatusRows.find((r) => r.status === s)?._count._all ?? 0;
  const total = byStatusRows.reduce((n, r) => n + r._count._all, 0);
  const active = byStatusRows.filter((r) => ACTIVE_STATUSES.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  const tokens = byStatusRows.reduce((n, r) => n + (r._sum.totalTokens ?? 0), 0);

  // Per-agent rollup from the (agentId, status) groups.
  const agentMap = new Map<string, { runs: number; active: number; failed: number; tokens: number }>();
  for (const r of agentRows) {
    const a = agentMap.get(r.agentId) ?? { runs: 0, active: 0, failed: 0, tokens: 0 };
    a.runs += r._count._all;
    a.tokens += r._sum.totalTokens ?? 0;
    if (ACTIVE_STATUSES.includes(r.status)) a.active += r._count._all;
    if (r.status === RunStatus.FAILED) a.failed += r._count._all;
    agentMap.set(r.agentId, a);
  }
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...agentMap.keys()] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const agents = [...agentMap.entries()]
    .map(([agentId, a]) => ({ agentId, name: names.get(agentId) ?? 'Unknown agent', ...a }))
    .sort((x, y) => y.runs - x.runs)
    .slice(0, 8);

  return {
    totals: { total, active, succeeded: countOf(RunStatus.SUCCEEDED), failed: countOf(RunStatus.FAILED) },
    tokens,
    byStatus,
    last24h: {
      runs: recentRows.reduce((n, r) => n + r._count._all, 0),
      tokens: recentRows.reduce((n, r) => n + (r._sum.totalTokens ?? 0), 0),
    },
    agents,
  };
}

export interface FleetRun {
  id: string;
  status: RunStatus;
  model: string | null;
  totalTokens: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  task: { id: string; title: string; taskNumber: number; projectId: string; projectName: string };
  agent: { id: string; name: string };
}

/** Recent runs across the visible fleet, newest first; optional status filter. */
export async function listFleetRuns(
  viewer: FleetViewer,
  opts: { status?: RunStatus; limit?: number; offset?: number } = {},
): Promise<FleetRun[]> {
  const where = await runScope(viewer);
  if (!where) return [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const runs = await prisma.agentRun.findMany({
    where: { ...where, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: Math.max(opts.offset ?? 0, 0),
    select: {
      id: true, status: true, model: true, totalTokens: true, createdAt: true, startedAt: true, endedAt: true,
      task: { select: { id: true, title: true, taskNumber: true, projectId: true, project: { select: { name: true } } } },
      agent: { select: { id: true, name: true } },
    },
  });

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    model: r.model,
    totalTokens: r.totalTokens,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    task: { id: r.task.id, title: r.task.title, taskNumber: r.task.taskNumber, projectId: r.task.projectId, projectName: r.task.project.name },
    agent: { id: r.agent.id, name: r.agent.name },
  }));
}
