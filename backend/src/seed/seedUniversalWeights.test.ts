/**
 * seedUniversalWeights — unit tests.
 *
 * Idempotency contract:
 *   - If a row already exists → no-op (no create call)
 *   - If no row + no SUPER_ADMIN → no-op (bails silently)
 *   - If no row + SUPER_ADMIN exists → one create with R5 defaults
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { seedUniversalWeights } from './seedUniversalWeights';
import { UNIVERSAL_WEIGHTS_R5 } from '@exargen/shared';

describe('seedUniversalWeights', () => {
  beforeEach(() => {
    // mockReset in prismaMock.ts already runs before each test.
  });

  it('is a no-op when a universal_weight_sets row already exists', async () => {
    prismaMock.universalWeightSet.findFirst.mockResolvedValue({
      id: 'existing',
    } as never);

    await seedUniversalWeights(prismaMock as never);

    expect(prismaMock.universalWeightSet.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('bails silently when no SUPER_ADMIN user exists (brand-new DB)', async () => {
    prismaMock.universalWeightSet.findFirst.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);

    await seedUniversalWeights(prismaMock as never);

    expect(prismaMock.universalWeightSet.create).not.toHaveBeenCalled();
  });

  it('inserts R5 defaults attributed to the oldest SUPER_ADMIN', async () => {
    prismaMock.universalWeightSet.findFirst.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'super-admin-1' } as never);
    prismaMock.universalWeightSet.create.mockResolvedValue({} as never);

    await seedUniversalWeights(prismaMock as never);

    expect(prismaMock.universalWeightSet.create).toHaveBeenCalledTimes(1);
    const call = prismaMock.universalWeightSet.create.mock.calls[0]?.[0] as {
      data: {
        weights: Record<string, number>;
        thresholdHigh: number;
        thresholdLow: number;
        updatedBy: string;
        changeNote: string;
      };
    };
    expect(call.data.weights).toEqual(UNIVERSAL_WEIGHTS_R5);
    expect(call.data.thresholdHigh).toBe(75);
    expect(call.data.thresholdLow).toBe(40);
    expect(call.data.updatedBy).toBe('super-admin-1');
    expect(call.data.changeNote).toContain('R5');
  });
});
