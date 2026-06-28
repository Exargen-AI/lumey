import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ApprovalStatus } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import {
  createApproval,
  recordApprovalDecision,
  cancelOpenApprovalsForRun,
} from './runApproval.service';

beforeEach(() => vi.clearAllMocks());

describe('createApproval', () => {
  it('opens a PENDING approval on the run', async () => {
    prismaMock.runApprovalRequest.create.mockResolvedValue({ id: 'a1' } as never);
    const created = await createApproval({ runId: 'r1', taskId: 't1', action: 'open_pr', summary: 'open_pr: Add login' });
    expect(prismaMock.runApprovalRequest.create).toHaveBeenCalledWith({
      data: { runId: 'r1', action: 'open_pr', summary: 'open_pr: Add login', detail: null },
    });
    expect(created.id).toBe('a1');
  });
});

describe('recordApprovalDecision', () => {
  it('marks APPROVED on approve', async () => {
    prismaMock.runApprovalRequest.findUnique.mockResolvedValue({
      id: 'a1', status: ApprovalStatus.PENDING, runId: 'r1', run: { taskId: 't1' },
    } as never);
    prismaMock.runApprovalRequest.update.mockResolvedValue({ id: 'a1' } as never);

    const res = await recordApprovalDecision({ approvalId: 'a1', approved: true, userId: 'u1' });

    expect(prismaMock.runApprovalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: ApprovalStatus.APPROVED, decidedById: 'u1' }),
      }),
    );
    expect(res).toMatchObject({ runId: 'r1', taskId: 't1' });
  });

  it('marks REJECTED (with reason) on reject', async () => {
    prismaMock.runApprovalRequest.findUnique.mockResolvedValue({
      id: 'a1', status: ApprovalStatus.PENDING, runId: 'r1', run: { taskId: 't1' },
    } as never);
    prismaMock.runApprovalRequest.update.mockResolvedValue({ id: 'a1' } as never);

    await recordApprovalDecision({ approvalId: 'a1', approved: false, reason: 'wrong base', userId: 'u1' });

    expect(prismaMock.runApprovalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ApprovalStatus.REJECTED, reason: 'wrong base' }),
      }),
    );
  });

  it('rejects deciding an approval that is not PENDING', async () => {
    prismaMock.runApprovalRequest.findUnique.mockResolvedValue({
      id: 'a1', status: ApprovalStatus.APPROVED, runId: 'r1', run: { taskId: 't1' },
    } as never);
    await expect(recordApprovalDecision({ approvalId: 'a1', approved: true, userId: 'u1' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.runApprovalRequest.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing approval', async () => {
    prismaMock.runApprovalRequest.findUnique.mockResolvedValue(null as never);
    await expect(recordApprovalDecision({ approvalId: 'nope', approved: true, userId: 'u1' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('cancelOpenApprovalsForRun', () => {
  it('closes every still-PENDING approval and reports the count', async () => {
    prismaMock.runApprovalRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    expect(await cancelOpenApprovalsForRun('r1')).toBe(1);
    expect(prismaMock.runApprovalRequest.updateMany).toHaveBeenCalledWith({
      where: { runId: 'r1', status: ApprovalStatus.PENDING },
      data: { status: ApprovalStatus.CANCELLED },
    });
  });
});
