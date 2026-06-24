/**
 * CC feature PR 2026-05-20 — task subscriptions service tests.
 *
 * The subscriptions surface is the foundation for the nudge +
 * subscriber-notification features. Tests cover:
 *
 *   - subscribeToTask: NotFound on missing task, idempotent upsert
 *   - unsubscribeFromTask: NotFound + idempotent delete
 *   - listTaskSubscribers: order + shape
 *   - getSubscriberIdsForNotify: exclude-set + defensive []
 */

import './../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  subscribeToTask,
  unsubscribeFromTask,
  listTaskSubscribers,
  getSubscriberIdsForNotify,
} from './taskSubscription.service';
import { NotFoundError } from '../utils/errors';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscribeToTask', () => {
  it('THROWS NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    await expect(subscribeToTask('gone', 'u-1', 'MANUAL')).rejects.toBeInstanceOf(NotFoundError);
    expect(prismaMock.taskSubscription.upsert).not.toHaveBeenCalled();
  });

  it('UPSERTS the subscription row (idempotent — re-subscribe is a no-op)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't-1' } as any);

    await subscribeToTask('t-1', 'u-1', 'MANUAL');

    expect(prismaMock.taskSubscription.upsert).toHaveBeenCalledWith({
      where: { taskId_userId: { taskId: 't-1', userId: 'u-1' } },
      create: { taskId: 't-1', userId: 'u-1', source: 'MANUAL' },
      // Empty `update` keeps the existing row's source intact so
      // an AUTO_* re-subscribe doesn't downgrade a MANUAL row.
      update: {},
    });
  });

  it('records the source verbatim so the FE can render the "why" badge', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't-1' } as any);

    await subscribeToTask('t-1', 'u-1', 'AUTO_REVIEWER');

    const call = prismaMock.taskSubscription.upsert.mock.calls[0]?.[0] as any;
    expect(call.create.source).toBe('AUTO_REVIEWER');
  });
});

describe('unsubscribeFromTask', () => {
  it('THROWS NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    await expect(unsubscribeFromTask('gone', 'u-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(prismaMock.taskSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('returns { removed: count } from deleteMany (idempotent — unsubscribe-when-not-subscribed returns 0)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't-1' } as any);
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 1 } as any);

    const result = await unsubscribeFromTask('t-1', 'u-1');
    expect(result).toEqual({ removed: 1 });
  });

  it('returns { removed: 0 } when no row matched (idempotent)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't-1' } as any);
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 0 } as any);

    const result = await unsubscribeFromTask('t-1', 'u-1');
    expect(result).toEqual({ removed: 0 });
  });
});

describe('listTaskSubscribers', () => {
  it('returns subscribers ordered by createdAt asc, shape includes source + user', async () => {
    prismaMock.taskSubscription.findMany.mockResolvedValue([
      {
        userId: 'u-1',
        source: 'AUTO_ASSIGNEE',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        user: { id: 'u-1', name: 'Maya', role: 'PRODUCT_MANAGER' },
      },
    ] as any);

    const subs = await listTaskSubscribers('t-1');

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      userId: 'u-1',
      source: 'AUTO_ASSIGNEE',
      user: { id: 'u-1', name: 'Maya' },
    });

    // Order matters — oldest subscriber first, so the UI can show
    // "subscribed since N days ago" without re-sorting.
    const call = prismaMock.taskSubscription.findMany.mock.calls[0]?.[0] as any;
    expect(call.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('getSubscriberIdsForNotify', () => {
  it('returns userId list with the excluded set filtered out via Prisma `notIn`', async () => {
    prismaMock.taskSubscription.findMany.mockResolvedValue([
      { userId: 'u-1' },
      { userId: 'u-2' },
    ] as any);

    const ids = await getSubscriberIdsForNotify('t-1', new Set(['author-x', 'mentioned-y']));

    expect(ids).toEqual(['u-1', 'u-2']);
    const call = prismaMock.taskSubscription.findMany.mock.calls[0]?.[0] as any;
    expect(call.where.userId.notIn).toEqual(['author-x', 'mentioned-y']);
  });

  it('returns [] when no subscribers match (defensive against undefined mock)', async () => {
    // Vitest deep-mock returns undefined when not stubbed. Real
    // Prisma always returns []. The helper coerces so the
    // function's string[] contract holds either way.
    prismaMock.taskSubscription.findMany.mockResolvedValue(undefined as any);

    const ids = await getSubscriberIdsForNotify('t-1', new Set());
    expect(ids).toEqual([]);
  });

  // 2026-05-23 audit Bug #1 fix — defence-in-depth filter.
  // The primary cleanup happens at removeProjectMember (which deletes
  // the subscription rows). This helper also filters by user.isActive
  // so a DEACTIVATED user with a stale subscription row never gets a
  // fresh notification, regardless of how the stale row exists.
  it('queries with user.isActive=true so deactivated users never get pings (defence in depth)', async () => {
    prismaMock.taskSubscription.findMany.mockResolvedValue([{ userId: 'u-1' }] as any);
    await getSubscriberIdsForNotify('t-1', new Set());
    const call = prismaMock.taskSubscription.findMany.mock.calls[0]?.[0] as any;
    expect(call.where.user).toEqual({ isActive: true });
  });
});
