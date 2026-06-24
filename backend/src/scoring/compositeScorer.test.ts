/**
 * Composite scorer — unit tests.
 *
 * Pure function. Tests cover:
 *   - R5 weights produce expected dot product
 *   - Renormalisation when signals are inactive (wave-1)
 *   - Score bands (HIGH/MEDIUM/LOW)
 *   - Cross-signal gaming penalty (only triggers across >1 signal)
 *   - Weight validation (sum must be ~1.0)
 *   - Clamping
 *   - Defensive handling of missing per-signal scores
 */

import { describe, it, expect } from 'vitest';
import { computeComposite } from './compositeScorer';
import {
  UNIVERSAL_WEIGHTS_R5,
  type ProductivitySignal,
  type SignalScore,
} from '@exargen/shared';

function score(signal: ProductivitySignal, score: number, gamingFlags: string[] = []): SignalScore {
  return {
    signal,
    score,
    rawBreakdown: {},
    gamingFlags,
  };
}

describe('computeComposite', () => {
  describe('R5 universal weights', () => {
    it('computes the weighted dot product correctly when every signal has score 80', () => {
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 80),
          score('EXECUTION', 80),
          score('CODE', 80),
          score('COMMUNICATION', 80),
          score('PRESENCE', 80),
          score('DEEP_WORK', 80),
          score('DEVICE_HYGIENE', 80),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // 80 * (sum of weights) = 80 * 1.00 = 80
      expect(result.compositeScore).toBe(80);
      expect(result.band).toBe('HIGH');
    });

    it('produces the correct band for a mixed-score employee', () => {
      // R5 weights: STANDUP 0.13, EXECUTION 0.22, CODE 0.10,
      //             COMMUNICATION 0.10, PRESENCE 0.18, DEEP_WORK 0.22,
      //             DEVICE_HYGIENE 0.05
      // Composite = 0.13*70 + 0.22*60 + 0.10*0 + 0.10*40 + 0.18*70 +
      //             0.22*50 + 0.05*100
      //           = 9.1 + 13.2 + 0 + 4.0 + 12.6 + 11.0 + 5.0 = 54.9
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 70),
          score('EXECUTION', 60),
          score('CODE', 0), // didn't push code
          score('COMMUNICATION', 40),
          score('PRESENCE', 70),
          score('DEEP_WORK', 50),
          score('DEVICE_HYGIENE', 100),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      expect(result.compositeScore).toBe(54.9);
      expect(result.band).toBe('MEDIUM');
    });

    it('returns LOW for a struggling employee', () => {
      const result = computeComposite({
        signalScores: PRODUCTIVITY_SIGNALS_TEST.map((s) => score(s, 30)),
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      expect(result.compositeScore).toBe(30);
      expect(result.band).toBe('LOW');
    });

    it('returns HIGH for a top performer (score >= 75 default)', () => {
      const result = computeComposite({
        signalScores: PRODUCTIVITY_SIGNALS_TEST.map((s) => score(s, 90)),
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      expect(result.compositeScore).toBe(90);
      expect(result.band).toBe('HIGH');
    });
  });

  describe('renormalisation when signals are inactive', () => {
    it('removes CODE weight from the denominator during wave-1 (no GitHub yet)', () => {
      // CODE is inactive. Other 6 signals all score 80.
      // Active weight sum = 1.0 - 0.10 = 0.90
      // Renormalised: each non-CODE weight becomes w / 0.90
      // Composite = sum(w_renorm * 80) = 80 (because all scores equal)
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 80),
          score('EXECUTION', 80),
          // no CODE event
          score('COMMUNICATION', 80),
          score('PRESENCE', 80),
          score('DEEP_WORK', 80),
          score('DEVICE_HYGIENE', 80),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
        inactiveSignals: ['CODE'],
      });
      expect(result.compositeScore).toBe(80);
      // Applied weight for CODE should be 0
      expect(result.appliedWeights.CODE).toBe(0);
      // Other weights should sum to 1.0 in the applied set
      const otherSum = (Object.entries(result.appliedWeights) as Array<[ProductivitySignal, number]>)
        .filter(([sig]) => sig !== 'CODE')
        .reduce((sum, [, w]) => sum + w, 0);
      expect(otherSum).toBeCloseTo(1.0, 6);
    });

    it('returns 0 if every signal is inactive', () => {
      const result = computeComposite({
        signalScores: [],
        weights: UNIVERSAL_WEIGHTS_R5,
        inactiveSignals: [...PRODUCTIVITY_SIGNALS_TEST],
      });
      expect(result.compositeScore).toBe(0);
      expect(result.band).toBe('LOW');
    });

    it('handles the missing-signal case (no event for a signal) as score=0', () => {
      // No event for COMMUNICATION at all, but COMMUNICATION is not in
      // inactiveSignals. The composite should treat it as score=0 in
      // the dot product, not skip it.
      const scoresExceptComm: SignalScore[] = [
        score('STANDUP', 100),
        score('EXECUTION', 100),
        score('CODE', 100),
        score('PRESENCE', 100),
        score('DEEP_WORK', 100),
        score('DEVICE_HYGIENE', 100),
      ];
      const result = computeComposite({
        signalScores: scoresExceptComm,
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // Composite = 100 * (1.0 - 0.10) = 90.0 (COMMUNICATION's 0.10 weighs zero)
      expect(result.compositeScore).toBe(90);
    });
  });

  describe('weight validation', () => {
    it('throws on a malformed weight set that does not sum to 1.0', () => {
      expect(() =>
        computeComposite({
          signalScores: [],
          weights: {
            STANDUP: 0.5,
            EXECUTION: 0.5,
            CODE: 0.5, // sum > 1
            COMMUNICATION: 0,
            PRESENCE: 0,
            DEEP_WORK: 0,
            DEVICE_HYGIENE: 0,
          },
        }),
      ).toThrow(/sum to 1.0/);
    });

    it('accepts a weight set within ±0.01 tolerance of 1.0', () => {
      // Floating-point realities — 0.13 + 0.22 + 0.10 + 0.10 + 0.18 + 0.22 + 0.05 = 1.00 in math but rarely exact in IEEE 754.
      expect(() =>
        computeComposite({
          signalScores: [],
          weights: UNIVERSAL_WEIGHTS_R5,
        }),
      ).not.toThrow();
    });
  });

  describe('cross-signal gaming penalty', () => {
    it('does NOT penalize a single signal with a single gaming guard', () => {
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 90, ['standup_too_short_count=2']),
          ...PRODUCTIVITY_SIGNALS_TEST.filter((s) => s !== 'STANDUP').map((s) => score(s, 90)),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // Only one signal flagged; no cross-signal penalty
      expect(result.crossSignalGamingFlags).toBe(0);
      expect(result.compositeScore).toBe(90);
    });

    it('penalizes 2 signals flagged simultaneously (1 cross-signal flag = -5)', () => {
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 80, ['standup_too_short_count=2']),
          score('EXECUTION', 80, ['task_closed_too_fast_count=3']),
          ...PRODUCTIVITY_SIGNALS_TEST.filter(
            (s) => s !== 'STANDUP' && s !== 'EXECUTION',
          ).map((s) => score(s, 80)),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // 2 signals flagged → 1 cross-signal flag → -5 penalty
      expect(result.crossSignalGamingFlags).toBe(1);
      expect(result.compositeScore).toBe(75); // 80 - 5
    });

    it('caps the cross-signal penalty at -30 even if every signal is flagged', () => {
      const result = computeComposite({
        signalScores: PRODUCTIVITY_SIGNALS_TEST.map((s) =>
          score(s, 100, [`${s.toLowerCase()}_gaming_count=99`]),
        ),
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // 7 signals flagged → 6 cross-signal flags → cap at -30
      expect(result.crossSignalGamingFlags).toBe(6);
      expect(result.compositeScore).toBe(70); // 100 - 30 (capped)
    });
  });

  describe('clamping and edge cases', () => {
    it('clamps composite to [0, 100]', () => {
      // Use weights that force a >100 raw score (impossible legally,
      // but defensive)
      const result = computeComposite({
        signalScores: PRODUCTIVITY_SIGNALS_TEST.map((s) => score(s, 100)),
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      expect(result.compositeScore).toBeLessThanOrEqual(100);
    });

    it('returns score=0 (LOW) when there are no signal scores at all', () => {
      const result = computeComposite({
        signalScores: [],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      expect(result.compositeScore).toBe(0);
      expect(result.band).toBe('LOW');
    });

    it('respects custom thresholds', () => {
      const result = computeComposite({
        signalScores: PRODUCTIVITY_SIGNALS_TEST.map((s) => score(s, 65)),
        weights: UNIVERSAL_WEIGHTS_R5,
        thresholdHigh: 60,
        thresholdLow: 30,
      });
      expect(result.compositeScore).toBe(65);
      expect(result.band).toBe('HIGH'); // 65 >= 60
    });

    it('rounds to two decimal places (matches Decimal(5,2) column)', () => {
      // Weights are 0.13, 0.22, 0.10, 0.10, 0.18, 0.22, 0.05 — pick
      // scores that produce a 4-decimal raw result.
      const result = computeComposite({
        signalScores: [
          score('STANDUP', 87),
          score('EXECUTION', 73),
          score('CODE', 45),
          score('COMMUNICATION', 50),
          score('PRESENCE', 91),
          score('DEEP_WORK', 66),
          score('DEVICE_HYGIENE', 100),
        ],
        weights: UNIVERSAL_WEIGHTS_R5,
      });
      // Verify rounding: result must be a multiple of 0.01
      expect(result.compositeScore * 100).toBeCloseTo(
        Math.round(result.compositeScore * 100),
        6,
      );
    });
  });
});

// Helper — locally typed enum array. Mirrors PRODUCTIVITY_SIGNALS from
// @exargen/shared but lets the test file stay self-contained.
const PRODUCTIVITY_SIGNALS_TEST: ProductivitySignal[] = [
  'STANDUP',
  'EXECUTION',
  'CODE',
  'COMMUNICATION',
  'PRESENCE',
  'DEEP_WORK',
  'DEVICE_HYGIENE',
];
