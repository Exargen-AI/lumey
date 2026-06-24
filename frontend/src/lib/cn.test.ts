import { describe, it, expect } from 'vitest';
import { cn } from './cn';

/**
 * Phase 0 of the baseline hardening plan: proves Vitest is wired for
 * the frontend (config, jsdom env, alias resolution, TS+TSX compile).
 *
 * `cn` is the tailwind-merge + clsx glue used everywhere — a tiny
 * pure function. Easiest possible component-test-adjacent unit spec.
 * Phase 4 expands this pattern to every hook and lib file.
 */
describe('cn (tailwind class merger)', () => {
  it('joins multiple class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('strips falsy values', () => {
    // Use a runtime variable so the `false && ...` short-circuit isn't a
    // compile-time constant (otherwise lint flags it as constant-binary).
    const skip: false | string = false;
    expect(cn('a', skip && 'b', null, undefined, 'c')).toBe('a c');
  });

  it('merges conflicting tailwind utilities (right wins)', () => {
    // tailwind-merge's whole point: `p-2 p-4` collapses to `p-4`.
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('preserves non-conflicting tailwind utilities', () => {
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold');
  });

  it('handles arrays and objects per clsx semantics', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
