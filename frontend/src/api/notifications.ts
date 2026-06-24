import api from './client';

export async function getNotifications(params?: { page?: number; limit?: number }) {
  const { data } = await api.get('/notifications', { params });
  return data.data;
}

export async function getUnreadCount() {
  const { data } = await api.get('/notifications/unread-count');
  return data.data;
}

/**
 * Mark a single notification as read. Backend PR #125 returns
 * `{ updated: number }` and 404s on stale/foreign ids — callers
 * should handle the 404 by removing the row from the local cache
 * (it's already gone server-side).
 */
export async function markAsRead(id: string): Promise<{ updated: number }> {
  const { data } = await api.patch(`/notifications/${id}/read`);
  return data.data ?? { updated: 1 };
}

/**
 * Mark every unread notification as read. Returns the count so the
 * caller can decrement the unread-badge state directly instead of
 * refetching `getUnreadCount`. Backend PR #125.
 */
export async function markAllAsRead(): Promise<{ updated: number }> {
  const { data } = await api.patch('/notifications/read-all');
  return data.data ?? { updated: 0 };
}

/**
 * Delete a notification. Backend PR #125 — closes the universal
 * "inbox graveyard" gap where mark-as-read flipped the row to
 * read=true but never removed it. 404 on stale/foreign ids
 * (already gone server-side); caller should treat as success +
 * remove from local cache.
 */
export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

// ── Notification preferences (mute by type) ─────────────────────────────

export interface NotificationPreference {
  type: string;
  muted: boolean;
}

export interface NotificationTypeMeta {
  type: string;
  label: string;
  description: string;
  category: string;
}

export interface NotificationCategoryMeta {
  label: string;
  description: string;
}

export interface NotificationPreferencesPayload {
  preferences: NotificationPreference[];
  types: NotificationTypeMeta[];
  categories: Record<string, NotificationCategoryMeta>;
}

/**
 * Fetch the user's full preference list + the type/category metadata
 * needed to render the toggle UI. One round-trip, no client-side
 * source-of-truth duplication — the backend owns the authoritative
 * list at `constants/notificationTypes.ts`.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferencesPayload> {
  const { data } = await api.get('/notifications/preferences');
  return data.data;
}

/**
 * Flip a single (type) toggle. The backend upserts so calling twice
 * with the same value is a no-op. Returns the persisted row so the
 * caller can optimistically reflect server state.
 */
export async function setNotificationPreference(type: string, muted: boolean): Promise<NotificationPreference> {
  const { data } = await api.patch(`/notifications/preferences/${type}`, { muted });
  return data.data;
}

/**
 * Bulk save — submits every preference the user has touched in a
 * single transaction. Used for the "Save preferences" action when
 * multiple toggles have changed.
 */
export async function bulkUpdateNotificationPreferences(
  preferences: NotificationPreference[],
): Promise<NotificationPreference[]> {
  const { data } = await api.put('/notifications/preferences', { preferences });
  return data.data.preferences;
}
