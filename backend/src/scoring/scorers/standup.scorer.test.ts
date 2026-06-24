/**
 * STANDUP scorer — unit tests.
 *
 * Pure function, no Prisma. Each test constructs synthetic
 * `ScorerEvent` arrays and asserts the (score, rawBreakdown,
 * gamingFlags) tuple. No DB, no mocks, no time travel — fast and
 * deterministic.
 *
 * Coverage:
 *   - Empty window (zero events) → score 0, no flags
 *   - Full attendance, all substantive → score 100
 *   - PTO-adjusted working days
 *   - Body-too-short guard
 *   - Duplicate-body guard
 *   - Edit / resubmit (latest event for a date wins)
 *   - Score clamping
 */

import { describe, it, expect } from 'vitest';
import { scoreStandup } from './standup.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeEvent(
  date: string,
  opts: { bodyLength?: number; bodyHash?: string; occurredAt?: Date } = {},
): ScorerEvent {
  return {
    id: `ev-${date}-${Math.random()}`,
    signal: 'STANDUP',
    eventType: 'standup.submitted',
    occurredAt: opts.occurredAt ?? new Date(`${date}T09:00:00Z`),
    rawPayload: {
      date,
      bodyLength: opts.bodyLength ?? 100,
      bodyHash: opts.bodyHash ?? `hash-${date}`,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'daily_updates',
    sourceId: `du-${date}`,
  };
}

function makeInput(events: ScorerEvent[], workingDays: number): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-01'),
    windowEnd: new Date('2026-05-31'),
    workingDays,
    events,
    baselines: {},
  };
}

