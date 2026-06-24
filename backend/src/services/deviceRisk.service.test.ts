/**
 * Pulse — risk-scoring tests (2026-05-28).
 *
 * `computeDeviceRisk` is pure (no Prisma, no I/O). These tests pin the
 * rubric: each penalty fires under exactly the conditions documented in
 * deviceRisk.service.ts, the score is properly capped, and bands match
 * the documented thresholds.
 *
 * If the rubric changes intentionally, these tests should change with
 * it AND the `SCORING_VERSION` constant should bump (so historical
 * snapshots remain interpretable).
 */

import { describe, it, expect } from 'vitest';
import { computeDeviceRisk, SCORING_VERSION, type RiskInputs } from './deviceRisk.service';

const NOW = new Date('2026-05-28T12:00:00Z');

function baseInputs(): RiskInputs {
  return {
    defenderEnabled: true,
    firewallEnabled: true,
    bitlockerEnabled: true,
    rebootRequired: false,
    pendingRebootSince: null,
    unsupportedOs: false,
    missingPatchCount: 0,
    criticalPatchCount: 0,
    riskySoftwareCount: 0,
    secondsSinceLastSeen: 60,
    now: NOW,
  };
}

describe('computeDeviceRisk — clean baseline', () => {
  it('scores 100 / HEALTHY with no penalties', () => {
    const result = computeDeviceRisk(baseInputs());
    expect(result.score).toBe(100);
    expect(result.level).toBe('HEALTHY');
    expect(result.penalties).toEqual([]);
  });
});

describe('computeDeviceRisk — individual penalties', () => {
  it('agent offline > 24h fires AGENT_OFFLINE (-30)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      secondsSinceLastSeen: 25 * 60 * 60,
    });
    expect(result.penalties.find((p) => p.kind === 'AGENT_OFFLINE')?.penalty).toBe(30);
    expect(result.score).toBe(70);
  });

  it('null secondsSinceLastSeen (never reported) is treated as offline', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      secondsSinceLastSeen: null,
    });
    expect(result.penalties.some((p) => p.kind === 'AGENT_OFFLINE')).toBe(true);
  });

  it('antivirus disabled fires -20', () => {
    const result = computeDeviceRisk({ ...baseInputs(), defenderEnabled: false });
    expect(result.penalties.find((p) => p.kind === 'ANTIVIRUS_DISABLED')?.penalty).toBe(20);
    expect(result.score).toBe(80);
  });

  it('firewall disabled fires -15', () => {
    const result = computeDeviceRisk({ ...baseInputs(), firewallEnabled: false });
    expect(result.penalties.find((p) => p.kind === 'FIREWALL_DISABLED')?.penalty).toBe(15);
  });

  it('bitlocker disabled fires -15', () => {
    const result = computeDeviceRisk({ ...baseInputs(), bitlockerEnabled: false });
    expect(result.penalties.find((p) => p.kind === 'BITLOCKER_DISABLED')?.penalty).toBe(15);
  });

  it('unsupported OS fires -20', () => {
    const result = computeDeviceRisk({ ...baseInputs(), unsupportedOs: true });
    expect(result.penalties.find((p) => p.kind === 'UNSUPPORTED_OS')?.penalty).toBe(20);
  });

  it('null security flags do NOT fire penalties (concept N/A on this platform)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      defenderEnabled: null,
      firewallEnabled: null,
      bitlockerEnabled: null,
      unsupportedOs: null,
    });
    expect(result.penalties.find((p) => p.kind === 'ANTIVIRUS_DISABLED')).toBeUndefined();
    expect(result.score).toBe(100);
  });
});

describe('computeDeviceRisk — reboot age tiers', () => {
  it('reboot required but pendingSince unknown → warning tier (-10)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      rebootRequired: true,
      pendingRebootSince: null,
    });
    expect(result.penalties.find((p) => p.kind === 'REBOOT_REQUIRED')?.penalty).toBe(10);
  });

  it('reboot pending < 7 days → no penalty (recent, give it time)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      rebootRequired: true,
      pendingRebootSince: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    expect(result.penalties.find((p) => p.kind === 'REBOOT_REQUIRED')).toBeUndefined();
  });

  it('reboot pending 8-30 days → -10', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      rebootRequired: true,
      pendingRebootSince: new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000),
    });
    expect(result.penalties.find((p) => p.kind === 'REBOOT_REQUIRED')?.penalty).toBe(10);
  });

  it('reboot pending > 30 days → -20 (overdue tier)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      rebootRequired: true,
      pendingRebootSince: new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000),
    });
    expect(result.penalties.find((p) => p.kind === 'REBOOT_REQUIRED')?.penalty).toBe(20);
  });
});

describe('computeDeviceRisk — cumulative caps', () => {
  it('critical patches: cap at -30 (after 6+ patches)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      criticalPatchCount: 20,
      missingPatchCount: 20,
    });
    const patchPenalty = result.penalties.find((p) => p.kind === 'MISSING_CRITICAL_PATCHES')!;
    expect(patchPenalty.penalty).toBe(30);
  });

  it('risky software: cap at -30 (after 3+ apps)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      riskySoftwareCount: 10,
    });
    const softwarePenalty = result.penalties.find(
      (p) => p.kind === 'RISKY_SOFTWARE_INSTALLED',
    )!;
    expect(softwarePenalty.penalty).toBe(30);
  });

  it('one critical patch → -5', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      criticalPatchCount: 1,
      missingPatchCount: 1,
    });
    expect(result.penalties.find((p) => p.kind === 'MISSING_CRITICAL_PATCHES')?.penalty).toBe(5);
  });
});

describe('computeDeviceRisk — band thresholds', () => {
  it('score 80 → HEALTHY (boundary inclusive)', () => {
    const result = computeDeviceRisk({ ...baseInputs(), defenderEnabled: false });
    expect(result.score).toBe(80);
    expect(result.level).toBe('HEALTHY');
  });

  it('score 79 → AT_RISK', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      defenderEnabled: false, // -20
      criticalPatchCount: 1,  // -5
      missingPatchCount: 1,
    });
    expect(result.score).toBe(75);
    expect(result.level).toBe('AT_RISK');
  });

  it('score 50 → AT_RISK (boundary inclusive)', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      defenderEnabled: false, // -20
      firewallEnabled: false, // -15
      bitlockerEnabled: false, // -15
    });
    expect(result.score).toBe(50);
    expect(result.level).toBe('AT_RISK');
  });

  it('score 49 → CRITICAL', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      defenderEnabled: false, // -20
      firewallEnabled: false, // -15
      bitlockerEnabled: false, // -15
      criticalPatchCount: 1,  // -5
      missingPatchCount: 1,
    });
    expect(result.score).toBe(45);
    expect(result.level).toBe('CRITICAL');
  });

  it('score floors at 0 — never negative', () => {
    const result = computeDeviceRisk({
      ...baseInputs(),
      secondsSinceLastSeen: null,    // -30
      defenderEnabled: false,         // -20
      firewallEnabled: false,         // -15
      bitlockerEnabled: false,        // -15
      unsupportedOs: true,            // -20
      rebootRequired: true,
      pendingRebootSince: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000), // -20
      criticalPatchCount: 10,
      missingPatchCount: 10,          // -30 (capped)
      riskySoftwareCount: 10,         // -30 (capped)
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe('CRITICAL');
  });
});

describe('SCORING_VERSION', () => {
  it('is exported so historical snapshots can be tagged', () => {
    expect(SCORING_VERSION).toBe(1);
  });
});
