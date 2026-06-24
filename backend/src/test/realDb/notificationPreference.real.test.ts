/**
 * Real-Postgres tests for notification preferences end-to-end.
 *
 * The unit suite verifies that `createNotification` returns null when
 * the user has muted the type. This file pins the SQL side of that:
 *
 *   - The upsert at the unique key (userId, type) writes a single row.
 *   - The cascade on user delete drops preferences with their owner.
 *   - The `bypassMute: true` path always writes, regardless of mute
 *     row in the DB.
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

async function seedUser(email = 'pref@exargen.in') {
  const passwordHash = await hashPassword('Pwd!12345');
  return prisma.user.create({
    data: { email, name: 'Pref', passwordHash, role: 'ENGINEER' },
  });
}

describe('NotificationPreference — upsert via service', () => {
  it('writes a single row + idempotent re-toggle keeps it at one row', async () => {
    const user = await seedUser();
    const { setMuted } = await import('../../services/notificationPreference.service');

    await setMuted(user.id, 'task_nudge', true);
    await setMuted(user.id, 'task_nudge', true); // re-toggle to same value

    const count = await prisma.notificationPreference.count({
      where: { userId: user.id, type: 'task_nudge' },
    });
    expect(count).toBe(1);
  });

  it('flipping muted=false on an existing row updates in place (not a new row)', async () => {
    const user = await seedUser();
    const { setMuted } = await import('../../services/notificationPreference.service');

    await setMuted(user.id, 'task_nudge', true);
    await setMuted(user.id, 'task_nudge', false);

    const rows = await prisma.notificationPreference.findMany({
      where: { userId: user.id, type: 'task_nudge' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].muted).toBe(false);
  });
});

describe('createNotification — mute behavior against real Postgres', () => {
  it('skips the INSERT when the user has the type muted', async () => {
    const user = await seedUser();
    const { setMuted } = await import('../../services/notificationPreference.service');
    const { createNotification } = await import('../../services/notification.service');

    await setMuted(user.id, 'task_nudge', true);
    const result = await createNotification({
      userId: user.id,
      type: 'task_nudge',
      title: 'Hey',
    });
    expect(result).toBeNull();

    const count = await prisma.notification.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });

  it('still inserts when bypassMute is true', async () => {
    const user = await seedUser();
    const { setMuted } = await import('../../services/notificationPreference.service');
    const { createNotification } = await import('../../services/notification.service');

    await setMuted(user.id, 'task_nudge', true);
    const result = await createNotification({
      userId: user.id,
      type: 'task_nudge',
      title: 'Admin override',
      bypassMute: true,
    });
    expect(result).not.toBeNull();

    const count = await prisma.notification.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });
});

describe('NotificationPreference — cascade on user delete', () => {
  it('drops preference rows when the parent user is deleted', async () => {
    const user = await seedUser();
    const { setMuted } = await import('../../services/notificationPreference.service');
    await setMuted(user.id, 'task_nudge', true);

    await prisma.user.delete({ where: { id: user.id } });

    const orphans = await prisma.notificationPreference.count({
      where: { userId: user.id },
    });
    expect(orphans).toBe(0);
  });
});
