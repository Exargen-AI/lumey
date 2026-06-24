import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNotificationPreferences,
  setNotificationPreference,
  bulkUpdateNotificationPreferences,
  type NotificationPreference,
} from '@/api/notifications';

const KEY = ['notification-preferences'] as const;

/**
 * Fetch the user's notification mute preferences + the type metadata
 * needed to render the toggle UI. Cached indefinitely until a
 * mutation invalidates — the data doesn't change without the user
 * acting on it.
 */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: KEY,
    queryFn: getNotificationPreferences,
    staleTime: 5 * 60 * 1000, // 5 min — preferences rarely change
  });
}

/**
 * Single-toggle flip. Invalidates the preferences query so the UI
 * re-renders with the canonical server state. Optimistic update isn't
 * worth the complexity for a single boolean — the round-trip is
 * ~30ms and the toggle is debounced naturally by user interaction.
 */
export function useSetNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, muted }: NotificationPreference) =>
      setNotificationPreference(type, muted),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/**
 * Bulk save — used by "Save all preferences" when many toggles have
 * been flipped. Same invalidation pattern.
 */
export function useBulkUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreference[]) =>
      bulkUpdateNotificationPreferences(preferences),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
