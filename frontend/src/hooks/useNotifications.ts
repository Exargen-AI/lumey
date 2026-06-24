import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as notifApi from '@/api/notifications';

export function useNotifications(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () => notifApi.getNotifications(params),
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: notifApi.getUnreadCount,
    refetchInterval: 15000, // Poll every 15s
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notifApi.markAsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notifApi.markAllAsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

/**
 * Delete a notification entirely. Backend PR #125 — closes the
 * universal "inbox graveyard" gap. The mutation invalidates both
 * the notifications list AND the unread-count (the deleted row
 * might have been unread; safer to refetch than to compute the
 * delta client-side).
 *
 * A 404 from the server (stale id, already-deleted, foreign user)
 * is treated as success — the row is gone server-side and we
 * remove it from the local cache the same way.
 */
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notifApi.deleteNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
    onError: (err: any) => {
      // 404 means the row is already gone — refresh the cache
      // anyway so the UI matches the server's state.
      if (err?.response?.status === 404) {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        qc.invalidateQueries({ queryKey: ['unread-count'] });
      }
    },
  });
}
