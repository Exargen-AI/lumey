import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as leaveApi from '@/api/leaves';
import type { LeaveStatus } from '@/api/leaves';

export function useMyLeaves() {
  return useQuery({ queryKey: ['leaves', 'my'], queryFn: leaveApi.getMyLeaves });
}

/**
 * Approver queue / history list. Polls every 30 s so a leave that an
 * employee files while the admin already has this page open lands in the
 * UI without a manual reload — that was the original "I applied but
 * Pankaj doesn't see it" report. Window-focus refetch is also on (which
 * is the React Query default, declared explicitly here for clarity).
 */
export function useAllLeaves(status?: LeaveStatus) {
  return useQuery({
    queryKey: ['leaves', 'all', status ?? 'all'],
    queryFn: () => leaveApi.listAllLeaves(status),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useApplyLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: leaveApi.applyLeave,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
  });
}

export function useApproveLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: string; decisionNote?: string }) => leaveApi.approveLeave(id, decisionNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
  });
}

export function useRejectLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: string; decisionNote?: string }) => leaveApi.rejectLeave(id, decisionNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => leaveApi.cancelLeave(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
  });
}

export function usePendingLeaveCount(enabled: boolean) {
  return useQuery({
    queryKey: ['leaves', 'pending-count'],
    queryFn: leaveApi.getPendingLeaveCount,
    enabled,
    refetchInterval: 60_000, // 1-min poll for the sidebar badge
  });
}

export function useLeaveCounts(enabled: boolean) {
  return useQuery({
    queryKey: ['leaves', 'counts'],
    queryFn: leaveApi.getLeaveCounts,
    enabled,
    // Same cadence as useAllLeaves so the tab badges stay in sync with
    // the rendered list.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useRevokeApprovedLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: string; decisionNote: string }) =>
      leaveApi.revokeApprovedLeave(id, decisionNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
  });
}
