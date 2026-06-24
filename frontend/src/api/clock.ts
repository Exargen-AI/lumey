/**
 * Clock In / Clock Out API (2026-05-28b).
 *
 * Self-service: any authenticated user can clock in / out and read
 * their own today status. The SUPER_ADMIN-only team view is on the
 * Pulse module (api/pulse.ts).
 */

import api from './client';
import type { ClockStatusResponse, ClockSessionDTO, TeamClockEntry } from '@exargen/shared';

export async function clockIn(note?: string): Promise<ClockSessionDTO> {
  const { data } = await api.post('/clock/in', { note });
  return data.data;
}

export async function clockOut(note?: string): Promise<ClockSessionDTO> {
  const { data } = await api.post('/clock/out', { note });
  return data.data;
}

export async function getMyClockStatus(): Promise<ClockStatusResponse> {
  const { data } = await api.get('/clock/me/today');
  return data.data;
}

export async function getTeamClockStatus(date?: string): Promise<TeamClockEntry[]> {
  const { data } = await api.get('/admin/pulse/clock/team', {
    params: date ? { date } : undefined,
  });
  return data.data;
}

export async function getDeviceProductivity(deviceId: string, days = 7) {
  const { data } = await api.get(`/admin/pulse/devices/${deviceId}/productivity`, {
    params: { days },
  });
  return data.data as {
    deviceId: string;
    days: {
      date: string;
      activeSeconds: number;
      idleSeconds: number;
      lockedSeconds: number;
      offSeconds: number;
      snapshotCount: number;
    }[];
  };
}
