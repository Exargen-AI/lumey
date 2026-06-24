/**
 * Pulse — SUPER_ADMIN-only API client (2026-05-28).
 *
 * Mirrors the admin surface in `backend/src/routes/pulse.routes.ts`.
 * Types come from the shared package so request/response shapes can't
 * drift between FE + BE.
 */

import api from './client';
import type {
  CreateEnrollmentTokenRequest,
  CreateEnrollmentTokenResponse,
  EnrollmentTokenSummary,
  PulseAlertsResponse,
  PulseDeviceDetail,
  PulseDeviceSummary,
  PulseEmployeeDetail,
  PulseEmployeeSummary,
  PulseOverview,
  PulseRiskAlert,
} from '@exargen/shared';
import {
  DeviceAlertSeverity,
  DeviceEnrollmentStatus,
  DeviceRiskLevel,
} from '@exargen/shared';

export interface ListDevicesParams {
  riskLevel?: DeviceRiskLevel;
  status?: DeviceEnrollmentStatus;
  search?: string;
}

export async function getPulseOverview(): Promise<PulseOverview> {
  const { data } = await api.get('/admin/pulse/overview');
  return data.data;
}

export async function listPulseDevices(
  params: ListDevicesParams = {},
): Promise<PulseDeviceSummary[]> {
  const { data } = await api.get('/admin/pulse/devices', { params });
  return data.data;
}

export async function getPulseDevice(id: string): Promise<PulseDeviceDetail> {
  const { data } = await api.get(`/admin/pulse/devices/${id}`);
  return data.data;
}

export async function revokePulseDevice(id: string, reason?: string) {
  const { data } = await api.post(`/admin/pulse/devices/${id}/revoke`, {
    reason,
  });
  return data.data;
}

export async function reassignPulseDevice(id: string, ownerUserId: string | null) {
  const { data } = await api.post(`/admin/pulse/devices/${id}/reassign`, {
    ownerUserId,
  });
  return data.data;
}

export async function createPulseEnrollmentToken(
  body: CreateEnrollmentTokenRequest,
): Promise<CreateEnrollmentTokenResponse> {
  const { data } = await api.post('/admin/pulse/enrollment-tokens', body);
  return data.data;
}

export async function listPulseEnrollmentTokens(opts?: {
  includeConsumed?: boolean;
  includeExpired?: boolean;
}): Promise<EnrollmentTokenSummary[]> {
  const { data } = await api.get('/admin/pulse/enrollment-tokens', {
    params: opts,
  });
  return data.data;
}

export async function revokePulseEnrollmentToken(id: string) {
  const { data } = await api.post(`/admin/pulse/enrollment-tokens/${id}/revoke`);
  return data.data;
}

export interface ListAlertsParams {
  severity?: DeviceAlertSeverity;
  includeResolved?: boolean;
  limit?: number;
}

export async function listPulseAlerts(
  params: ListAlertsParams = {},
): Promise<PulseAlertsResponse['alerts']> {
  const { data } = await api.get('/admin/pulse/alerts', { params });
  return data.data;
}

export async function resolvePulseAlert(
  id: string,
  resolutionNote?: string,
): Promise<PulseRiskAlert> {
  const { data } = await api.post(`/admin/pulse/alerts/${id}/resolve`, {
    resolutionNote,
  });
  return data.data;
}

// 2026-05-29 — Per-employee admin views.
export async function listPulseEmployees(): Promise<PulseEmployeeSummary[]> {
  const { data } = await api.get('/admin/pulse/employees');
  return data.data;
}

export async function getPulseEmployee(userId: string): Promise<PulseEmployeeDetail> {
  const { data } = await api.get(`/admin/pulse/employees/${userId}`);
  return data.data;
}
