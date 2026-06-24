/**
 * DEEP_WORK scorer — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { scoreDeepWork } from './deepWork.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeFocusEvent(
  date: string,
  opts: {
    activeHours?: number;
    productiveHours?: number;
    focusBlocks?: number;
    contextSwitches?: number;
    distractionMinutes?: number;
    tamperMinutes?: number;
    /** Wave 8 — share of active time flagged as tamper (0..1). */
    tamperRatio?: number;
    /** Wave 8 — share of active time on productive apps (0..1). */
    productiveRatio?: number;
  } = {},
): ScorerEvent {
  return {
    id: `focus-${date}`,
    signal: 'DEEP_WORK',
    eventType: 'pulse.daily_focus',
    occurredAt: new Date(`${date}T23:59:00Z`),
    rawPayload: {
      date,
      activeSeconds: (opts.activeHours ?? 0) * 3600,
      productiveSeconds: (opts.productiveHours ?? 0) * 3600,
      focusBlocks: opts.focusBlocks ?? 0,
      contextSwitches: opts.contextSwitches ?? 0,
      distractionBurstMinutes: opts.distractionMinutes ?? 0,
      tamperMinutes: opts.tamperMinutes ?? 0,
      ...(opts.tamperRatio != null ? { tamperRatio: opts.tamperRatio } : {}),
      ...(opts.productiveRatio != null ? { productiveRatio: opts.productiveRatio } : {}),
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'device_snapshots',
    sourceId: `df-${date}`,
  };
}

function makeInput(events: ScorerEvent[]): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-04T00:00:00Z'),
    windowEnd: new Date('2026-05-08T00:00:00Z'),
    workingDays: 5,
    events,
    baselines: {},
  };
}

