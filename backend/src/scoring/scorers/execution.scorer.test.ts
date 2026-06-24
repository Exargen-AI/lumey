/**
 * EXECUTION scorer — unit tests.
 *
 * Pure function. Tests cover:
 *   - Empty window → 0
 *   - Hitting target weekly points → ~75 (band cusp HIGH)
 *   - 2× target → ~90
 *   - 4× target → caps near 100
 *   - 0.5× target → ~37 (linear ramp)
 *   - Gaming guards: too-fast / self-resolve / no-description
 *   - Pre-flagged events from outbox (gaming_flag set at write time)
 *   - Story-point defaulting (no value → 1 point)
 *   - Window-week scaling (1 week vs 4 week windows)
 *   - Malformed payload handling
 */

import { describe, it, expect } from 'vitest';
import { scoreExecution } from './execution.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeClosedEvent(opts: {
  taskId: string;
  storyPoints?: number | null;
  createdAt: string;
  closedAt: string;
  selfResolved?: boolean;
  commentCount?: number;
  hasDescription?: boolean;
  gamingFlag?: string;
  occurredAt?: Date;
}): ScorerEvent {
  return {
    id: `ev-${opts.taskId}`,
    signal: 'EXECUTION',
    eventType: 'task.closed',
    occurredAt: opts.occurredAt ?? new Date(opts.closedAt),
    rawPayload: {
      taskId: opts.taskId,
      storyPoints: opts.storyPoints ?? null,
      createdAt: opts.createdAt,
      closedAt: opts.closedAt,
      selfResolved: opts.selfResolved ?? false,
      commentCount: opts.commentCount ?? 0,
      hasDescription: opts.hasDescription ?? true,
    },
    scoreDelta: null,
    gamingFlag: opts.gamingFlag ?? null,
    source: 'tasks',
    sourceId: opts.taskId,
  };
}

/** Default EXACT 4-week window (28 days) covering 2026-05-01 to 2026-05-28. */
function makeInput(events: ScorerEvent[], weeklyPoints = 8): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-01T00:00:00Z'),
    windowEnd: new Date('2026-05-28T00:00:00Z'),
    workingDays: 20, // 4 weeks × 5 weekdays
    events,
    baselines: { EXECUTION: { weeklyPoints } },
  };
}

