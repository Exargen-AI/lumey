import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as timesheetApi from '@/api/timesheet';

export function useWeeklyTimesheet(weekStart?: string) {
  return useQuery({
    queryKey: ['weekly-timesheet', weekStart],
    queryFn: () => timesheetApi.getWeeklyTimesheet(weekStart),
  });
}

export function useTimesheetStatus(weekStart?: string) {
  return useQuery({
    queryKey: ['timesheet-status', weekStart],
    queryFn: () => timesheetApi.getTimesheetStatus(weekStart),
  });
}

export function useLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.logTime,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-timesheet'] }),
  });
}

export function useBulkLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.bulkLogTime,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-timesheet'] }),
  });
}

export function useSubmitTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.submitTimesheet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet-status'] });
      qc.invalidateQueries({ queryKey: ['weekly-timesheet'] });
    },
  });
}

export function useReopenTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.reopenTimesheet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet-status'] });
      qc.invalidateQueries({ queryKey: ['weekly-timesheet'] });
    },
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.deleteTimeEntry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-timesheet'] }),
  });
}

/**
 * Approvals tab data. The query key is namespaced so EVERY tab shares the
 * `['timesheet-approvals']` prefix — that lets approve/reject mutations
 * blow the entire group away in one `invalidateQueries` call rather than
 * having to enumerate each tab.
 *
 * Polls every 30 s so a freshly-submitted timesheet shows up in the queue
 * even if the admin already had the page open. Without this, only a
 * window refocus or full reload would surface new work — the original
 * "I approved but the next one isn't appearing" complaint.
 */
export function usePendingApprovals(status?: timesheetApi.ApprovalStatusFilter) {
  return useQuery({
    queryKey: ['timesheet-approvals', status ?? 'SUBMITTED'],
    queryFn: () => timesheetApi.getPendingApprovals(status),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useApprovalCounts(enabled = true) {
  return useQuery({
    queryKey: ['timesheet-approvals', 'counts'],
    queryFn: timesheetApi.getApprovalCounts,
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useApproveTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: timesheetApi.approveTimesheet,
    // Prefix-match invalidation: refreshes every status tab AND the count
    // badges in one shot.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheet-approvals'] }),
  });
}

export function useRejectTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => timesheetApi.rejectTimesheet(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheet-approvals'] }),
  });
}