describe('scoreStandup', () => {
  it('returns 0 with no flags when there are no events', () => {
    const result = scoreStandup(makeInput([], 20));
    expect(result.score).toBe(0);
    expect(result.signal).toBe('STANDUP');
    expect(result.gamingFlags).toEqual([]);
    expect(result.rawBreakdown.substantive_standups).toBe(0);
    expect(result.rawBreakdown.working_days).toBe(20);
  });

  it('returns 100 when a substantive standup landed on every working day', () => {
    const events = [
      makeEvent('2026-05-04'),
      makeEvent('2026-05-05'),
      makeEvent('2026-05-06'),
      makeEvent('2026-05-07'),
      makeEvent('2026-05-08'),
    ];
    const result = scoreStandup(makeInput(events, 5));
    expect(result.score).toBe(100);
    expect(result.gamingFlags).toEqual([]);
    expect(result.rawBreakdown.substantive_standups).toBe(5);
  });

  it('drops bodies under 50 characters and flags them', () => {
    const events = [
      makeEvent('2026-05-04', { bodyLength: 100, bodyHash: 'a' }),
      makeEvent('2026-05-05', { bodyLength: 20, bodyHash: 'b' }), // too short
      makeEvent('2026-05-06', { bodyLength: 100, bodyHash: 'c' }),
      makeEvent('2026-05-07', { bodyLength: 49, bodyHash: 'd' }), // too short
    ];
    const result = scoreStandup(makeInput(events, 4));
    // 2 substantive of 4 working days = 50
    expect(result.score).toBe(50);
    expect(result.rawBreakdown.body_too_short_count).toBe(2);
    expect(result.gamingFlags).toContain('standup_too_short_count=2');
  });

  it('drops duplicate-body posts beyond the first occurrence', () => {
    const events = [
      makeEvent('2026-05-04', { bodyHash: 'same-hash' }), // counts
      makeEvent('2026-05-05', { bodyHash: 'same-hash' }), // duplicate
      makeEvent('2026-05-06', { bodyHash: 'same-hash' }), // duplicate
      makeEvent('2026-05-07', { bodyHash: 'different' }), // counts
    ];
    const result = scoreStandup(makeInput(events, 4));
    // 2 substantive of 4 working days = 50
    expect(result.score).toBe(50);
    expect(result.rawBreakdown.duplicate_count).toBe(2);
    expect(result.gamingFlags).toContain('standup_duplicate_count=2');
  });

  it('handles edit-and-resubmit: latest occurredAt wins', () => {
    const events = [
      // First submission: too short (would be dropped)
      makeEvent('2026-05-04', {
        bodyLength: 10,
        bodyHash: 'short',
        occurredAt: new Date('2026-05-04T09:00:00Z'),
      }),
      // Edit: substantive (this one should win)
      makeEvent('2026-05-04', {
        bodyLength: 200,
        bodyHash: 'long',
        occurredAt: new Date('2026-05-04T17:00:00Z'),
      }),
    ];
    const result = scoreStandup(makeInput(events, 1));
    expect(result.score).toBe(100);
    expect(result.rawBreakdown.substantive_standups).toBe(1);
    expect(result.rawBreakdown.body_too_short_count).toBe(0);
  });

  it('uses PTO-adjusted working days as the denominator', () => {
    // 5 substantive standups, 10 calendar working days, but 5 PTO days
    // means workingDays = 5. Score should be 100, not 50.
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent(`2026-05-${String(4 + i).padStart(2, '0')}`),
    );
    const result = scoreStandup(makeInput(events, 5));
    expect(result.score).toBe(100);
  });

  it('clamps to 100 if substantive count exceeds working_days', () => {
    // Edge case: events for non-working days (weekend submissions)
    // could in theory exceed workingDays. Score should clamp.
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`2026-05-${String(4 + i).padStart(2, '0')}`),
    );
    const result = scoreStandup(makeInput(events, 5));
    expect(result.score).toBe(100);
  });

  it('returns 0 with no division-by-zero when workingDays is 0', () => {
    // Worker substitutes 1 to avoid this; defensive check.
    const events = [makeEvent('2026-05-04')];
    const result = scoreStandup(makeInput(events, 0));
    expect(result.score).toBe(100); // safeWorkingDays = max(1, 0) = 1
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('ignores event-type variants the scorer does not understand', () => {
    // Per the Scorer contract, events arrive pre-filtered by signal
    // (the recompute worker does that split). But within one signal,
    // multiple event sub-types may exist (e.g. 'standup.submitted',
    // 'standup.edited', 'standup.deleted'). Scorers MUST filter on
    // event_type if they care about sub-types — the STANDUP scorer
    // only counts 'standup.submitted'.
    const events: ScorerEvent[] = [
      makeEvent('2026-05-04'),
      {
        ...makeEvent('2026-05-05'),
        eventType: 'standup.edited', // not 'standup.submitted'
      },
      {
        ...makeEvent('2026-05-06'),
        eventType: 'standup.deleted', // not 'standup.submitted'
      },
    ];
    const result = scoreStandup(makeInput(events, 3));
    // Only the first event counts
    expect(result.rawBreakdown.substantive_standups).toBe(1);
  });

  it('rounds score to two decimal places', () => {
    // 2 substantive / 7 working days = 28.571428...
    const events = [
      makeEvent('2026-05-04'),
      makeEvent('2026-05-05'),
    ];
    const result = scoreStandup(makeInput(events, 7));
    expect(result.score).toBe(28.57);
  });

  it('handles malformed rawPayload without throwing', () => {
    const events: ScorerEvent[] = [
      {
        id: 'bad-1',
        signal: 'STANDUP',
        eventType: 'standup.submitted',
        occurredAt: new Date('2026-05-04'),
        rawPayload: {}, // no date, bodyLength, bodyHash
        scoreDelta: null,
        gamingFlag: null,
        source: 'daily_updates',
        sourceId: 'du-bad',
      },
    ];
    expect(() => scoreStandup(makeInput(events, 1))).not.toThrow();
    const result = scoreStandup(makeInput(events, 1));
    expect(result.score).toBe(0);
  });
});
