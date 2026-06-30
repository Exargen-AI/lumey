import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserRole, UserType } from '@prisma/client';
import { getAuditRows, toCsv, type AuditRow } from './audit.service';

const { checkPermissionSpy } = vi.hoisted(() => ({ checkPermissionSpy: vi.fn() }));
vi.mock('./rbac.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: checkPermissionSpy,
}));

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionSpy.mockResolvedValue(true); // project.view_all
  prismaMock.activity.findMany.mockResolvedValue([] as never);
});

describe('getAuditRows', () => {
  it('maps activity rows to a flat audit shape', async () => {
    prismaMock.activity.findMany.mockResolvedValue([
      { createdAt: new Date('2026-06-28T10:00:00Z'), actorType: 'AGENT', action: 'moved_task', targetType: 'task', targetId: 't1', user: { name: 'Lumey Agent' }, project: { name: 'BountiPOS' } },
    ] as never);
    const rows = await getAuditRows({ id: 'admin', role: UserRole.SUPER_ADMIN, canViewAgents: true });
    expect(rows[0]).toEqual({
      timestamp: '2026-06-28T10:00:00.000Z', actorType: 'AGENT', actor: 'Lumey Agent',
      action: 'moved_task', targetType: 'task', targetId: 't1', project: 'BountiPOS',
    });
  });

  it('scopes a non-admin to their project memberships', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }] as never);
    await getAuditRows({ id: 'pm', role: UserRole.PRODUCT_MANAGER, canViewAgents: true });
    expect(prismaMock.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: { in: ['p1'] } }) }),
    );
  });

  it('hides agent-authored rows from a viewer who cannot see agents', async () => {
    // ADMIN (not SUPER_ADMIN, which always sees agents) without the allowlist flag.
    await getAuditRows({ id: 'u', role: UserRole.ADMIN, canViewAgents: false });
    expect(prismaMock.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ actorType: UserType.HUMAN }) }),
    );
  });
});

describe('toCsv', () => {
  const base: AuditRow = { timestamp: '2026-06-28T10:00:00.000Z', actorType: UserType.HUMAN, actor: 'Anil', action: 'logged_in', targetType: '', targetId: '', project: '' };

  it('writes a header + RFC-4180-quoted rows', () => {
    const csv = toCsv([{ ...base, actor: 'Doe, Jane', action: 'said "hi"' }]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('timestamp,actorType,actor,action,targetType,targetId,project');
    expect(row).toContain('"Doe, Jane"');
    expect(row).toContain('"said ""hi"""');
  });

  it('neutralizes spreadsheet formula injection', () => {
    const csv = toCsv([{ ...base, action: '=SUM(A1:A9)' }]);
    expect(csv).toContain("'=SUM(A1:A9)"); // leading apostrophe disarms the formula
  });
});