describe('scoreExecution', () => {
  describe('basic scoring curve', () => {
    it('returns 0 with no events', () => {
      const result = scoreExecution(makeInput([]));
      expect(result.score).toBe(0);
      expect(result.signal).toBe('EXECUTION');
      expect(result.gamingFlags).toEqual([]);
      expect(result.rawBreakdown.completed_points).toBe(0);
      expect(result.rawBreakdown.counted_tasks).toBe(0);
    });

    it('hits ~75 (band cusp HIGH) when completing exactly target points', () => {
      // 4-week window, target = 8 pts/wk → 32 pts for window.
      // Single big task with 32 pts.
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 32,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-27T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.score).toBe(75);
    });

    it('hits ~90 at 2× target', () => {
      // 4 weeks × 8 pts/wk = 32 pts target. 64 pts = 2×.
      // 75 + 25 * log10(1 + (2-1)*4) = 75 + 25 * log10(5) ≈ 75 + 17.5 = 92.5
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 64,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-27T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.score).toBeGreaterThan(85);
      expect(result.score).toBeLessThanOrEqual(95);
    });

    it('caps at 100 for absurdly high output', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 10000, // way above target
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-27T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.score).toBe(100);
    });

    it('linear ramp below target: 0.5× target ≈ 37', () => {
      // Half-target = 16 pts in a 32-pt window. Score = ratio * 75 = 37.5
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 16,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-27T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.score).toBe(37.5);
    });

    it('sums points across multiple tasks', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-05T15:00:00Z',
        }),
        makeClosedEvent({
          taskId: 't-2',
          storyPoints: 8,
          createdAt: '2026-05-06T09:00:00Z',
          closedAt: '2026-05-12T15:00:00Z',
        }),
        makeClosedEvent({
          taskId: 't-3',
          storyPoints: 8,
          createdAt: '2026-05-13T09:00:00Z',
          closedAt: '2026-05-20T15:00:00Z',
        }),
        makeClosedEvent({
          taskId: 't-4',
          storyPoints: 8,
          createdAt: '2026-05-21T09:00:00Z',
          closedAt: '2026-05-28T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(32);
      expect(result.rawBreakdown.counted_tasks).toBe(4);
      expect(result.score).toBe(75);
    });
  });

  describe('story-point defaulting', () => {
    it('credits 1 point for tasks with no storyPoints set', () => {
      const events = Array.from({ length: 32 }, (_, i) =>
        makeClosedEvent({
          taskId: `t-${i}`,
          storyPoints: null,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: `2026-05-${String(((i % 28) + 1)).padStart(2, '0')}T15:00:00Z`,
        }),
      );
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(32);
      expect(result.score).toBe(75);
    });

    it('credits 1 point for storyPoints=0 (zero is invalid)', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 0,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-05T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(1);
    });

    it('credits 1 point for negative storyPoints', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: -5,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-05T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(1);
    });
  });

  describe('gaming guards', () => {
    it('drops tasks closed within 60 min of creation', () => {
      const events = [
        // Legit task: 1 day to close
        makeClosedEvent({
          taskId: 't-good',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-02T09:00:00Z',
        }),
        // Gamed: closed 30 min after creation
        makeClosedEvent({
          taskId: 't-fast',
          storyPoints: 16,
          createdAt: '2026-05-05T09:00:00Z',
          closedAt: '2026-05-05T09:30:00Z',
        }),
        // Gamed: closed 59 min after creation
        makeClosedEvent({
          taskId: 't-fast2',
          storyPoints: 16,
          createdAt: '2026-05-06T09:00:00Z',
          closedAt: '2026-05-06T09:59:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      // Only t-good's 8 points count
      expect(result.rawBreakdown.completed_points).toBe(8);
      expect(result.rawBreakdown.task_closed_too_fast).toBe(2);
      expect(result.gamingFlags).toContain('task_closed_too_fast_count=2');
    });

    it('drops self-resolved tasks with zero comments', () => {
      const events = [
        // Legit
        makeClosedEvent({
          taskId: 't-good',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-02T09:00:00Z',
          selfResolved: false,
          commentCount: 0,
        }),
        // Self-resolved + no comments → ignored
        makeClosedEvent({
          taskId: 't-self',
          storyPoints: 16,
          createdAt: '2026-05-03T09:00:00Z',
          closedAt: '2026-05-04T09:00:00Z',
          selfResolved: true,
          commentCount: 0,
        }),
        // Self-resolved WITH comments → still counts (collaborative work)
        makeClosedEvent({
          taskId: 't-self-com',
          storyPoints: 8,
          createdAt: '2026-05-05T09:00:00Z',
          closedAt: '2026-05-06T09:00:00Z',
          selfResolved: true,
          commentCount: 3,
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(16); // t-good + t-self-com
      expect(result.rawBreakdown.task_self_resolve_no_comments).toBe(1);
      expect(result.gamingFlags).toContain('task_self_resolve_no_comments_count=1');
    });

    it('drops tasks with no description', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-good',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-02T09:00:00Z',
          hasDescription: true,
        }),
        makeClosedEvent({
          taskId: 't-empty',
          storyPoints: 16,
          createdAt: '2026-05-03T09:00:00Z',
          closedAt: '2026-05-04T09:00:00Z',
          hasDescription: false,
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(8);
      expect(result.rawBreakdown.task_no_description).toBe(1);
      expect(result.gamingFlags).toContain('task_no_description_count=1');
    });

    it('respects pre-flagged events from the outbox writer', () => {
      const events = [
        makeClosedEvent({
          taskId: 't-good',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-02T09:00:00Z',
        }),
        makeClosedEvent({
          taskId: 't-flagged',
          storyPoints: 100,
          createdAt: '2026-05-03T09:00:00Z',
          closedAt: '2026-05-04T09:00:00Z',
          gamingFlag: 'task_pre_flagged',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(8);
      expect(result.rawBreakdown.write_time_flagged).toBe(1);
      expect(result.gamingFlags).toContain('task_write_time_flagged_count=1');
    });

    it('drops the same task only once even if multiple guards apply', () => {
      // Fast close + self-resolve + no comments + no description.
      // Only the FIRST guard hit counts, but the task is dropped once.
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 100,
          createdAt: '2026-05-05T09:00:00Z',
          closedAt: '2026-05-05T09:30:00Z',
          selfResolved: true,
          commentCount: 0,
          hasDescription: false,
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.completed_points).toBe(0);
      expect(result.rawBreakdown.task_closed_too_fast).toBe(1);
      // Self-resolve and no-description guards never run because the
      // too-fast guard short-circuits.
      expect(result.rawBreakdown.task_self_resolve_no_comments).toBe(0);
      expect(result.rawBreakdown.task_no_description).toBe(0);
    });
  });

  describe('window scaling', () => {
    it('scales weekly target to a 1-week window', () => {
      // Window: 7 days. Target = 8 pts.
      const input: ScorerInput = {
        ...makeInput([], 8),
        windowStart: new Date('2026-05-01T00:00:00Z'),
        windowEnd: new Date('2026-05-07T00:00:00Z'),
      };
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-06T15:00:00Z',
        }),
      ];
      const result = scoreExecution({ ...input, events });
      expect(result.rawBreakdown.target_points).toBe(8);
      expect(result.score).toBe(75);
    });

    it('handles custom weekly baseline from signalBaselines', () => {
      // Custom: 12 pts/wk × 4 weeks = 48 pts target
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 48,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-25T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events, 12));
      expect(result.rawBreakdown.target_points).toBe(48);
      expect(result.score).toBe(75);
    });
  });

  describe('robustness', () => {
    it('ignores events that are not task.closed', () => {
      const events: ScorerEvent[] = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 8,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-02T09:00:00Z',
        }),
        {
          ...makeClosedEvent({
            taskId: 't-2',
            storyPoints: 100,
            createdAt: '2026-05-03T09:00:00Z',
            closedAt: '2026-05-04T09:00:00Z',
          }),
          eventType: 'task.created', // not closed
        },
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.rawBreakdown.counted_tasks).toBe(1);
      expect(result.rawBreakdown.completed_points).toBe(8);
    });

    it('handles malformed rawPayload without throwing', () => {
      const events: ScorerEvent[] = [
        {
          id: 'bad-1',
          signal: 'EXECUTION',
          eventType: 'task.closed',
          occurredAt: new Date('2026-05-04'),
          rawPayload: {}, // no fields
          scoreDelta: null,
          gamingFlag: null,
          source: 'tasks',
          sourceId: 'bad-1',
        },
      ];
      expect(() => scoreExecution(makeInput(events))).not.toThrow();
    });

    it('rounds to two decimal places', () => {
      // Pick numbers that produce a 4-decimal raw result
      const events = [
        makeClosedEvent({
          taskId: 't-1',
          storyPoints: 11,
          createdAt: '2026-05-01T09:00:00Z',
          closedAt: '2026-05-10T15:00:00Z',
        }),
      ];
      const result = scoreExecution(makeInput(events));
      expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
    });
  });
});
