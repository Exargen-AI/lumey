import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dailyUpdateApi from '@/api/dailyUpdates';

export function useSubmitDailyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dailyUpdateApi.submitDailyUpdate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-daily-updates'] });
      qc.invalidateQueries({ queryKey: ['my-streak'] });
      qc.invalidateQueries({ queryKey: ['my-productivity'] });
      qc.invalidateQueries({ queryKey: ['today-status'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useMyDailyUpdates(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['my-daily-updates', params],
    queryFn: () => dailyUpdateApi.getMyDailyUpdates(params),
  });
}

export function useMyStreak() {
  return useQuery({
    queryKey: ['my-streak'],
    queryFn: dailyUpdateApi.getMyStreak,
  });
}

export function useMyProductivity(daysBack = 7) {
  return useQuery({
    queryKey: ['my-productivity', daysBack],
    queryFn: () => dailyUpdateApi.getMyProductivityStats(daysBack),
  });
}

export function useTodayStatus() {
  return useQuery({
    queryKey: ['today-status'],
    queryFn: dailyUpdateApi.getTodayStatus,
  });
}
