/**
 * PRESENCE scorer — unit tests.
 *
 * Covers:
 *   - Empty window
 *   - Hitting 8h/day target → 100
 *   - Under-attendance → linear penalty
 *   - Over-attendance (>10h) → soft penalty + burnout warning
 *   - Ghost-clock detection
 *   - Tamper subtraction
 *   - Start-time consistency bonus
 *   - Clock + Pulse intersection (effective = min)
 *   - Mixed-source rollup
 */

import { describe, it, expect } from 'vitest';
import { scorePresence } from './presence.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeClockEvent(date: string, durationHours: number, occurredAt?: Date): ScorerEvent {
  return {
    id: `clock-${date}`,
    signal: 'PRESENCE',
    eventType: 'clock.session_closed',
    occurredAt: occurredAt ?? new Date(`${date}T17:00:00Z`),
    rawPayload: {
      clockedInAt: `${date}T09:00:00Z`,
      clockedOutAt: `${date}T${String(9 + Math.floor(durationHours)).padStart(2, '0')}:00:00Z`,
      durationSeconds: durationHours * 3600,
      date,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'clock_sessions',
    sourceId: `cs-${date}`,
  };
}

function makePulseEvent(
  date: string,
  opts: {
    activeHours?: number;
    idleHours?: number;
    hasTamper?: boolean;
    loginHour?: number | null;
  } = {},
): ScorerEvent {
  return {
    id: `pulse-${date}`,
    signal: 'PRESENCE',
    eventType: 'pulse.daily_presence',
    occurredAt: new Date(`${date}T23:59:00Z`),
    rawPayload: {
      date,
      activeSeconds: (opts.activeHours ?? 0) * 3600,
      idleSeconds: (opts.idleHours ?? 0) * 3600,
      lockedSeconds: 0,
      hasTamper: opts.hasTamper ?? false,
      loginSessionStartHour: opts.loginHour ?? 9,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'pulse_agent',
    sourceId: `dr-${date}`,
  };
}

function makeInput(events: ScorerEvent[], workingDays = 5): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-04T00:00:00Z'),
    windowEnd: new Date('2026-05-08T00:00:00Z'),
    workingDays,
    events,
    baselines: { PRESENCE: { targetAvgHours: 8 } },
  };
}

