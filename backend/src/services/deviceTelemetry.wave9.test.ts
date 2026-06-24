/**
 * Wave 9 — deviceTelemetry service tests for the new agent-resilience
 * fields: heartbeat self-health, kill-switch revoke flag, snapshot
 * battery / disk / network / background-tamper-process plumbing.
 *
 * Existing tests live in devicePulse.service.test.ts (snapshot risk
 * scoring) and deviceTelemetry.gap.test.ts (heartbeat-gap alerts).
 * Wave 9 adds new surface so we keep its tests separate to avoid
 * thrashing those files.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ingestHeartbeat } from './deviceTelemetry.service';

// `ingestHeartbeat` fires `void detectHeartbeatGaps()` as a
// fire-and-forget side effect. The default prismaMock returns
// `undefined` for unmocked findMany calls, which trips that
// background work and surfaces as an unhandled rejection at the end
// of the suite. Stubbing both findMany calls with empty arrays keeps
// the background work happy without leaking into our assertions.
beforeEach(() => {
  prismaMock.device.findMany.mockResolvedValue([] as never);
  prismaMock.deviceRiskAlert.findMany.mockResolvedValue([] as never);
});

describe('ingestHeartbeat — Wave 9 self-health passthrough', () => {
  it('writes lastCpuPercent + lastMemoryMb when present', async () => {
    prismaMock.device.update.mockResolvedValue({} as never);
    await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 1234,
      agentVersion: '0.2.0',
      cpuPercent: 12.5,
      memoryMb: 78.9,
      errorCount: 3,
      lastErrorAt: new Date('2026-05-30T10:00:00Z'),
      lastErrorMessage: 'snapshot failed: ECONNREFUSED',
    });

    expect(prismaMock.device.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.device.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe('dev-1');
    expect(call.data.lastCpuPercent).toBe(12.5);
    expect(call.data.lastMemoryMb).toBe(78.9);
    expect(call.data.agentErrorCount).toBe(3);
    expect(call.data.agentLastErrorMessage).toBe('snapshot failed: ECONNREFUSED');
  });

  it('omits self-health fields cleanly when not sent (back-compat with pre-Wave-9 agents)', async () => {
    prismaMock.device.update.mockResolvedValue({} as never);
    await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 1234,
      agentVersion: '0.1.0',
    });

    expect(prismaMock.device.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.device.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.lastCpuPercent).toBeUndefined();
    expect(call.data.lastMemoryMb).toBeUndefined();
    expect(call.data.agentErrorCount).toBeUndefined();
    expect(call.data.agentLastErrorMessage).toBeUndefined();
  });
});

describe('ingestHeartbeat — Wave 9 remote kill switch', () => {
  it('returns revoked:true when the route layer marks the device as revoked', async () => {
    prismaMock.device.update.mockResolvedValue({} as never);
    const result = await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 100,
      agentVersion: '0.2.0',
      isRevoked: true,
    });
    expect(result.revoked).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.nextHeartbeatInSeconds).toBe(300);
  });

  it('returns revoked:false (default) when isRevoked is omitted or false', async () => {
    prismaMock.device.update.mockResolvedValue({} as never);
    const result1 = await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 100,
      agentVersion: '0.2.0',
    });
    expect(result1.revoked).toBe(false);

    const result2 = await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 100,
      agentVersion: '0.2.0',
      isRevoked: false,
    });
    expect(result2.revoked).toBe(false);
  });

  it('records the heartbeat (lastSeenAt etc) even when revoked', async () => {
    // We deliberately persist the heartbeat for a revoked device — the
    // dashboard can still show "agent is alive but revoked" and the
    // SUPER_ADMIN can confirm the agent received the kill signal.
    prismaMock.device.update.mockResolvedValue({} as never);
    await ingestHeartbeat({
      deviceId: 'dev-1',
      powerState: 'ON',
      uptimeSeconds: 100,
      agentVersion: '0.2.0',
      isRevoked: true,
    });
    expect(prismaMock.device.update).toHaveBeenCalledTimes(1);
  });
});

describe('ingestHeartbeat — validation still fires regardless of Wave 9 fields', () => {
  it('rejects negative uptime', async () => {
    await expect(
      ingestHeartbeat({
        deviceId: 'dev-1',
        powerState: 'ON',
        uptimeSeconds: -1,
        agentVersion: '0.2.0',
      }),
    ).rejects.toThrow(/uptimeSeconds/);
  });
});
