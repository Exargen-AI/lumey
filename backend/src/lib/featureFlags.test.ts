/**
 * Feature flag scaffold — unit tests.
 *
 * Verifies the env-driven flag reader handles the truthy variants
 * (1, true, yes, on, case-insensitive) and rejects everything else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, withFeature } from './featureFlags';

describe('featureFlags', () => {
  const ENV_VAR = 'FEATURE_PULSE_COMPOSITE_SCORE_BETA';
  const ORIGINAL = process.env[ENV_VAR];

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = ORIGINAL;
  });

  describe('isFeatureEnabled', () => {
    it('returns false when env var is unset', () => {
      expect(isFeatureEnabled('pulseCompositeScore.beta')).toBe(false);
    });

    it('returns true for truthy values', () => {
      for (const truthy of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'ON']) {
        process.env[ENV_VAR] = truthy;
        expect(isFeatureEnabled('pulseCompositeScore.beta')).toBe(true);
      }
    });

    it('returns false for falsy / unknown values', () => {
      for (const falsy of ['0', 'false', 'no', 'off', '', 'enabled', 'yep', 'banana']) {
        process.env[ENV_VAR] = falsy;
        expect(isFeatureEnabled('pulseCompositeScore.beta')).toBe(false);
      }
    });

    it('strips surrounding whitespace', () => {
      process.env[ENV_VAR] = '  true  ';
      expect(isFeatureEnabled('pulseCompositeScore.beta')).toBe(true);
    });
  });

  describe('withFeature', () => {
    it('runs the function when the flag is on', async () => {
      process.env[ENV_VAR] = 'true';
      const result = await withFeature('pulseCompositeScore.beta', () => 'computed', 'fallback');
      expect(result).toBe('computed');
    });

    it('returns the fallback when the flag is off', async () => {
      const result = await withFeature('pulseCompositeScore.beta', () => 'computed', 'fallback');
      expect(result).toBe('fallback');
    });

    it('supports async functions', async () => {
      process.env[ENV_VAR] = 'true';
      const result = await withFeature(
        'pulseCompositeScore.beta',
        async () => Promise.resolve(42),
        0,
      );
      expect(result).toBe(42);
    });
  });
});
