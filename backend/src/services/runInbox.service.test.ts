import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserRole } from '@prisma/client';
import { listInboxItems } from './runInbox.service';

const { checkPermissionSpy } = vi.hoisted(() => ({ checkPermissionSpy: vi.fn() }));
vi.mock('./rbac.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: checkPermissionSpy,
}));

const runCtx = (over: object) => ({
  run: { id: 'run1', taskId: 't1', task: { taskNumber: 6, title: 'Sales dashboard', projectId: 'p1', project: { name: 'BountiPOS', slug: 'bountipos' } } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionSpy.mockResolvedValue(true); // default: project.view_all
  prismaMock.runClarificationRequest.findMany.mockResolvedValue([] as never);
  prismaMock.runApprovalRequest.findMany.mockResolvedValue([] as never);
});

describe('listInboxItems', () => {
  it('returns nothing — and hits no DB — for a viewer who cannot see agents', async () => {
    const items = await listInboxItems({ id: 'u1', role: UserRole.ENGINEER, canViewAgents: false });
    expect(items).toEqual([]);
    expect(prismaMock.runClarificationRequest.findMany).not.toHaveBeenCalled();
  });

  it('merges clarifications + approvals oldest-first for an admin (no project filter)', async () => {
    prismaMock.runClarificationRequest.findMany.mockResolvedValue([
      { id: 'c1', runId: 'run1', question: 'Which DB?', askedAt: new Date('2026-06-28T10:00:00Z'), ...runCtx({}) },
    ] as never);
    prismaMock.runApprovalRequest.findMany.mockResolvedValue([
      { id: 'a1', runId: 'run1', summary: 'open_pr: Add export', detail: '1 file', action: 'open_pr', requestedAt: new Date('2026-06-28T09:00:00Z'), ...runCtx({}) },
    ] as never);

    const items = await listInboxItems({ id: 'admin', role: UserRole.SUPER_ADMIN, canViewAgents: true });

    // approval (09:00) is older than the clarification (10:00) → sorts first
    expect(items.map((i) => i.kind)).toEqual(['approval', 'clarification']);
    expect(items[0]).toMatchObject({ id: 'a1', action: 'open_pr', taskNumber: 6, projectName: 'BountiPOS' });
    expect(items[1]).toMatchObject({ id: 'c1', kind: 'clarification', prompt: 'Which DB?', action: null });
    // admin → no project scoping applied
    expect(prismaMock.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('scopes a non-admin to their project memberships', async () => {
    checkPermissionSpy.mockResolvedValue(false); // not project.view_all
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }] as never);

    await listInboxItems({ id: 'u1', role: UserRole.ENGINEER, canViewAgents: true });

    expect(prismaMock.runClarificationRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ run: { task: { projectId: { in: ['p1'] } } } }) }),
    );
  });

  it('returns [] for a non-admin with no project memberships', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([] as never);
    expect(await listInboxItems({ id: 'u1', role: UserRole.ENGINEER, canViewAgents: true })).toEqual([]);
    expect(prismaMock.runApprovalRequest.findMany).not.toHaveBeenCalled();
  });
});
