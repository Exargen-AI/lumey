/**
 * Real-Postgres tests for task-subscription cascade behavior.
 *
 * The `TaskSubscription` model declares its FKs as `onDelete: Cascade`
 * (see prisma/schema.prisma). The unit suite can't verify this — Prisma's
 * cascade is enforced by Postgres at delete time, not by the Prisma
 * client. A regression to `Restrict` or `SetNull` here would let
 * subscriptions outlive their parent task/user, leading to orphaned
 * notifications fan-out and 404 spam in the UI.
 *
 * These tests assert the actual SQL behavior: delete a parent, the
 * children disappear. Run against a real Postgres, this is the only
 * place we can pin it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  getTestPrisma,
  prepareSchema,
  resetDb,
  disconnectTestPrisma,
} from './harness';
import { hashPassword } from '../../utils/password';

const prisma = getTestPrisma();

beforeAll(async () => {
  await prepareSchema();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectTestPrisma();
});

async function bootstrap() {
  // Minimal fixture: one project, TWO users (a creator + a subscriber),
  // one task created by the creator.
  //
  // Why two users: Task.creator has no `onDelete` cascade — by design,
  // deleting a user whose tasks still exist is refused at the Postgres
  // FK level (we don't want to silently orphan tasks when someone
  // leaves). So in the "delete the subscriber" test, the subscriber
  // can't ALSO be the task creator. Real-life shape: tasks have a
  // longer-lived creator and a set of transient subscribers.
  const hash = await hashPassword('Pwd!12345');
  const creator = await prisma.user.create({
    data: { email: 'creator@exargen.in', name: 'Creator', passwordHash: hash, role: 'ENGINEER' },
  });
  const subscriber = await prisma.user.create({
    data: { email: 'sub@exargen.in', name: 'Sub', passwordHash: hash, role: 'ENGINEER' },
  });
  const project = await prisma.project.create({
    data: {
      name: 'Real-DB Test Project',
      slug: 'real-db-test',
      description: 'Cascade smoke',
      category: 'PLATFORM',
      phase: 'DEVELOPMENT',
    },
  });
  const task = await prisma.task.create({
    data: {
      title: 'Smoke task',
      projectId: project.id,
      status: 'TODO',
      priority: 'P2',
      creatorId: creator.id,
    },
  });
  return { creator, subscriber, user: subscriber, project, task };
}

describe('TaskSubscription — cascade-delete from task', () => {
  it('removes the subscription row when the parent task is deleted', async () => {
    const { user, task } = await bootstrap();
    await prisma.taskSubscription.create({
      data: { taskId: task.id, userId: user.id, source: 'MANUAL' },
    });

    // Sanity: row is there
    const before = await prisma.taskSubscription.count({ where: { taskId: task.id } });
    expect(before).toBe(1);

    // The actual cascade: delete the task, the subscription must vanish.
    await prisma.task.delete({ where: { id: task.id } });

    const after = await prisma.taskSubscription.count({ where: { taskId: task.id } });
    expect(after).toBe(0);
  });
});

describe('TaskSubscription — cascade-delete from user', () => {
  it('removes the subscription row when the subscribed user is deleted', async () => {
    const { user, task } = await bootstrap();
    await prisma.taskSubscription.create({
      data: { taskId: task.id, userId: user.id, source: 'AUTO_CREATOR' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const after = await prisma.taskSubscription.count({ where: { userId: user.id } });
    expect(after).toBe(0);
  });
});

describe('TaskSubscription — idempotent re-subscribe (real upsert)', () => {
  it('upserting the same (taskId, userId) twice keeps exactly one row', async () => {
    // The service uses `upsert` with an empty `update` block so a user
    // clicking Follow twice doesn't 409 — they end up subscribed once.
    // Pin that against the real unique constraint (compound index on
    // taskId + userId).
    const { user, task } = await bootstrap();
    const payload = { taskId: task.id, userId: user.id, source: 'MANUAL' as const };

    await prisma.taskSubscription.upsert({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
      create: payload,
      update: {},
    });
    await prisma.taskSubscription.upsert({
      where: { taskId_userId: { taskId: task.id, userId: user.id } },
      create: payload,
      update: {},
    });

    const count = await prisma.taskSubscription.count({ where: { taskId: task.id } });
    expect(count).toBe(1);
  });
});
