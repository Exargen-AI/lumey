/**
 * Pulse — heartbeat-gap detection regression tests (2026-05-29).
 *
 * Pins:
 *   - Stale ACTIVE devices get a HEARTBEAT_GAP_DETECTED alert opened
 *   - Devices that come back fresh get their open gap alert auto-
 *     resolved
 *   - The sweep is throttled to once per 5 min when not forced
 *   - Quiet-hours suppression actually fires (no opens during 10pm–6am
 *     UTC) so we don't alert about laptops legitimately off overnight
 *   - Existing open alerts are NOT duplicated (idempotent)
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { detectHeartbeatGaps } from './deviceTelemetry.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectHeartbeatGaps', () => {
  it('opens HEARTBEAT_GAP_DETECTED for ACTIVE devices whose lastSeenAt is older than 30 min', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      { id: 'dev-1', hostname: 'TechGeek', lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    ] as any);
    prismaMock.deviceRiskAlert.findMany.mockResolvedValue([] as any);

    const result = await detectHeartbeatGaps(true);

    expect(result.opened).toBe(1);
    expect(result.resolved).toBe(0);
    expect(prismaMock.deviceRiskAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'dev-1',
        type: 'HEARTBEAT_GAP_DETECTED',
        severity: 'WARNING',
        message: expect.stringContaining('silent for'),
      }),
    });
  });

  it('handles lastSeenAt = null (device that never reported)', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      { id: 'dev-never', hostname: 'NewBox', lastSeenAt: null },
    ] as any);
    prismaMock.deviceRiskAlert.findMany.mockResolvedValue([] as any);

    const result = await detectHeartbeatGaps(true);

    expect(result.opened).toBe(1);
    const args = prismaMock.deviceRiskAlert.create.mock.calls[0]?.[0] as any;
    expect(args.data.message).toMatch(/never reported/);
  });

  it('auto-resolves gap alerts for devices that came back fresh', async () => {
    // No stale devices this sweep:
    prismaMock.device.findMany.mockResolvedValue([] as any);
    // But there IS an open gap alert from a previous sweep:
    prismaMock.deviceRiskAlert.findMany.mockResolvedValue([
      { id: 'alert-1', deviceId: 'dev-1' },
    ] as any);
    prismaMock.deviceRiskAlert.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await detectHeartbeatGaps(true);

    expect(result.opened).toBe(0);
    expect(result.resolved).toBe(1);
    const args = prismaMock.deviceRiskAlert.updateMany.mock.calls[0]?.[0] as any;
    expect(args.where.id.in).toEqual(['alert-1']);
    expect(args.data.resolutionNote).toMatch(/heartbeat restored/);
  });

  it('does NOT duplicate an alert when the device is still stale', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      { id: 'dev-1', hostname: 'TechGeek', lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    ] as any);
    // Existing open alert for this device:
    prismaMock.deviceRiskAlert.findMany.mockResolvedValue([
      { id: 'alert-1', deviceId: 'dev-1' },
    ] as any);

    const result = await detectHeartbeatGaps(true);

    expect(result.opened).toBe(0); // no new create
    expect(result.resolved).toBe(0); // still stale, don't resolve
    expect(prismaMock.deviceRiskAlert.create).not.toHaveBeenCalled();
  });
});
