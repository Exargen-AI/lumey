import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ClarificationStatus } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import {
  createClarification,
  recordClarificationAnswer,
  cancelOpenClarificationsForRun,
} from './runClarification.service';

beforeEach(() => vi.clearAllMocks());

describe('createClarification', () => {
  it('opens a PENDING question on the run', async () => {
    prismaMock.runClarificationRequest.create.mockResolvedValue({ id: 'c1' } as never);
    const created = await createClarification({ runId: 'r1', taskId: 't1', question: 'Which DB?' });
    expect(prismaMock.runClarificationRequest.create).toHaveBeenCalledWith({
      data: { runId: 'r1', question: 'Which DB?' },
    });
    expect(created.id).toBe('c1');
  });
});

describe('recordClarificationAnswer', () => {
  it('marks a PENDING clarification ANSWERED and returns the run/task ids', async () => {
    prismaMock.runClarificationRequest.findUnique.mockResolvedValue({
      id: 'c1', status: ClarificationStatus.PENDING, runId: 'r1', run: { taskId: 't1' },
    } as never);
    prismaMock.runClarificationRequest.update.mockResolvedValue({ id: 'c1' } as never);

    const res = await recordClarificationAnswer({ clarificationId: 'c1', answer: 'Postgres', userId: 'u1' });

    expect(prismaMock.runClarificationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          status: ClarificationStatus.ANSWERED,
          answer: 'Postgres',
          answeredById: 'u1',
        }),
      }),
    );
    expect(res).toMatchObject({ runId: 'r1', taskId: 't1' });
  });

  it('rejects answering a clarification that is not PENDING', async () => {
    prismaMock.runClarificationRequest.findUnique.mockResolvedValue({
      id: 'c1', status: ClarificationStatus.ANSWERED, runId: 'r1', run: { taskId: 't1' },
    } as never);
    await expect(recordClarificationAnswer({ clarificationId: 'c1', answer: 'x', userId: 'u1' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.runClarificationRequest.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing clarification', async () => {
    prismaMock.runClarificationRequest.findUnique.mockResolvedValue(null as never);
    await expect(recordClarificationAnswer({ clarificationId: 'nope', answer: 'x', userId: 'u1' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('cancelOpenClarificationsForRun', () => {
  it('closes every still-PENDING question and reports the count', async () => {
    prismaMock.runClarificationRequest.updateMany.mockResolvedValue({ count: 2 } as never);
    expect(await cancelOpenClarificationsForRun('r1')).toBe(2);
    expect(prismaMock.runClarificationRequest.updateMany).toHaveBeenCalledWith({
      where: { runId: 'r1', status: ClarificationStatus.PENDING },
      data: { status: ClarificationStatus.CANCELLED },
    });
  });
});
