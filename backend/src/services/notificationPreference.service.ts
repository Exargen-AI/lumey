import prisma from '../config/database';
import { NOTIFICATION_TYPES, isKnownNotificationType } from '../constants/notificationTypes';
import { ValidationError } from '../utils/errors';

/**
 * Per-user notification mute preferences.
 *
 * Storage model:
 *   - Sparse: a row exists in `notification_preferences` only when the
 *     user has explicitly muted a type. Absence = unmuted.
 *   - This keeps the table small (most users will mute zero types).
 *
 * Lookup contract:
 *   - `getMutedTypes(userId)` returns a Set<string> of muted type strings.
 *     Used by the notification fan-out helpers to filter out recipients
 *     who don't want the type.
 *   - `getPreferences(userId)` returns the full toggle list the FE
 *     renders, even for types the user has never touched (those come
 *     back as `muted: false`).
 */

export type NotificationPreferenceRow = {
  type: string;
  muted: boolean;
};

/**
 * Compact lookup for the fan-out path. Returns the set of muted types
 * for the user; absence from the set means "send it". O(1) check per
 * (user, type) pair, one DB round-trip per fan-out call.
 *
 * Returns an empty set if the user has no preferences row at all —
 * which is the common case.
 */
export async function getMutedTypes(userId: string): Promise<Set<string>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId, muted: true },
    select: { type: true },
  });
  // `rows ?? []` defends against the prismaMock deep-mock returning
  // `undefined` for un-stubbed calls — same shape we use in
  // taskSubscription.service.getSubscriberIdsForNotify. The real
  // client always returns an array (possibly empty).
  return new Set((rows ?? []).map((r) => r.type));
}

/**
 * Same shape as `getMutedTypes` but for a batch of users — used by
 * `createBulkNotifications` where we have N recipients and one round-
 * trip beats N round-trips.
 *
 * Returns a Map<userId, Set<mutedType>>. Users with no muted rows do
 * NOT appear as keys; callers should treat `map.get(userId) ?? EMPTY_SET`.
 */
export async function getMutedTypesForUsers(
  userIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: [...userIds] }, muted: true },
    select: { userId: true, type: true },
  });
  const map = new Map<string, Set<string>>();
  // Same defensive `?? []` as getMutedTypes — see comment there.
  for (const row of rows ?? []) {
    let set = map.get(row.userId);
    if (!set) {
      set = new Set();
      map.set(row.userId, set);
    }
    set.add(row.type);
  }
  return map;
}

/**
 * The full preference list for the FE toggle page. Returns one entry
 * per known type, with `muted` reflecting the stored row OR the
 * default-unmuted policy if no row exists. Order matches
 * NOTIFICATION_TYPES so the UI doesn't have to sort.
 */
export async function getPreferences(userId: string): Promise<NotificationPreferenceRow[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { type: true, muted: true },
  });
  const stored = new Map(rows.map((r) => [r.type, r.muted] as const));

  return NOTIFICATION_TYPES.map((meta) => ({
    type: meta.type,
    muted: stored.get(meta.type) ?? false,
  }));
}

/**
 * Set the `muted` flag for a single (user, type) pair. Idempotent
 * via upsert — calling twice with the same value is a no-op at the
 * DB level.
 *
 * Throws ValidationError if the type isn't in our known set — keeps
 * `notification_preferences.type` from filling up with FE typos.
 */
export async function setMuted(
  userId: string,
  type: string,
  muted: boolean,
): Promise<NotificationPreferenceRow> {
  if (!isKnownNotificationType(type)) {
    throw new ValidationError(`Unknown notification type: ${type}`);
  }
  const row = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, muted },
    update: { muted },
    select: { type: true, muted: true },
  });
  return row;
}

/**
 * Bulk replace — accepts the full toggle list the FE submits and
 * writes them all in one transaction. Used by the Profile page's
 * "Save preferences" action when the user has flipped multiple
 * toggles before saving.
 *
 * Unknown types are filtered out silently (logging would just spam
 * the dev console if a stale FE build has a removed type — the
 * server is the source of truth). If the FE is current, every entry
 * passes the filter.
 */
export async function bulkUpdate(
  userId: string,
  preferences: readonly NotificationPreferenceRow[],
): Promise<NotificationPreferenceRow[]> {
  const valid = preferences.filter((p) => isKnownNotificationType(p.type));
  if (valid.length === 0) return getPreferences(userId);

  await prisma.$transaction(
    valid.map((p) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type: p.type } },
        create: { userId, type: p.type, muted: p.muted },
        update: { muted: p.muted },
      }),
    ),
  );

  return getPreferences(userId);
}
