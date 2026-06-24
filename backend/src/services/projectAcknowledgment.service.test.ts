/**
 * Phase 2.4 of the baseline hardening plan — critical tier.
 *
 * `projectAcknowledgment.service` is the legal-audit chokepoint: every
 * user must agree to confidentiality before seeing any project material.
 * The agreed text is snapshotted into the DB row so future edits don't
 * retroactively change what users agreed to.
 *
 * Security + correctness properties asserted:
 *
 *   1. **Membership gate with super-admin bypass.** Anyone with
 *      `project.view_all` (SUPER_ADMIN / ADMIN by default) can ack
 *      without being a member; mirrors the projectAccess middleware.
 *      The original code only checked membership, which 403'd SUPER_ADMINs
 *      who were never explicitly enrolled — comment in source documents
 *      this fix.
 *
 *   2. **Race-safe createMany.** Two concurrent POSTs can't both create
 *      the row + both crash on P2002 (QA finding #12). createMany +
 *      skipDuplicates handles that at the DB level.
 *
 *   3. **Audit log fires exactly once per ack.** Concurrent retries
 *      see `created.count === 0` and stay quiet — no duplicate entries
 *      in the legal log.
 *
 *   4. **The agreed text is snapshotted.** Future edits to
 *      `CONFIDENTIALITY_TEXT` don't change what already-acknowledged
 *      users agreed to.
 *
 *   5. **Forensic context is recorded.** ipAddress + userAgent persist
 *      so the audit chain can prove who agreed to what + when + from
 *      where.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ForbiddenError, NotFoundError } from '../utils/errors';

// Mock activity.service so we can assert audit-log behavior without
// pulling in its real Prisma logic. vi.hoisted keeps the spies in scope
// when vi.mock's hoisted callback runs at module-load time.
const { logActivitySpy, checkPermissionSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  checkPermissionSpy: vi.fn(),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
}));

import {
  CONFIDENTIALITY_TEXT,
  getMyAcknowledgment,
  acknowledgeProject,
  listAcknowledgmentsForProject,
} from './projectAcknowledgment.service';

beforeEach(() => {
  logActivitySpy.mockClear();
  checkPermissionSpy.mockReset();
  checkPermissionSpy.mockResolvedValue(false); // safe default: no super-admin bypass
});

describe('CONFIDENTIALITY_TEXT', () => {
  it('contains the legal phrases required for the audit chain', () => {
    // Snapshot-style assertion — if someone weakens the language, the
    // test fails and triggers a legal review.
    expect(CONFIDENTIALITY_TEXT).toContain('CONFIDENTIAL');
    expect(CONFIDENTIALITY_TEXT).toContain('NOT disclose');
    expect(CONFIDENTIALITY_TEXT).toContain('IP address');
    expect(CONFIDENTIALITY_TEXT).toContain('user-agent');
    expect(CONFIDENTIALITY_TEXT.length).toBeGreaterThan(500);
  });
});

describe('getMyAcknowledgment', () => {
  it('returns the existing ack record when the user has agreed', async () => {
    const expected = {
      id: 'ack-1',
      acknowledgedAt: new Date('2026-04-01'),
    };
    prismaMock.projectAcknowledgment.findUnique.mockResolvedValue(expected as any);

    const result = await getMyAcknowledgment('user-1', 'project-1');

    expect(result).toEqual(expected);
    expect(prismaMock.projectAcknowledgment.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: 'user-1', projectId: 'project-1' } },
      select: { id: true, acknowledgedAt: true },
    });
  });

  it('returns null when the user has not acknowledged yet', async () => {
    prismaMock.projectAcknowledgment.findUnique.mockResolvedValue(null);

    const result = await getMyAcknowledgment('user-1', 'project-1');

    expect(result).toBeNull();
  });
});

describe('acknowledgeProject', () => {
  const ctx = { ipAddress: '10.0.0.1', userAgent: 'Mozilla/5.0' };

  /** Default-good resolver chain for the parallel project/user/membership lookup. */
  function configureProjectAndUserExist(opts: {
    role?: string;
    isMember?: boolean;
  } = {}) {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: opts.role ?? 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue(
      opts.isMember ? ({ id: 'mem-1' } as any) : null,
    );
  }

  it('throws NotFoundError when the project does not exist', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue(null);

    await expect(acknowledgeProject('u1', 'gone', ctx)).rejects.toThrow(NotFoundError);

    // Critical: we MUST NOT create the ack when the project is gone.
    expect(prismaMock.projectAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when the user no longer exists', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'X' } as any);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.projectMember.findUnique.mockResolvedValue(null);

    await expect(acknowledgeProject('ghost', 'proj-1', ctx)).rejects.toThrow(ForbiddenError);
    expect(prismaMock.projectAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when not a member AND not a super-admin', async () => {
    configureProjectAndUserExist({ role: 'ENGINEER', isMember: false });
    checkPermissionSpy.mockResolvedValue(false); // no project.view_all

    await expect(acknowledgeProject('u1', 'proj-1', ctx)).rejects.toThrow(
      /not a member/i,
    );

    expect(checkPermissionSpy).toHaveBeenCalledWith('ENGINEER', 'project.view_all');
    expect(prismaMock.projectAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  describe('super-admin bypass (the documented bug fix)', () => {
    it('ALLOWS a non-member with project.view_all to acknowledge (SUPER_ADMIN path)', async () => {
      // Before the documented fix, this would have thrown ForbiddenError
      // because SUPER_ADMINs aren't explicit members of every project.
      configureProjectAndUserExist({ role: 'SUPER_ADMIN', isMember: false });
      checkPermissionSpy.mockResolvedValue(true);
      prismaMock.projectAcknowledgment.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectAcknowledgment.findUniqueOrThrow.mockResolvedValue({
        id: 'ack-1',
      } as any);

      await expect(acknowledgeProject('admin-1', 'proj-1', ctx)).resolves.toMatchObject({
        id: 'ack-1',
      });

      expect(prismaMock.projectAcknowledgment.createMany).toHaveBeenCalledTimes(1);
    });

    it('ALLOWS a regular member regardless of role (no view_all needed)', async () => {
      configureProjectAndUserExist({ role: 'ENGINEER', isMember: true });
      checkPermissionSpy.mockResolvedValue(false);
      prismaMock.projectAcknowledgment.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectAcknowledgment.findUniqueOrThrow.mockResolvedValue({
        id: 'ack-2',
      } as any);

      await expect(acknowledgeProject('u1', 'proj-1', ctx)).resolves.toMatchObject({
        id: 'ack-2',
      });
    });
  });

  describe('race-safe createMany + audit-log fires-once', () => {
    it('snapshots CONFIDENTIALITY_TEXT + persists ipAddress + userAgent into the row', async () => {
      configureProjectAndUserExist({ role: 'ENGINEER', isMember: true });
      prismaMock.projectAcknowledgment.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectAcknowledgment.findUniqueOrThrow.mockResolvedValue({} as any);

      await acknowledgeProject('u1', 'proj-1', {
        ipAddress: '203.0.113.4',
        userAgent: 'TestAgent/1.0',
      });

      const createCall = prismaMock.projectAcknowledgment.createMany.mock.calls[0]?.[0] as any;
      expect(createCall.skipDuplicates).toBe(true);
      expect(createCall.data[0]).toMatchObject({
        userId: 'u1',
        projectId: 'proj-1',
        ipAddress: '203.0.113.4',
        userAgent: 'TestAgent/1.0',
        // Snapshot the legal text — future edits don't retroactively
        // change what THIS user agreed to.
        acknowledgedText: CONFIDENTIALITY_TEXT,
      });
    });

    it('writes EXACTLY ONE audit log entry when the row was actually created', async () => {
      configureProjectAndUserExist({ role: 'ENGINEER', isMember: true });
      prismaMock.projectAcknowledgment.createMany.mockResolvedValue({ count: 1 });
      prismaMock.projectAcknowledgment.findUniqueOrThrow.mockResolvedValue({
        id: 'ack-1',
      } as any);

      await acknowledgeProject('u1', 'proj-1', ctx);

      expect(logActivitySpy).toHaveBeenCalledTimes(1);
      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          projectId: 'proj-1',
          action: 'acknowledged_confidentiality',
          targetType: 'project',
          targetId: 'proj-1',
        }),
      );
    });

    it('does NOT audit-log on a concurrent retry (skipDuplicates → count=0)', async () => {
      // Two concurrent POSTs: the first wins and creates the row.
      // The second calls in with count: 0 from skipDuplicates — it must
      // NOT also write an audit entry (would produce duplicate legal
      // evidence with different timestamps for the same ack).
      configureProjectAndUserExist({ role: 'ENGINEER', isMember: true });
      prismaMock.projectAcknowledgment.createMany.mockResolvedValue({ count: 0 });
      prismaMock.projectAcknowledgment.findUniqueOrThrow.mockResolvedValue({
        id: 'ack-existing',
      } as any);

      const result = await acknowledgeProject('u1', 'proj-1', ctx);

      // The caller still gets a successful response with the existing ack.
      expect(result).toMatchObject({ id: 'ack-existing' });
      // But NO new audit entry fires.
      expect(logActivitySpy).not.toHaveBeenCalled();
    });
  });
});

describe('listAcknowledgmentsForProject', () => {
  it('returns all acks for the project with user info, sorted newest first', async () => {
    const rows = [
      { id: 'a1', acknowledgedAt: new Date('2026-04-01'), user: { id: 'u1' } },
      { id: 'a2', acknowledgedAt: new Date('2026-03-01'), user: { id: 'u2' } },
    ];
    prismaMock.projectAcknowledgment.findMany.mockResolvedValue(rows as any);

    const result = await listAcknowledgmentsForProject('proj-1');

    expect(result).toEqual(rows);
    expect(prismaMock.projectAcknowledgment.findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { acknowledgedAt: 'desc' },
    });
  });
});
