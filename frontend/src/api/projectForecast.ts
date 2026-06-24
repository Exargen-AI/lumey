import api from './client';

/** Mirrors `ProjectForecast` in shared/. Kept duplicated to keep the
 *  frontend bundle independent of the shared package transpilation. */
export type ForecastStatus = 'BASELINING' | 'NO_TARGET' | 'COMPLETE' | 'FORECASTED';
export type DeliveryStatus = 'ON_TRACK' | 'AT_RISK' | 'BEHIND';

export interface ProjectForecast {
  status: ForecastStatus;
  message: string;
  reason?: string;
  totalPoints?: number;
  donePoints?: number;
  remainingPoints?: number;
  completionPct?: number;
  velocityPerWeek?: number;
  velocityStdDev?: number;
  weeklyVelocityHistory?: number[];
  conservativeDate?: string;
  expectedDate?: string;
  optimisticDate?: string;
  targetDate?: string;
  daysFromTarget?: number;
  deliveryStatus?: DeliveryStatus;
}

export async function getProjectForecast(projectId: string): Promise<ProjectForecast> {
  const { data } = await api.get(`/projects/${projectId}/forecast`);
  return data.data;
}
