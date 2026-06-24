import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from './usage';

describe('estimateCostUsd', () => {
  it('returns null when no pricing is supplied (never a guess)', () => {
    expect(estimateCostUsd({ inputTokens: 100, outputTokens: 50 }, null)).toBeNull();
    expect(estimateCostUsd({ inputTokens: 100, outputTokens: 50 }, undefined)).toBeNull();
  });

  it('computes per-1M-token cost', () => {
    // 500k input · $2/1M = $1.00 ; 250k output · $10/1M = $2.50
    expect(estimateCostUsd({ inputTokens: 500_000, outputTokens: 250_000 }, { inputPer1M: 2, outputPer1M: 10 })).toBe(3.5);
  });

  it('is zero for zero usage', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, { inputPer1M: 99, outputPer1M: 99 })).toBe(0);
  });
});