describe('scoreDeepWork', () => {
  it('returns 0 with no events', () => {
    const result = scoreDeepWork(makeInput([]));
    expect(result.score).toBe(0);
    expect(result.signal).toBe('DEEP_WORK');
  });

  it('rewards high productive-ratio with no penalties', () => {
    // 100% productive-app ratio, no focus blocks, no switches, no distractions
    const events = [
      makeFocusEvent('2026-05-04', { activeHours: 8, productiveHours: 8 }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // productive_contribution = 60 * 1.0 = 60
    // focus_quality = 0, no penalties
    // score = 60
    expect(result.score).toBe(60);
    expect(result.rawBreakdown.productive_ratio).toBe(1);
  });

  it('adds focus-quality points (capped at 50)', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 8,
        productiveHours: 8,
        focusBlocks: 5, // 5 × 5 = 25 pts
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // 60 (productive) + 25 (focus) = 85
    expect(result.score).toBe(85);
    expect(result.rawBreakdown.focus_quality_pts).toBe(25);
  });

  it('caps focus-quality contribution at 50 points', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 8,
        productiveHours: 8,
        focusBlocks: 20, // would be 100 pts uncapped
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // 60 + 50 (capped) = 110, clamped to 100
    expect(result.score).toBe(100);
    expect(result.rawBreakdown.focus_quality_pts).toBe(50);
  });

  it('penalizes high context-switching above 30 switches/hour', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 4, // 4 hours
        productiveHours: 4,
        contextSwitches: 200, // 50 / hour → 20 over threshold
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // 60 (productive) - 2 * (50 - 30) = 60 - 40 = 20
    expect(result.score).toBe(20);
    expect(result.gamingFlags.some((f) => f.startsWith('high_context_switching_per_hour'))).toBe(
      true,
    );
  });

  it('penalizes distraction bursts (capped at -15)', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 8,
        productiveHours: 8,
        distractionMinutes: 30, // 30 min → -30, capped at -15
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // 60 (productive) - 15 (cap) = 45
    expect(result.score).toBe(45);
    expect(result.rawBreakdown.distraction_penalty).toBe(15);
  });

  it('subtracts tamper minutes directly', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 8,
        productiveHours: 8,
        tamperMinutes: 25,
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // 60 - 25 = 35
    expect(result.score).toBe(35);
    expect(result.gamingFlags).toContain('deep_work_tamper_minutes=25');
  });

  it('sums across days and computes ratio correctly over the window', () => {
    const events = [
      makeFocusEvent('2026-05-04', { activeHours: 8, productiveHours: 6 }),
      makeFocusEvent('2026-05-05', { activeHours: 8, productiveHours: 6 }),
      makeFocusEvent('2026-05-06', { activeHours: 8, productiveHours: 6 }),
    ];
    const result = scoreDeepWork(makeInput(events));
    // Total: 24h active, 18h productive → 0.75 ratio
    expect(result.rawBreakdown.productive_ratio).toBe(0.75);
    // 60 * 0.75 = 45
    expect(result.score).toBe(45);
    expect(result.rawBreakdown.days_covered).toBe(3);
  });

  it('does not penalize zero active time (no work, no penalty)', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 0,
        productiveHours: 0,
        contextSwitches: 50, // would be infinity / hour if not handled
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    expect(result.rawBreakdown.switches_per_hour).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('ignores non-pulse.daily_focus events', () => {
    const events: ScorerEvent[] = [
      makeFocusEvent('2026-05-04', { activeHours: 8, productiveHours: 8 }),
      {
        ...makeFocusEvent('2026-05-05', { activeHours: 8, productiveHours: 0 }),
        eventType: 'pulse.heartbeat',
      },
    ];
    const result = scoreDeepWork(makeInput(events));
    expect(result.rawBreakdown.days_covered).toBe(1);
    expect(result.rawBreakdown.productive_ratio).toBe(1);
  });

  it('handles malformed payloads', () => {
    const events: ScorerEvent[] = [
      {
        id: 'bad-1',
        signal: 'DEEP_WORK',
        eventType: 'pulse.daily_focus',
        occurredAt: new Date(),
        rawPayload: {},
        scoreDelta: null,
        gamingFlag: null,
        source: 'device_snapshots',
        sourceId: 'bad-1',
      },
    ];
    expect(() => scoreDeepWork(makeInput(events))).not.toThrow();
  });

  it('rounds score to two decimal places', () => {
    const events = [
      makeFocusEvent('2026-05-04', {
        activeHours: 7,
        productiveHours: 5,
      }),
    ];
    const result = scoreDeepWork(makeInput(events));
    expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
  });

  // ─── Wave 8 — proportional tamper penalty ────────────────────────

  describe('Wave 8 tamperRatio model', () => {
    it('uses ratio-based penalty when tamperRatio is present', () => {
      // 8h active, all productive, 10% tamper ratio.
      // Without ratio: tamperMin would have to be 48 (=8*3600*0.10/60) to
      //                land the same penalty as the ratio path produces.
      // Ratio path: penalty = 30 * 0.10 = 3 points.
      // Score = 60 + 50 (focus cap from many blocks if any) - 3.
      const events = [
        makeFocusEvent('2026-05-04', {
          activeHours: 8,
          productiveHours: 8,
          focusBlocks: 0,
          tamperRatio: 0.1,
        }),
      ];
      const result = scoreDeepWork(makeInput(events));
      // Productive contribution = 60 * 1.0 = 60. Tamper = -3. = 57.
      expect(result.score).toBe(57);
      expect(result.rawBreakdown.tamper_ratio_avg).toBe(0.1);
      expect(result.rawBreakdown.tamper_penalty_model).toBe('ratio');
    });

    it('caps the ratio-based penalty at 30 points (100% tamper)', () => {
      const events = [
        makeFocusEvent('2026-05-04', {
          activeHours: 8,
          productiveHours: 8,
          tamperRatio: 1.0,
        }),
      ];
      const result = scoreDeepWork(makeInput(events));
      // 60 - 30 = 30. Old model would have done 8h * 60min/h = 480 min →
      // floored to 0. New model: still painful but not annihilating.
      expect(result.score).toBe(30);
      expect(result.rawBreakdown.tamper_penalty).toBe(30);
    });

    it('falls back to legacy tamperMinutes when no event carries the ratio', () => {
      const events = [
        makeFocusEvent('2026-05-04', {
          activeHours: 8,
          productiveHours: 8,
          tamperMinutes: 20,
        }),
      ];
      const result = scoreDeepWork(makeInput(events));
      // 60 - 20 = 40
      expect(result.score).toBe(40);
      expect(result.rawBreakdown.tamper_penalty_model).toBe('legacy_minutes');
      expect(result.rawBreakdown.tamper_penalty).toBe(20);
    });

    it('weights the average tamperRatio by activeSeconds across events', () => {
      // Day 1: 2h active, ratio 0.5 → weighted-sum = 7200 * 0.5 = 3600
      // Day 2: 8h active, ratio 0.0 → weighted-sum = 0
      // Avg = 3600 / (7200 + 28800) = 0.1 → penalty = 3
      const events = [
        makeFocusEvent('2026-05-04', {
          activeHours: 2,
          productiveHours: 2,
          tamperRatio: 0.5,
        }),
        makeFocusEvent('2026-05-05', {
          activeHours: 8,
          productiveHours: 8,
          tamperRatio: 0.0,
        }),
      ];
      const result = scoreDeepWork(makeInput(events));
      // productiveRatio = (2+8)*3600 / (2+8)*3600 = 1.0 → 60 pts
      // tamper avg = 0.1 → -3
      expect(result.score).toBe(57);
      expect(result.rawBreakdown.tamper_ratio_avg).toBe(0.1);
    });

    it('does NOT flag gaming when tamperMinutes is 0 even with high ratio', () => {
      // Edge case: an old client emits only tamperRatio without tamperMinutes.
      // Gaming-flag emission still keys off the legacy tamperMinutes field.
      const events = [
        makeFocusEvent('2026-05-04', {
          activeHours: 8,
          productiveHours: 8,
          tamperRatio: 0.5,
          tamperMinutes: 0,
        }),
      ];
      const result = scoreDeepWork(makeInput(events));
      expect(result.gamingFlags).not.toContain('deep_work_tamper_minutes=0');
    });
  });
});
