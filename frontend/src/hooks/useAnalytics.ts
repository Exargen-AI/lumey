import { useQuery } from '@tanstack/react-query';
import * as analyticsApi from '@/api/analytics';

interface QueryOptions {
  enabled?: boolean;
}

export function usePortfolioAnalytics(options?: QueryOptions) {
  return useQuery({
    queryKey: ['portfolio-analytics'],
    queryFn: analyticsApi.getPortfolioAnalytics,
    enabled: options?.enabled ?? true,
  });
}

export function useProjectAnalytics(id: string) {
  return useQuery({ queryKey: ['project-analytics', id], queryFn: () => analyticsApi.getProjectAnalytics(id), enabled: !!id });
}

export function useTeamUtilization(options?: QueryOptions) {
  return useQuery({
    queryKey: ['team-utilization'],
    queryFn: analyticsApi.getTeamUtilization,
    enabled: options?.enabled ?? true,
  });
}

export function useVelocityData(weeks?: number) {
  return useQuery({ queryKey: ['velocity', weeks], queryFn: () => analyticsApi.getVelocityData(weeks) });
}

export function useBlockerAging(options?: QueryOptions) {
  return useQuery({
    queryKey: ['blocker-aging'],
    queryFn: analyticsApi.getBlockerAging,
    enabled: options?.enabled ?? true,
  });
}

export function useTaskDistribution(options?: QueryOptions) {
  return useQuery({
    queryKey: ['task-distribution'],
    queryFn: analyticsApi.getTaskDistribution,
    enabled: options?.enabled ?? true,
  });
}
