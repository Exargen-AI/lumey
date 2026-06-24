/**
 * DEVICE_HYGIENE signal scorer — work-environment professionalism.
 *
 * Measures: is the employee operating their work machine like a
 * professional? Defender on, firewall on, BitLocker on, patches
 * applied, supported OS, agent reporting in.
 *
 * R5 weight: 0.05 (smallest). Hygiene is a small baseline signal
 * after the founder's R5 redistribution — it shows up but doesn't
 * move the needle. A perfectly hygienic machine adds 5 points to the
 * composite; a sloppy one subtracts up to 5. Acts as a tiebreaker.
 *
 * Data source: pulse.daily_hygiene events from deviceTelemetry
 * snapshot ingestion. Each event payload carries the current security
 * posture + missing-patch counts + uptime status. We use the LATEST
 * event in the window (most-recent snapshot is source of truth).
 *
 * Score formula (R5):
 *   start at 100
 *   -20 if Defender disabled (% of window weighted)
 *   -15 if Firewall disabled
 *   -15 if BitLocker disabled
 *   -2 per critical patch missing (capped at -20)
 *   -1 per important patch missing (capped at -10)
 *   -10 if reboot pending >7 days
 *   -20 if unsupported OS
 *   -15 per risky-software entry (capped at -30)
 *   -25 if agent went offline >24h during window
 *   clamp 0-100
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

interface HygienePayload {
  /** "yyyy-mm-dd" in user-local timezone. */
  date: string;
  /** % of window seconds Defender real-time was enabled (0-1). */
  defenderEnabledRatio: number;
  /** % of window seconds Firewall was enabled. */
  firewallEnabledRatio: number;
  bitlockerEnabled: boolean;
  rebootPendingDays: number;
  unsupportedOs: boolean;
  criticalPatchCount: number;
  importantPatchCount: number;
  riskySoftwareCount: number;
  /** Hours the agent was OFFLINE in the window. */
  agentOfflineHours: number;
}

const DEFENDER_PENALTY = 20;
const FIREWALL_PENALTY = 15;
const BITLOCKER_PENALTY = 15;
const CRITICAL_PATCH_PER = 2;
const CRITICAL_PATCH_CAP = 20;
const IMPORTANT_PATCH_PER = 1;
const IMPORTANT_PATCH_CAP = 10;
const REBOOT_PENALTY = 10;
const REBOOT_THRESHOLD_DAYS = 7;
const UNSUPPORTED_OS_PENALTY = 20;
const RISKY_SOFTWARE_PER = 15;
const RISKY_SOFTWARE_CAP = 30;
const AGENT_OFFLINE_PENALTY = 25;
const AGENT_OFFLINE_THRESHOLD_HOURS = 24;

export const scoreDeviceHygiene: Scorer = (input: ScorerInput): SignalScore => {
  const { events } = input;

  // Latest event wins (most recent snapshot represents current device state).
  const sorted = events
    .filter((ev) => ev.eventType === 'pulse.daily_hygiene' && !ev.gamingFlag)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  if (sorted.length === 0) {
    return {
      signal: 'DEVICE_HYGIENE',
      score: 0,
      rawBreakdown: {
        days_covered: 0,
        no_data: 1,
      },
      gamingFlags: [],
    };
  }

  const latest = sorted[0].rawPayload as unknown as HygienePayload;

  // Score starts at 100; each finding subtracts.
  let score = 100;
  const penalties: Record<string, number> = {};

  // Defender penalty scaled by how much of the window it was disabled.
  const defenderRatio = clamp01(safeNumber(latest.defenderEnabledRatio, 1));
  const defenderPenalty = DEFENDER_PENALTY * (1 - defenderRatio);
  if (defenderPenalty > 0) {
    penalties.defender = round2(defenderPenalty);
    score -= defenderPenalty;
  }

  const firewallRatio = clamp01(safeNumber(latest.firewallEnabledRatio, 1));
  const firewallPenalty = FIREWALL_PENALTY * (1 - firewallRatio);
  if (firewallPenalty > 0) {
    penalties.firewall = round2(firewallPenalty);
    score -= firewallPenalty;
  }

  if (latest.bitlockerEnabled === false) {
    penalties.bitlocker = BITLOCKER_PENALTY;
    score -= BITLOCKER_PENALTY;
  }

  const criticalCount = Math.max(0, safeNumber(latest.criticalPatchCount, 0));
  const criticalPenalty = Math.min(CRITICAL_PATCH_CAP, criticalCount * CRITICAL_PATCH_PER);
  if (criticalPenalty > 0) {
    penalties.critical_patches = criticalPenalty;
    score -= criticalPenalty;
  }

  const importantCount = Math.max(0, safeNumber(latest.importantPatchCount, 0));
  const importantPenalty = Math.min(IMPORTANT_PATCH_CAP, importantCount * IMPORTANT_PATCH_PER);
  if (importantPenalty > 0) {
    penalties.important_patches = importantPenalty;
    score -= importantPenalty;
  }

  const rebootDays = safeNumber(latest.rebootPendingDays, 0);
  if (rebootDays > REBOOT_THRESHOLD_DAYS) {
    penalties.reboot_pending = REBOOT_PENALTY;
    score -= REBOOT_PENALTY;
  }

  if (latest.unsupportedOs === true) {
    penalties.unsupported_os = UNSUPPORTED_OS_PENALTY;
    score -= UNSUPPORTED_OS_PENALTY;
  }

  const riskyCount = Math.max(0, safeNumber(latest.riskySoftwareCount, 0));
  const riskyPenalty = Math.min(RISKY_SOFTWARE_CAP, riskyCount * RISKY_SOFTWARE_PER);
  if (riskyPenalty > 0) {
    penalties.risky_software = riskyPenalty;
    score -= riskyPenalty;
  }

  const offlineHours = safeNumber(latest.agentOfflineHours, 0);
  if (offlineHours > AGENT_OFFLINE_THRESHOLD_HOURS) {
    penalties.agent_offline = AGENT_OFFLINE_PENALTY;
    score -= AGENT_OFFLINE_PENALTY;
  }

  return {
    signal: 'DEVICE_HYGIENE',
    score: clamp01_100(score),
    rawBreakdown: {
      days_covered: sorted.length,
      defender_enabled_ratio: round2(defenderRatio),
      firewall_enabled_ratio: round2(firewallRatio),
      bitlocker_enabled: latest.bitlockerEnabled ?? null,
      reboot_pending_days: rebootDays,
      unsupported_os: latest.unsupportedOs ?? null,
      critical_patch_count: criticalCount,
      important_patch_count: importantCount,
      risky_software_count: riskyCount,
      agent_offline_hours: offlineHours,
      penalties_applied: penalties,
    },
    gamingFlags: [],
  };
};

function safeNumber(n: unknown, fallback: number): number {
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  return fallback;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
