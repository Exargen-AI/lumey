/**
 * DEVICE_HYGIENE scorer — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { scoreDeviceHygiene } from './deviceHygiene.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeHygieneEvent(
  date: string,
  opts: {
    defenderRatio?: number;
    firewallRatio?: number;
    bitlocker?: boolean;
    rebootDays?: number;
    unsupportedOs?: boolean;
    critical?: number;
    important?: number;
    risky?: number;
    offlineHours?: number;
    occurredAt?: Date;
  } = {},
): ScorerEvent {
  return {
    id: `hyg-${date}`,
    signal: 'DEVICE_HYGIENE',
    eventType: 'pulse.daily_hygiene',
    occurredAt: opts.occurredAt ?? new Date(`${date}T23:59:00Z`),
    rawPayload: {
      date,
      defenderEnabledRatio: opts.defenderRatio ?? 1,
      firewallEnabledRatio: opts.firewallRatio ?? 1,
      bitlockerEnabled: opts.bitlocker ?? true,
      rebootPendingDays: opts.rebootDays ?? 0,
      unsupportedOs: opts.unsupportedOs ?? false,
      criticalPatchCount: opts.critical ?? 0,
      importantPatchCount: opts.important ?? 0,
      riskySoftwareCount: opts.risky ?? 0,
      agentOfflineHours: opts.offlineHours ?? 0,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'device_snapshots',
    sourceId: `dh-${date}`,
  };
}

function makeInput(events: ScorerEvent[]): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-01T00:00:00Z'),
    windowEnd: new Date('2026-05-31T00:00:00Z'),
    workingDays: 22,
    events,
    baselines: {},
  };
}

describe('scoreDeviceHygiene', () => {
  it('returns 0 with no events (no data is not good standing)', () => {
    const result = scoreDeviceHygiene(makeInput([]));
    expect(result.score).toBe(0);
    expect(result.rawBreakdown.no_data).toBe(1);
  });

  it('returns 100 for a perfectly hygienic machine', () => {
    const events = [makeHygieneEvent('2026-05-29')];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(100);
  });

  it('penalizes -20 when Defender is fully disabled', () => {
    const events = [makeHygieneEvent('2026-05-29', { defenderRatio: 0 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(80);
    expect(result.rawBreakdown.penalties_applied).toMatchObject({ defender: 20 });
  });

  it('scales Defender penalty proportionally to disabled time', () => {
    const events = [makeHygieneEvent('2026-05-29', { defenderRatio: 0.5 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(90); // -10
  });

  it('penalizes -15 when Firewall is fully disabled', () => {
    const events = [makeHygieneEvent('2026-05-29', { firewallRatio: 0 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(85);
  });

  it('penalizes -15 when BitLocker is off', () => {
    const events = [makeHygieneEvent('2026-05-29', { bitlocker: false })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(85);
  });

  it('penalizes -2 per critical patch (capped at -20)', () => {
    const events = [makeHygieneEvent('2026-05-29', { critical: 5 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(90); // -10
    expect(result.rawBreakdown.penalties_applied).toMatchObject({ critical_patches: 10 });
  });

  it('caps critical-patch penalty at -20', () => {
    const events = [makeHygieneEvent('2026-05-29', { critical: 50 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(80);
  });

  it('penalizes -1 per important patch (capped at -10)', () => {
    const events = [makeHygieneEvent('2026-05-29', { important: 5 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(95);
  });

  it('penalizes -10 when reboot pending >7 days', () => {
    const events = [makeHygieneEvent('2026-05-29', { rebootDays: 10 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(90);
  });

  it('does NOT penalize reboot pending <=7 days', () => {
    const events = [makeHygieneEvent('2026-05-29', { rebootDays: 5 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(100);
  });

  it('penalizes -20 for unsupported OS', () => {
    const events = [makeHygieneEvent('2026-05-29', { unsupportedOs: true })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(80);
  });

  it('penalizes -15 per risky-software entry (capped at -30)', () => {
    const events = [makeHygieneEvent('2026-05-29', { risky: 1 })];
    expect(scoreDeviceHygiene(makeInput(events)).score).toBe(85);

    const events2 = [makeHygieneEvent('2026-05-29', { risky: 3 })];
    expect(scoreDeviceHygiene(makeInput(events2)).score).toBe(70); // capped
  });

  it('penalizes -25 when agent offline >24h in window', () => {
    const events = [makeHygieneEvent('2026-05-29', { offlineHours: 48 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(75);
  });

  it('stacks all penalties on a maximally bad machine', () => {
    const events = [
      makeHygieneEvent('2026-05-29', {
        defenderRatio: 0,
        firewallRatio: 0,
        bitlocker: false,
        critical: 50,
        important: 50,
        rebootDays: 30,
        unsupportedOs: true,
        risky: 5,
        offlineHours: 100,
      }),
    ];
    const result = scoreDeviceHygiene(makeInput(events));
    // 100 - 20 - 15 - 15 - 20 - 10 - 10 - 20 - 30 - 25 = -65 → clamp 0
    expect(result.score).toBe(0);
  });

  it('uses the latest event when multiple snapshots are in the window', () => {
    const events = [
      // Earlier: bad
      makeHygieneEvent('2026-05-01', {
        defenderRatio: 0,
        firewallRatio: 0,
        bitlocker: false,
        occurredAt: new Date('2026-05-01T08:00:00Z'),
      }),
      // Latest: good
      makeHygieneEvent('2026-05-29', {
        occurredAt: new Date('2026-05-29T20:00:00Z'),
      }),
    ];
    const result = scoreDeviceHygiene(makeInput(events));
    // Latest is good → 100
    expect(result.score).toBe(100);
  });

  it('ignores events with gaming flags', () => {
    const events: ScorerEvent[] = [
      {
        ...makeHygieneEvent('2026-05-29', { defenderRatio: 0 }),
        gamingFlag: 'some_flag',
      },
    ];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score).toBe(0); // no data
  });

  it('handles malformed payloads without throwing', () => {
    const events: ScorerEvent[] = [
      {
        id: 'bad',
        signal: 'DEVICE_HYGIENE',
        eventType: 'pulse.daily_hygiene',
        occurredAt: new Date(),
        rawPayload: {},
        scoreDelta: null,
        gamingFlag: null,
        source: 'device_snapshots',
        sourceId: 'bad',
      },
    ];
    expect(() => scoreDeviceHygiene(makeInput(events))).not.toThrow();
  });

  it('rounds score to two decimal places', () => {
    const events = [makeHygieneEvent('2026-05-29', { defenderRatio: 0.333 })];
    const result = scoreDeviceHygiene(makeInput(events));
    expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
  });
});
