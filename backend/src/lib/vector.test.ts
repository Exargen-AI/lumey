import { describe, it, expect } from 'vitest';
import { cosineSimilarity, rankBySimilarity } from './vector';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it('ignores magnitude (measures angle)', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
  });

  it('returns 0 for empty or mismatched-length vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  it('orders items by closeness to the query, highest first, capped at limit', () => {
    const ranked = rankBySimilarity(
      [1, 0],
      [
        { item: 'orthogonal', vector: [0, 1] },
        { item: 'exact', vector: [1, 0] },
        { item: 'close', vector: [0.9, 0.1] },
      ],
      2,
    );
    expect(ranked).toEqual(['exact', 'close']);
  });
});
