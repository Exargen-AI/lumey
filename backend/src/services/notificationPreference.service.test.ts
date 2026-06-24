/**
 * Unit tests for the notification-preference service. The full
 * preference-list flow lives here; the mute-actually-skips-fan-out
 * behavior is covered separately in the notification.service tests
 * (`createNotification` honors muted types).
 */

import './../test/prismaMock';

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  getMutedTypes,
  getMutedTypesForUsers,
  getPreferences,
  setMuted,
  bulkUpdate,
} from './notificationPreference.service';
import { ValidationError } from '../utils/errors';

beforeEach(() => {
  // Default: no preference rows. Each test stubs what it needs.
  (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
});

describe('getMutedTypes', () => {
  it('returns the set of types the user has muted', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { type: 'task_nudge' },
      { type: 'task_completion_encouragement' },
    ]);
    const muted = await getMutedTypes('u-1');
    expect(muted.has('task_nudge')).toBe(true);
    expect(muted.has('task_completion_encouragement')).toBe(true);
    expect(muted.has('task_assigned')).toBe(false);
  });

  it('returns an empty set when the user has no preferences row', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    const muted = await getMutedTypes('u-1');
    expect(muted.size).toBe(0);
  });

  it('defends against an undefined return from the Prisma mock', async () => {
    // The deep-mock returns undefined for un-stubbed calls. Real Prisma
    // always returns an array. The helper must not throw.
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue(undefined);
    const muted = await getMutedTypes('u-1');
    expect(muted.size).toBe(0);
  });

  it('only matches rows where muted=true (sparse storage invariant)', async () => {
    // We pass `where: { muted: true }`, so Prisma already filters. The
    // helper itself doesn't re-filter — pin that contract by asserting
    // the query shape.
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    await getMutedTypes('u-1');
    expect(prismaMock.notificationPreference.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', muted: true },
      select: { type: true },
    });
  });
});

describe('getMutedTypesForUsers (batch)', () => {
  it('groups muted rows by userId', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { userId: 'u-1', type: 'task_nudge' },
      { userId: 'u-1', type: 'task_assigned' },
      { userId: 'u-2', type: 'task_nudge' },
    ]);
    const map = await getMutedTypesForUsers(['u-1', 'u-2', 'u-3']);
    expect(map.get('u-1')?.has('task_nudge')).toBe(true);
    expect(map.get('u-1')?.has('task_assigned')).toBe(true);
    expect(map.get('u-2')?.has('task_nudge')).toBe(true);
    // u-3 has no rows; absent from map.
    expect(map.has('u-3')).toBe(false);
  });

  it('short-circuits when given an empty user list (no DB call)', async () => {
    const map = await getMutedTypesForUsers([]);
    expect(map.size).toBe(0);
    expect(prismaMock.notificationPreference.findMany).not.toHaveBeenCalled();
  });
});

describe('getPreferences — FE-facing list', () => {
  it('returns one entry per known type even when the user has no stored preferences', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    const result = await getPreferences('u-1');
    // 26 known types as of this PR. Treat "more than 20" as the
    // invariant — the exact count moves with new features but the
    // shape (every known type present) is stable.
    expect(result.length).toBeGreaterThan(20);
    expect(result.every((r) => r.muted === false)).toBe(true);
    // Spot-check a known type is in the result.
    expect(result.find((r) => r.type === 'task_nudge')).toBeTruthy();
  });

  it('merges stored mutes with default-unmuted for untouched types', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { type: 'task_nudge', muted: true },
      { type: 'task_assigned', muted: false }, // explicitly unmuted
    ]);
    const result = await getPreferences('u-1');
    expect(result.find((r) => r.type === 'task_nudge')?.muted).toBe(true);
    // Explicit-unmuted matches the default-unmuted shape (both `false`).
    expect(result.find((r) => r.type === 'task_assigned')?.muted).toBe(false);
    // Untouched type — default applies.
    expect(result.find((r) => r.type === 'task_deleted')?.muted).toBe(false);
  });
});

describe('setMuted', () => {
  it('upserts the (userId, type) row with the given muted flag', async () => {
    (prismaMock.notificationPreference.upsert as any).mockResolvedValue({
      type: 'task_nudge',
      muted: true,
    });
    const result = await setMuted('u-1', 'task_nudge', true);
    expect(result).toEqual({ type: 'task_nudge', muted: true });
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_type: { userId: 'u-1', type: 'task_nudge' } },
      create: { userId: 'u-1', type: 'task_nudge', muted: true },
      update: { muted: true },
      select: { type: true, muted: true },
    });
  });

  it('rejects unknown types at the service boundary', async () => {
    // Defense in depth: validator should catch this, but a programmatic
    // caller (seed, test, internal RPC) could bypass it. The service
    // refuses regardless so the DB stays clean.
    await expect(setMuted('u-1', 'bogus_type', true)).rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});

describe('bulkUpdate', () => {
  it('upserts every valid preference in a transaction', async () => {
    (prismaMock.$transaction as any).mockResolvedValue([]);
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { type: 'task_nudge', muted: true },
      { type: 'task_assigned', muted: false },
    ]);
    const result = await bulkUpdate('u-1', [
      { type: 'task_nudge', muted: true },
      { type: 'task_assigned', muted: false },
    ]);
    // The returned list is the freshly-fetched view, so the lengths
    // match the full preference set (every known type).
    expect(result.length).toBeGreaterThan(20);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('silently filters out unknown types instead of erroring (FE-drift tolerance)', async () => {
    // A stale FE build might submit a type the server has removed.
    // We don't want to 400 the whole save — drop the bad entries and
    // upsert the rest.
    (prismaMock.$transaction as any).mockResolvedValue([]);
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    await bulkUpdate('u-1', [
      { type: 'task_nudge', muted: true },
      { type: 'definitely_not_a_type', muted: true },
    ]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // The transaction array was built from the filtered list — one
    // op (task_nudge) survives.
    const txArg = (prismaMock.$transaction as any).mock.calls[0]?.[0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(txArg.length).toBe(1);
  });

  it('short-circuits (no transaction) when all entries are unknown', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    await bulkUpdate('u-1', [
      { type: 'definitely_not_a_type', muted: true },
      { type: 'also_not_a_type', muted: false },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