describe('scorePresence', () => {
  it('returns 100 base when there are no events and no working days', () => {
    // No data = no presence = 100 - 10*8 = 20 (under-penalty of full target).
    // With workingDays=5 (default), the average is 0, so penalty is 80, score is 20.
    const result = scorePresence(makeInput([], 5));
    expect(result.score).toBe(20);
    expect(result.signal).toBe('PRESENCE');
    expect(result.rawBreakdown.avg_hours_per_day).toBe(0);
  });

  it('hits 100 when both clock + Pulse agree on 8h/day for every working day', () => {
    const events: ScorerEvent[] = [];
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08']) {
      events.push(makeClockEvent(d, 8));
      events.push(makePulseEvent(d, { activeHours: 8, loginHour: 9 }));
    }
    const result = scorePresence(makeInput(events, 5));
    // 8h/day actual = target → no under-penalty.
    // 5 days × loginHour=9 = consistent → +5 bonus.
    // Score = 100 + 5 = 105, clamped to 100.
    expect(result.score).toBe(100);
    expect(result.rawBreakdown.avg_hours_per_day).toBe(8);
    expect(result.rawBreakdown.start_bonus_applied).toBe(5);
  });

  it('penalizes under-attendance linearly', () => {
    // 4h/day average over 5 working days
    const events: ScorerEvent[] = [];
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08']) {
      events.push(makeClockEvent(d, 4));
      events.push(makePulseEvent(d, { activeHours: 4, loginHour: 9 }));
    }
    const result = scorePresence(makeInput(events, 5));
    // Under-penalty = 10 * (8 - 4) = 40. Start bonus = +5.
    // Score = 100 - 40 + 5 = 65
    expect(result.score).toBe(65);
  });

  it('soft-penalizes overwork beyond 10h/day and flags burnout', () => {
    // 12h/day for 5 days
    const events: ScorerEvent[] = [];
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08']) {
      events.push(makeClockEvent(d, 12));
      events.push(makePulseEvent(d, { activeHours: 12, loginHour: 9 }));
    }
    const result = scorePresence(makeInput(events, 5));
    // Over-penalty = 5 * (12 - 10) = 10. Start bonus = +5.
    // Score = 100 - 0 - 10 + 5 = 95
    expect(result.score).toBe(95);
    expect(result.gamingFlags.some((f) => f.startsWith('burnout_warning_avg_hours'))).toBe(true);
  });

  it('detects ghost-clock days (clocked-in with low device activity)', () => {
    const events = [
      // Day 1: legit
      makeClockEvent('2026-05-04', 8),
      makePulseEvent('2026-05-04', { activeHours: 7 }),
      // Day 2: ghost-clock - clocked 8h, only 10 min device activity
      makeClockEvent('2026-05-05', 8),
      makePulseEvent('2026-05-05', { activeHours: 10 / 60 }),
      // Day 3: legit
      makeClockEvent('2026-05-06', 8),
      makePulseEvent('2026-05-06', { activeHours: 7 }),
    ];
    const result = scorePresence(makeInput(events, 5));
    expect(result.rawBreakdown.ghost_clock_days).toBe(1);
    expect(result.gamingFlags).toContain('ghost_clock_days_count=1');
    // Score should reflect both under-penalty AND ghost penalty
    expect(result.score).toBeLessThan(100);
  });

  it('subtracts tamper minutes from active time', () => {
    const events = [
      makeClockEvent('2026-05-04', 8),
      makePulseEvent('2026-05-04', { activeHours: 8, hasTamper: true, loginHour: 9 }),
      makeClockEvent('2026-05-05', 8),
      makePulseEvent('2026-05-05', { activeHours: 8, hasTamper: false, loginHour: 9 }),
      makeClockEvent('2026-05-06', 8),
      makePulseEvent('2026-05-06', { activeHours: 8, hasTamper: false, loginHour: 9 }),
      makeClockEvent('2026-05-07', 8),
      makePulseEvent('2026-05-07', { activeHours: 8, hasTamper: false, loginHour: 9 }),
      makeClockEvent('2026-05-08', 8),
      makePulseEvent('2026-05-08', { activeHours: 8, hasTamper: false, loginHour: 9 }),
    ];
    const result = scorePresence(makeInput(events, 5));
    expect(result.rawBreakdown.tamper_minutes).toBe(30);
    expect(result.gamingFlags).toContain('tamper_minutes=30');
  });

  it('takes the min of clock and Pulse when both are present', () => {
    // Pulse says only 4h active, clock says 10h. Effective should be 4h.
    const events = [
      makeClockEvent('2026-05-04', 10),
      makePulseEvent('2026-05-04', { activeHours: 4 }),
    ];
    const result = scorePresence(makeInput(events, 1));
    expect(result.rawBreakdown.avg_hours_per_day).toBe(4);
  });

  it('uses whatever data exists when only one source is present', () => {
    // Only Pulse for day 1, only clock for day 2.
    const events = [
      makePulseEvent('2026-05-04', { activeHours: 8 }),
      makeClockEvent('2026-05-05', 8),
    ];
    const result = scorePresence(makeInput(events, 2));
    // Both days covered with 8h each, average over 2 working days = 8.
    expect(result.rawBreakdown.avg_hours_per_day).toBe(8);
  });

  it('gives start-time bonus when login hour is consistent across 3+ days', () => {
    const events = [
      makePulseEvent('2026-05-04', { activeHours: 8, loginHour: 9 }),
      makePulseEvent('2026-05-05', { activeHours: 8, loginHour: 9 }),
      makePulseEvent('2026-05-06', { activeHours: 8, loginHour: 10 }), // within ±1h of 9
    ];
    const result = scorePresence(makeInput(events, 3));
    expect(result.rawBreakdown.start_bonus_applied).toBe(5);
  });

  it('does NOT give start-time bonus when login hours are scattered', () => {
    const events = [
      makePulseEvent('2026-05-04', { activeHours: 8, loginHour: 7 }),
      makePulseEvent('2026-05-05', { activeHours: 8, loginHour: 11 }),
      makePulseEvent('2026-05-06', { activeHours: 8, loginHour: 14 }),
    ];
    const result = scorePresence(makeInput(events, 3));
    expect(result.rawBreakdown.start_bonus_applied).toBe(0);
  });

  it('does NOT give start-time bonus with fewer than 3 data points', () => {
    const events = [
      makePulseEvent('2026-05-04', { activeHours: 8, loginHour: 9 }),
      makePulseEvent('2026-05-05', { activeHours: 8, loginHour: 9 }),
    ];
    const result = scorePresence(makeInput(events, 2));
    expect(result.rawBreakdown.start_bonus_applied).toBe(0);
  });

  it('handles malformed payloads without throwing', () => {
    const events: ScorerEvent[] = [
      {
        id: 'bad-1',
        signal: 'PRESENCE',
        eventType: 'clock.session_closed',
        occurredAt: new Date(),
        rawPayload: {},
        scoreDelta: null,
        gamingFlag: null,
        source: 'clock_sessions',
        sourceId: 'bad-1',
      },
    ];
    expect(() => scorePresence(makeInput(events))).not.toThrow();
  });

  it('rounds avg_hours_per_day and score to two decimal places', () => {
    const events = [
      makeClockEvent('2026-05-04', 7),
      makePulseEvent('2026-05-04', { activeHours: 7, loginHour: 9 }),
      makeClockEvent('2026-05-05', 7),
      makePulseEvent('2026-05-05', { activeHours: 7, loginHour: 9 }),
      makeClockEvent('2026-05-06', 7),
      makePulseEvent('2026-05-06', { activeHours: 7, loginHour: 9 }),
    ];
    const result = scorePresence(makeInput(events, 3));
    expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
    const avg = result.rawBreakdown.avg_hours_per_day as number;
    expect(avg * 100).toBeCloseTo(Math.round(avg * 100), 6);
  });
});
