/**
 * Pulse — productivity score regression tests (2026-05-29).
 *
 * Pins each rubric line so a future "let me just tweak the weights"
 * change has to consciously update the tests.
 */

import { describe, it, expect } from 'vitest';
import {
  computeProductivityScore,
  SCORING_VERSION,
  type ProductivityScoreInputs,
} from './pulseEmployeeScore.service';

const HOURS = (n: number) => n * 3600;

function inputs(over: Partial<ProductivityScoreInputs> = {}): ProductivityScoreInputs {
  return {
    productiveSeconds: 0,
    communicationSeconds: 0,
    entertainmentSeconds: 0,
    personalSeconds: 0,
    unknownSeconds: 0,
    tamperSeconds: 0,
    activeSeconds: HOURS(8),
    ...over,
  };
}

describe('computeProductivityScore — base cases', () => {
  it('returns score 0 + band LOW + NO_ACTIVITY when screen time < 30s', () => {
    const r = computeProductivityScore(inputs({ activeSeconds: 10 }));
    expect(r.score).toBe(0);
    expect(r.band).toBe('LOW');
    expect(r.breakdown[0].kind).toBe('NO_ACTIVITY');
  });

  it('100% productive = score 100 + HIGH', () => {
    const r = computeProductivityScore(
      inputs({ productiveSeconds: HOURS(8) }),
    );
    expect(r.score).toBe(100);
    expect(r.band).toBe('HIGH');
  });

  it('0% productive but no penalties = score 0 + LOW', () => {
    const r = computeProductivityScore(
      inputs({ unknownSeconds: HOURS(8) }),
    );
    expect(r.score).toBe(0);
    expect(r.band).toBe('LOW');
  });
});

describe('computeProductivityScore — communication credit', () => {
  it('100% communication = 70 score (70% credit factor)', () => {
    const r = computeProductivityScore(
      inputs({ communicationSeconds: HOURS(8) }),
    );
    expect(r.score).toBe(70);
    expect(r.band).toBe('HIGH'); // 70 is the HIGH boundary
  });

  it('mix: 4h productive + 4h communication = (4 + 0.7×4)/8 × 100 = 85', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(4),
        communicationSeconds: HOURS(4),
      }),
    );
    expect(r.score).toBe(85);
    expect(r.band).toBe('HIGH');
  });
});

describe('computeProductivityScore — entertainment penalty', () => {
  it('1h entertainment (within free) → no penalty', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(7),
        entertainmentSeconds: HOURS(1),
      }),
    );
    // 7/8 × 100 = 87.5 → 88 (rounded)
    expect(r.score).toBe(88);
    expect(r.breakdown.find((b) => b.kind === 'ENTERTAINMENT_PENALTY')).toBeUndefined();
  });

  it('2h entertainment = -10 (1h over the 1h-free)', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(6),
        entertainmentSeconds: HOURS(2),
      }),
    );
    // (6/8)×100 - 10 = 75 - 10 = 65
    expect(r.score).toBe(65);
    expect(r.band).toBe('MEDIUM');
  });

  it('entertainment penalty caps at 40', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(0),
        entertainmentSeconds: HOURS(20),
        activeSeconds: HOURS(20),
      }),
    );
    // 0/20 × 100 = 0; penalty = min(40, 19h × 10) = 40 → score still 0
    expect(r.score).toBe(0);
    expect(
      r.breakdown.find((b) => b.kind === 'ENTERTAINMENT_PENALTY')?.delta,
    ).toBe(-40);
  });
});

describe('computeProductivityScore — personal penalty', () => {
  it('2h personal = no penalty', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(6),
        personalSeconds: HOURS(2),
      }),
    );
    expect(r.score).toBe(75);
    expect(r.breakdown.find((b) => b.kind === 'PERSONAL_PENALTY')).toBeUndefined();
  });

  it('4h personal = -20 (2h over the 2h-free)', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(4),
        personalSeconds: HOURS(4),
      }),
    );
    // 4/8 × 100 = 50; -20 (2h × 10) = 30
    expect(r.score).toBe(30);
    expect(r.band).toBe('LOW');
  });
});

describe('computeProductivityScore — tamper penalty', () => {
  it('any tamper time → -50 hit + clear summary', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(8),
        tamperSeconds: 60, // any amount
      }),
    );
    expect(r.score).toBe(50);
    expect(r.band).toBe('MEDIUM');
    expect(r.summary).toMatch(/tamper/i);
  });

  it('tamper + entertainment compound', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(4),
        entertainmentSeconds: HOURS(3),
        tamperSeconds: 60,
      }),
    );
    // 4/8 × 100 = 50, -20 (2h ent), -50 (tamper) = -20 → floor 0
    expect(r.score).toBe(0);
  });
});

describe('computeProductivityScore — bands', () => {
  it('70 → HIGH (boundary inclusive)', () => {
    const r = computeProductivityScore(
      inputs({ communicationSeconds: HOURS(8) }),
    );
    expect(r.score).toBe(70);
    expect(r.band).toBe('HIGH');
  });

  it('69 → MEDIUM', () => {
    const r = computeProductivityScore(
      inputs({
        productiveSeconds: HOURS(4),
        communicationSeconds: HOURS(2.06),
        unknownSeconds: HOURS(1.94),
      }),
    );
    // 4/8 + 0.7×2.06/8 = 0.5 + 0.18 = 0.68 → 68
    expect(r.score).toBeGreaterThanOrEqual(67);
    expect(r.score).toBeLessThanOrEqual(69);
    expect(r.band).toBe('MEDIUM');
  });

  it('40 → MEDIUM (boundary inclusive)', () => {
    // 3.2h productive / 8h = 40
    const r = computeProductivityScore(
      inputs({ productiveSeconds: HOURS(3.2) }),
    );
    expect(r.score).toBe(40);
    expect(r.band).toBe('MEDIUM');
  });

  it('39 → LOW', () => {
    const r = computeProductivityScore(
      inputs({ productiveSeconds: HOURS(3.1) }),
    );
    expect(r.score).toBe(39);
    expect(r.band).toBe('LOW');
  });
});

describe('SCORING_VERSION', () => {
  it('is exported so historical scores can be tagged', () => {
    expect(SCORING_VERSION).toBe(1);
  });
});
