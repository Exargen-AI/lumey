/**
 * standupNormalise — unit tests.
 *
 * Pins the gaming-defeat contract: trivial mutations of a standup
 * body (punctuation, digits, emoji, trailing whitespace) MUST produce
 * the same hash so the STANDUP scorer's recent-N-days duplicate
 * guard catches the copy-paste pattern.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseStandupForHash,
  standupBodyHash,
  visibleStandupLength,
} from './standupNormalise';

describe('normaliseStandupForHash — adversarial mutations collapse', () => {
  // Each group of inputs MUST produce the same normalised form.
  // If you add a new mutation, add a new line here.
  // Each group of variants must hash to the same value. The groups
  // pin the four mutations the gaming guard MUST defeat:
  // case folding, punctuation, digits, emoji, whitespace.
  const equivalenceClasses: string[][] = [
    [
      'Working on tasks',
      'working on tasks',
      'WORKING ON TASKS',
      'Working on tasks.',
      'Working on tasks!',
      'Working on tasks?',
      'Working on tasks.....',
      'Working on tasks 1',
      'Working on tasks 2',
      'Working on tasks 100',
      'Working on tasks 🚀',
      'Working on tasks 👍🏽',
      'Working   on    tasks',
      ' Working on tasks ',
      '\tWorking on tasks\n',
      '@Working on tasks',
      'Working on tasks - 5/30', // dash + digits stripped
    ],
    [
      'Fixed the bug',
      'fixed the bug',
      'Fixed the bug.',
      'Fixed the bug!!',
      // Note: "Fixed the bug v1" has the letter `v` so it normalises
      // to "fixedthebugv" — not in this equivalence class. That's
      // correct behaviour: `v` is a letter, treated as content.
    ],
  ];

  it.each(equivalenceClasses)(
    'all variants of "%s" produce the same normalised hash',
    (...variants) => {
      const hashes = new Set(variants.map(standupBodyHash));
      expect(hashes.size).toBe(1);
    },
  );
});

describe('normaliseStandupForHash — meaningful changes still produce different hashes', () => {
  it.each([
    ['Working on tasks', 'Working on docs'],
    ['Fixed the bug', 'Created the bug'],
    ['Fixed the bug v1', 'Fixed the bug rc1'], // v vs rc → different LETTERS
  ])('"%s" vs "%s" differ', (a, b) => {
    expect(standupBodyHash(a)).not.toBe(standupBodyHash(b));
  });

  it('completely different bodies differ', () => {
    expect(standupBodyHash('Working on tasks')).not.toBe(
      standupBodyHash('I helped Anil with the database migration'),
    );
  });

  it('NOTE: digit-only mutations DO collapse (by design)', () => {
    // This pins the documented trade-off: numbers ARE stripped before
    // hashing. So "Wave 12" and "Wave 11" hash the same. A user
    // submitting "Wave N" every day would be caught by the duplicate
    // guard, which is what we want — version-number-only variations
    // are exactly the lazy-copy-paste pattern we're defeating.
    expect(standupBodyHash('Shipping Wave 12')).toBe(
      standupBodyHash('Shipping Wave 11'),
    );
  });
});

describe('normaliseStandupForHash — empty / trivial input', () => {
  it('empty string normalises to empty string', () => {
    expect(normaliseStandupForHash('')).toBe('');
  });

  it('whitespace-only input normalises to empty string', () => {
    expect(normaliseStandupForHash('   \t\n  ')).toBe('');
  });

  it('digit/punctuation-only input normalises to empty string', () => {
    expect(normaliseStandupForHash('12345 !!! ???')).toBe('');
  });

  it('emoji-only input normalises to empty string', () => {
    expect(normaliseStandupForHash('🚀🚀🚀 👍')).toBe('');
  });

  it('digit/emoji-only inputs all hash to the same value', () => {
    expect(standupBodyHash('12345')).toBe(standupBodyHash('!!!'));
    expect(standupBodyHash('!!!')).toBe(standupBodyHash('🚀🚀🚀'));
  });
});

describe('visibleStandupLength', () => {
  it('counts visible chars including punctuation + digits (so the body-too-short guard sees full content)', () => {
    expect(visibleStandupLength('Working on tasks')).toBe(16);
    expect(visibleStandupLength('Working on tasks!')).toBe(17);
    expect(visibleStandupLength('Working on tasks 1')).toBe(18);
  });

  it('collapses whitespace before counting', () => {
    expect(visibleStandupLength('Working   on    tasks')).toBe(16);
    expect(visibleStandupLength('  Working on tasks  ')).toBe(16);
  });

  it('counts emoji as a code point (Node UTF-16 length — close enough for v1)', () => {
    // The scorer's MIN_BODY_CHARS = 50, so the exact emoji length math
    // doesn't move the gaming guard much. Pinning the current
    // behaviour so a future Unicode rework doesn't silently shift it.
    expect(visibleStandupLength('🚀')).toBeGreaterThan(0);
  });
});

describe('standupBodyHash — output shape', () => {
  it('returns a 16-char hex string', () => {
    const h = standupBodyHash('Working on tasks');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
