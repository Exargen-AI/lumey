/**
 * Pulse — Device risk scoring (2026-05-28).
 *
 * Pure(-ish) functions that compute a 0-100 score + a HEALTHY / AT_RISK /
 * CRITICAL band from a set of inputs (security flags, missing-patch
 * counts, risky-software count, last-seen age). Same rubric applies on
 * every snapshot so the score is comparable across time + devices.
 *
 * Rubric (each penalty is independent; final score = max(0, 100 - Σ)):
 *   Agent offline > 24h        : -30
 *   Antivirus disabled         : -20
 *   Firewall disabled          : -15
 *   BitLocker disabled         : -15
 *   Unsupported OS             : -20
 *   Reboot required > 7 days   : -10  (additional -10 if > 30 days)
 *   Per critical missing patch : -5  (capped at -30 cumulative)
 *   Per risky software         : -10 (capped at -30 cumulative)
 *
 * Bands:
 *   HEALTHY   score >= 80
 *   AT_RISK   50 <= score < 80
 *   CRITICAL  score < 50
 *
 * The rubric is intentionally simple so a SUPER_ADMIN can read the
 * device-detail page and reconcile the score against the visible flags
 * without consulting code. When the rubric changes we bump the
 * `scoringVersion` and surface it in the snapshot so old scores remain
 * interpretable.
 */

import { DeviceRiskLevel } from '@prisma/client';

export const SCORING_VERSION = 1;

export interface RiskInputs {
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  bitlockerEnabled: boolean | null;
  rebootRequired: boolean | null;
  pendingRebootSince: Date | null;
  unsupportedOs: boolean | null;
  missingPatchCount: number;
  criticalPatchCount: number;
  riskySoftwareCount: number;
  /**
   * Seconds since the agent last contacted us. Null if the device has
   * never reported (treated as offline). Used by the AGENT_OFFLINE
   * trigger.
   */
  secondsSinceLastSeen: number | null;
  now: Date;
}

export interface RiskResult {
  score: number;
  level: DeviceRiskLevel;
  /**
   * Itemised penalties — surfaced in the API response so the admin UI
   * can show "Why is this device CRITICAL?" without re-running scoring
   * client-side. Each entry is a (kind, penalty, message) tuple.
   */
  penalties: RiskPenalty[];
}

export interface RiskPenalty {
  kind: PenaltyKind;
  penalty: number;
  message: string;
}

export type PenaltyKind =
  | 'AGENT_OFFLINE'
  | 'ANTIVIRUS_DISABLED'
  | 'FIREWALL_DISABLED'
  | 'BITLOCKER_DISABLED'
  | 'UNSUPPORTED_OS'
  | 'REBOOT_REQUIRED'
  | 'MISSING_CRITICAL_PATCHES'
  | 'RISKY_SOFTWARE_INSTALLED';

const OFFLINE_THRESHOLD_SECONDS = 24 * 60 * 60;
const REBOOT_WARNING_DAYS = 7;
const REBOOT_OVERDUE_DAYS = 30;

const MAX_PATCH_PENALTY = 30;
const MAX_SOFTWARE_PENALTY = 30;

export function computeDeviceRisk(input: RiskInputs): RiskResult {
  const penalties: RiskPenalty[] = [];

  if (
    input.secondsSinceLastSeen === null ||
    input.secondsSinceLastSeen > OFFLINE_THRESHOLD_SECONDS
  ) {
    penalties.push({
      kind: 'AGENT_OFFLINE',
      penalty: 30,
      message: 'Agent has not reported in over 24 hours',
    });
  }

  if (input.defenderEnabled === false) {
    penalties.push({
      kind: 'ANTIVIRUS_DISABLED',
      penalty: 20,
      message: 'Antivirus is disabled',
    });
  }
  if (input.firewallEnabled === false) {
    penalties.push({
      kind: 'FIREWALL_DISABLED',
      penalty: 15,
      message: 'Firewall is disabled',
    });
  }
  if (input.bitlockerEnabled === false) {
    penalties.push({
      kind: 'BITLOCKER_DISABLED',
      penalty: 15,
      message: 'Disk encryption is disabled',
    });
  }
  if (input.unsupportedOs === true) {
    penalties.push({
      kind: 'UNSUPPORTED_OS',
      penalty: 20,
      message: 'Operating system is past vendor support',
    });
  }

  if (input.rebootRequired === true) {
    const pendingSince = input.pendingRebootSince;
    let rebootPenalty = 0;
    let rebootMessage = 'Reboot required to apply pending patches';
    if (pendingSince) {
      const days =
        (input.now.getTime() - pendingSince.getTime()) / (1000 * 60 * 60 * 24);
      if (days > REBOOT_OVERDUE_DAYS) {
        rebootPenalty = 20;
        rebootMessage = `Reboot pending for ${Math.floor(days)} days`;
      } else if (days > REBOOT_WARNING_DAYS) {
        rebootPenalty = 10;
        rebootMessage = `Reboot pending for ${Math.floor(days)} days`;
      }
    } else {
      // pendingSince unknown: assume warning-tier penalty.
      rebootPenalty = 10;
    }
    if (rebootPenalty > 0) {
      penalties.push({
        kind: 'REBOOT_REQUIRED',
        penalty: rebootPenalty,
        message: rebootMessage,
      });
    }
  }

  const criticalCount = Math.max(0, input.criticalPatchCount);
  if (criticalCount > 0) {
    const raw = criticalCount * 5;
    penalties.push({
      kind: 'MISSING_CRITICAL_PATCHES',
      penalty: Math.min(MAX_PATCH_PENALTY, raw),
      message: `${criticalCount} critical patch${criticalCount === 1 ? '' : 'es'} missing`,
    });
  }

  const riskyCount = Math.max(0, input.riskySoftwareCount);
  if (riskyCount > 0) {
    const raw = riskyCount * 10;
    penalties.push({
      kind: 'RISKY_SOFTWARE_INSTALLED',
      penalty: Math.min(MAX_SOFTWARE_PENALTY, raw),
      message: `${riskyCount} risky application${riskyCount === 1 ? '' : 's'} installed`,
    });
  }

  const total = penalties.reduce((acc, p) => acc + p.penalty, 0);
  const score = Math.max(0, 100 - total);
  const level: DeviceRiskLevel =
    score >= 80
      ? DeviceRiskLevel.HEALTHY
      : score >= 50
        ? DeviceRiskLevel.AT_RISK
        : DeviceRiskLevel.CRITICAL;

  return { score, level, penalties };
}
