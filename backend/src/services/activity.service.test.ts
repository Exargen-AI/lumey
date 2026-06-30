import './../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserType } from '@prisma/client';
import { logActivity } from './activity.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.activity.create.mockResolvedValue({ id: 'act1' } as never);
});

describe('logActivity — actorType capture', () => {
  it('uses an explicitly provided actorType without a user lookup', async () => {
    await logActivity({ userId: 'a1', action: 'moved_task', actorType: UserType.AGENT });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorType: UserType.AGENT }) }),
    );
  });

  it('derives AGENT from the actor when not provided', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.AGENT } as never);
    await logActivity({ userId: 'a1', action: 'created_comment' });
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorType: UserType.AGENT }) }),
    );
  });

  it('defaults to HUMAN when the actor is gone (immutable, survives deletion)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    await logActivity({ userId: 'ghost', action: 'logged_in' });
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorType: UserType.HUMAN }) }),
    );
  });

  it('captures actorType in a transactional write too', async () => {
    const tx = {
      activity: { create: vi.fn().mockResolvedValue({ id: 'act2' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ userType: UserType.HUMAN }) },
    };
    await logActivity({ userId: 'h1', action: 'deleted_task' }, tx as never);
    expect(tx.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorType: UserType.HUMAN }) }),
    );
  });
});
