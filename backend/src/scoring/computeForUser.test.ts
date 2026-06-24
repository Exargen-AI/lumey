/**
 * computeForUser — integration-ish unit tests.
 *
 * Pure function (no Prisma). Orchestrates all 7 per-signal scorers plus
 * the composite. We feed in synthetic events for each signal and
 * verify the three cadence rows come back with sensible structure.
 *
 * The per-signal scorers are already extensively tested in their own
 * files; this suite focuses on:
 *   - The orchestrator runs all 3 cadences
 *   - All 7 signals are scored (no missing keys in the result)
 *   - Inactive-signals are zeroed but still present in the breakdown
 *   - rollingWindow has the right shape
 *   - computedFromEventCount matches the cadence-window event count
 *   - defaultWeightSet returns valid R5 weights
 */

import { describe, it, expect } from 'vitest';
import { computeForUser, defaultWeightSet } from './computeForUser';
import {
  PRODUCTIVITY_SIGNALS,
  UNIVERSAL_WEIGHTS_R5,
  weightsSumValid,
  type ProductivitySignal,
} from '@exargen/shared';
import type { ScorerEvent } from './scorers/types';

function event(
  signal: ProductivitySignal,
  eventType: string,
  occurredAt: Date,
  rawPayload: Record<string, unknown> = {},
): ScorerEvent {
  return {
    id: `ev-${signal}-${occurredAt.toISOString()}`,
    signal,
    eventType,
    occurredAt,
    rawPayload,
    scoreDelta: null,
    gamingFlag: null,
    source: 'test',
    sourceId: `src-${signal}`,
  };
}

describe('defaultWeightSet', () => {
  it('returns R5 weights that pass weightsSumValid', () => {
    const ws = defaultWeightSet();
    expect(ws.weights).toEqual(UNIVERSAL_WEIGHTS_R5);
    expect(weightsSumValid(ws.weights)).toBe(true);
    expect(ws.thresholdHigh).toBe(75);
    expect(ws.thresholdLow).toBe(40);
  });
});

describe('computeForUser', () => {
  // 2026-05-29 is a Friday (UTC).
  const now = new Date('2026-05-29T14:30:00Z');

  it('returns DAILY + WEEKLY + MONTHLY rows for an empty event list', () => {
    const result = computeForUser({
      userId: 'user-1',
      events: [],
      weightSet: defaultWeightSet(),
      now,
    });
    expect(result.userId).toBe('user-1');
    expect(result.daily.cadence).toBe('DAILY');
    expect(result.weekly.cadence).toBe('WEEKLY');
    expect(result.monthly.cadence).toBe('MONTHLY');
    // Empty events → composites are at most a small baseline from
    // signals that default to a non-zero "no activity = neutral" value
    // (e.g. DEVICE_HYGIENE returns ~90 when there's no degradation
    // signal at all). We don't pin the exact value — that's a scorer
    // implementation detail — but it must be small and in band LOW.
    expect(result.daily.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.daily.compositeScore).toBeLessThan(40);
    expect(result.weekly.compositeScore).toBeLessThan(40);
    expect(result.monthly.compositeScore).toBeLessThan(40);
    expect(result.daily.band).toBe('LOW');
  });

  it('produces a signalScores entry for EVERY signal (none missing)', () => {
    const result = computeForUser({
      userId: 'user-1',
      events: [],
      weightSet: defaultWeightSet(),
      now,
    });
    for (const signal of PRODUCTIVITY_SIGNALS) {
      expect(result.daily.signalScores[signal]).toBeDefined();
      expect(result.daily.signalScores[signal].signal).toBe(signal);
      expect(result.weekly.signalScores[signal]).toBeDefined();
      expect(result.monthly.signalScores[signal]).toBeDefined();
    }
  });

  it('rollingWindow spans 30 days ending today', () => {
    const result = computeForUser({
      userId: 'user-1',
      events: [],
      weightSet: defaultWeightSet(),
      now,
    });
    expect(result.rollingWindow.end.toISOString()).toBe('2026-05-29T23:59:59.999Z');
    expect(result.rollingWindow.start.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('marks inactiveSignals with score 0 and inactive flag in breakdown', () => {
    const result = computeForUser({
      userId: 'user-1',
      events: [],
      weightSet: defaultWeightSet(),
      now,
      inactiveSignals: ['CODE'],
    });
    expect(result.daily.signalScores.CODE.score).toBe(0);
    expect(result.daily.signalScores.CODE.rawBreakdown.inactive).toBe(1);
    // Flag plumbing for the dashboard
    expect(result.daily.flags.inactiveSignals).toEqual(['CODE']);
    expect(result.weekly.flags.inactiveSignals).toEqual(['CODE']);
  });

  it('computedFromEventCount matches the cadence-window event count', () => {
    const events: ScorerEvent[] = [
      // Inside DAILY (today)
      event('STANDUP', 'standup.submitted', new Date('2026-05-29T09:00:00Z'), {
        date: '2026-05-29',
        bodyLength: 200,
        bodyHash: 'h1',
      }),
      // Inside WEEKLY (this week, earlier)
      event('STANDUP', 'standup.submitted', new Date('2026-05-27T09:00:00Z'), {
        date: '2026-05-27',
        bodyLength: 200,
        bodyHash: 'h2',
      }),
      // Inside MONTHLY but outside WEEKLY (earlier in May)
      event('STANDUP', 'standup.submitted', new Date('2026-05-08T09:00:00Z'), {
        date: '2026-05-08',
        bodyLength: 200,
        bodyHash: 'h3',
      }),
    ];
    const result = computeForUser({
      userId: 'user-1',
      events,
      weightSet: defaultWeightSet(),
      now,
    });
    expect(result.daily.computedFromEventCount).toBe(1);
    expect(result.weekly.computedFromEventCount).toBe(2);
    expect(result.monthly.computedFromEventCount).toBe(3);
  });

  it('rawBreakdown has an entry for every signal even when none scored', () => {
    const result = computeForUser({
      userId: 'user-1',
      events: [],
      weightSet: defaultWeightSet(),
      now,
    });
    for (const signal of PRODUCTIVITY_SIGNALS) {
      expect(result.daily.rawBreakdown[signal]).toBeDefined();
    }
  });
});
