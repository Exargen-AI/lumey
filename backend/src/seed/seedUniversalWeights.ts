/**
 * Pulse productivity score — seed the initial universal weights row.
 *
 * The `universal_weight_sets` table is append-only history. The
 * latest row by `effectiveFrom` is the active set. On a fresh DB
 * there are 0 rows; the recompute worker falls back to the in-code
 * defaults, but we still want a real DB row so the audit trail says
 * "from <date>, these were the active weights" instead of "we
 * mysteriously had no record."
 *
 * Idempotent: only inserts when there are 0 rows. Safe to run on
 * every boot.
 *
 * `updatedBy` is required by the schema. We attribute the seed to the
 * first SUPER_ADMIN user we find. On a brand-new DB before any user
 * exists, the seed is a no-op — the first SUPER_ADMIN's first
 * scoring-tab visit will trigger their service to seed.
 */

import type { PrismaClient } from '@prisma/client';
import {
  SIGNAL_BASELINES_DEFAULT,
  UNIVERSAL_WEIGHTS_R5,
  SCORE_THRESHOLD_HIGH_DEFAULT,
  SCORE_THRESHOLD_LOW_DEFAULT,
} from '@exargen/shared';

export async function seedUniversalWeights(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.universalWeightSet.findFirst();
  if (existing) return;

  const seedUser = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!seedUser) {
    // No SUPER_ADMIN yet (brand-new DB before bootstrap). Bail; the
    // seed will fire on the next boot once a user exists.
    return;
  }

  await prisma.universalWeightSet.create({
    data: {
      weights: { ...UNIVERSAL_WEIGHTS_R5 },
      signalBaselines: { ...SIGNAL_BASELINES_DEFAULT },
      thresholdHigh: SCORE_THRESHOLD_HIGH_DEFAULT,
      thresholdLow: SCORE_THRESHOLD_LOW_DEFAULT,
      effectiveFrom: new Date(),
      updatedBy: seedUser.id,
      changeNote:
        'Initial seed of R5 universal weights. STANDUP=0.13, EXECUTION=0.22, CODE=0.10, COMMUNICATION=0.10, PRESENCE=0.18, DEEP_WORK=0.22, DEVICE_HYGIENE=0.05.',
    },
  });
}
