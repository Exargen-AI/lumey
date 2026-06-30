import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserRole } from '@prisma/client';
import { getFleetOverview, listFleetRuns } from './fleet.service';

const { checkPermissionSpy } = vi.hoisted(() => ({ checkPermissionSpy: vi.fn() }));
vi.mock('./rbac.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: checkPermissionSpy,
}));

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionSpy.mockResolvedValue(true); // project.view_all (admin)
});

describe('getFleetOverview', () => {
  it('returns an empty overview for a viewer who cannot see agents (no DB)', async () => {
    const o = await getFleetOverview({ id: 'u1', role: UserRole.ENGINEER, canViewAgents: false });
    expect(o.totals.total).toBe(0);
    expect(prismaMock.agentRun.groupBy).not.toHaveBeenCalled();
  });

  it('aggregates lifecycle totals, 24h throughput, and a per-agent rollup', async () => {
    vi.mocked(prismaMock.agentRun.groupBy)
      .mockResolvedValueOnce([
        { status: 'RUNNING', _count: { _all: 2 }, _sum: { totalTokens: 1000 } },
        { status: 'SUCCEEDED', _count: { _all: 5 }, _sum: { totalTokens: 5000 } },
        { status: 'FAILED', _count: { _all: 1 }, _sum: { totalTokens: 200 } },
      ] as never)
      .mockResolvedValueOnce([
        { agentId: 'a1', status: 'RUNNING', _count: { _all: 2 }, _sum: { totalTokens: 1000 } },
        { agentId: 'a1', status: 'SUCCEEDED', _count: { _all: 5 }, _sum: { totalTokens: 5000 } },
        { agentId: 'a1', status: 'FAILED', _count: { _all: 1 }, _sum: { totalTokens: 200 } },
      ] as never)
      .mockResolvedValueOnce([{ status: 'RUNNING', _count: { _all: 2 }, _sum: { totalTokens: 1000 } }] as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a1', name: 'Lumey Agent' }] as never);

    const o = await getFleetOverview({ id: 'admin', role: UserRole.SUPER_ADMIN, canViewAgents: true });

    expect(o.totals).toEqual({ total: 8, active: 2, succeeded: 5, failed: 1 });
    expect(o.tokens).toBe(6200);
    expect(o.last24h).toEqual({ runs: 2, tokens: 1000 });
    expect(o.agents[0]).toEqual({ agentId: 'a1', name: 'Lumey Agent', runs: 8, active: 2, failed: 1, tokens: 6200 });
  });

  it('scopes a non-admin to their project memberships', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }] as never);
    vi.mocked(prismaMock.agentRun.groupBy).mockResolvedValue([] as never);
    prismaMock.user.findMany.mockResolvedValue([] as never);

    await getFleetOverview({ id: 'pm', role: UserRole.PRODUCT_MANAGER, canViewAgents: true });

    expect(prismaMock.agentRun.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { task: { projectId: { in: ['p1'] } } } }),
    );
  });

  it('returns empty for a non-admin with no memberships', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([] as never);
    expect((await getFleetOverview({ id: 'u', role: UserRole.ENGINEER, canViewAgents: true })).totals.total).toBe(0);
  });
});

describe('listFleetRuns', () => {
  it('returns [] for a viewer who cannot see agents', async () => {
    expect(await listFleetRuns({ id: 'u', role: UserRole.ENGINEER, canViewAgents: false })).toEqual([]);
  });

  it('maps recent runs with task + agent context', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'AWAITING_REVIEW', model: 'glm-4.6', totalTokens: 2000,
        createdAt: new Date('2026-06-28T10:00:00Z'), startedAt: new Date('2026-06-28T09:55:00Z'), endedAt: null,
        task: { id: 't1', title: 'Sales dashboard', taskNumber: 6, projectId: 'p1', project: { name: 'BountiPOS' } },
        agent: { id: 'a1', name: 'Lumey Agent' },
      },
    ] as never);

    const runs = await listFleetRuns({ id: 'admin', role: UserRole.SUPER_ADMIN, canViewAgents: true });

    expect(runs[0]).toMatchObject({
      id: 'r1', status: 'AWAITING_REVIEW', model: 'glm-4.6', totalTokens: 2000,
      task: { taskNumber: 6, projectName: 'BountiPOS' },
      agent: { name: 'Lumey Agent' },
    });
  });
});
