/**
 * COMMUNICATION scorer — unit tests.
 *
 * Covers:
 *   - Empty window → score 40 (the floor — quiet ≠ absent)
 *   - Comments authored boost
 *   - Mentions sent boost (0.5x weight)
 *   - Mentions received boost (1x weight)
 *   - Thread participations (1.5x weight)
 *   - Mixed signals stack correctly
 *   - Gaming guards: too-short, duplicate hash, spam-rate
 *   - Pre-flagged events from outbox
 *   - Robustness: unknown event types, malformed payloads, sort order
 */

import { describe, it, expect } from 'vitest';
import { scoreCommunication } from './communication.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeComment(opts: {
  id?: string;
  contentLength?: number;
  contentHash?: string;
  isThreadParticipation?: boolean;
  mentionsSentCount?: number;
  occurredAt?: string;
  gamingFlag?: string;
}): ScorerEvent {
  return {
    id: `c-${opts.id ?? Math.random()}`,
    signal: 'COMMUNICATION',
    eventType: 'comment.created',
    occurredAt: new Date(opts.occurredAt ?? '2026-05-15T10:00:00Z'),
    rawPayload: {
      commentId: opts.id ?? 'comment-x',
      contentLength: opts.contentLength ?? 100,
      contentHash: opts.contentHash ?? `hash-${opts.id ?? Math.random()}`,
      taskId: 'task-1',
      milestoneId: null,
      mentionsSentCount: opts.mentionsSentCount ?? 0,
      isThreadParticipation: opts.isThreadParticipation ?? false,
    },
    scoreDelta: null,
    gamingFlag: opts.gamingFlag ?? null,
    source: 'comments',
    sourceId: opts.id ?? 'c-x',
  };
}

function makeMentionSent(opts: { commentId?: string; recipientCount?: number }): ScorerEvent {
  const id = opts.commentId ?? 'm-sent';
  return {
    id: `ms-${id}-${Math.random()}`,
    signal: 'COMMUNICATION',
    eventType: 'mention.sent',
    occurredAt: new Date('2026-05-15T10:00:00Z'),
    rawPayload: {
      commentId: id,
      taskId: 'task-1',
      milestoneId: null,
      recipientCount: opts.recipientCount ?? 1,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'comments',
    sourceId: `mention-sent-${id}-${Math.random()}`,
  };
}

function makeMentionReceived(opts: { commentId?: string; authorUserId?: string }): ScorerEvent {
  const id = opts.commentId ?? 'm-rcv';
  return {
    id: `mr-${id}-${Math.random()}`,
    signal: 'COMMUNICATION',
    eventType: 'mention.received',
    occurredAt: new Date('2026-05-15T10:00:00Z'),
    rawPayload: {
      commentId: id,
      taskId: 'task-1',
      milestoneId: null,
      authorUserId: opts.authorUserId ?? 'someone-else',
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'comments',
    sourceId: `mention-received-${id}-${Math.random()}`,
  };
}

function makeInput(events: ScorerEvent[]): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-01T00:00:00Z'),
    windowEnd: new Date('2026-05-28T00:00:00Z'),
    workingDays: 20,
    events,
    baselines: {},
  };
}

describe('scoreCommunication', () => {
  describe('basic scoring curve', () => {
    it('returns the 40 floor with no events', () => {
      const result = scoreCommunication(makeInput([]));
      expect(result.score).toBe(40);
      expect(result.signal).toBe('COMMUNICATION');
      expect(result.rawBreakdown.comments_authored).toBe(0);
      expect(result.rawBreakdown.weighted_score_input).toBe(0);
    });

    it('1 substantive comment → 40 + 15*log2(2) = 55', () => {
      const result = scoreCommunication(makeInput([makeComment({ id: '1' })]));
      expect(result.score).toBe(55);
      expect(result.rawBreakdown.comments_authored).toBe(1);
    });

    it('4 substantive comments → 40 + 15*log2(5) ≈ 74.8', () => {
      const events = Array.from({ length: 4 }, (_, i) =>
        makeComment({ id: String(i + 1) }),
      );
      const result = scoreCommunication(makeInput(events));
      // log2(5) ≈ 2.3219 → 40 + 34.83 ≈ 74.83
      expect(result.score).toBeGreaterThan(74);
      expect(result.score).toBeLessThan(76);
    });

    it('caps at 100 for very high engagement', () => {
      const events = Array.from({ length: 200 }, (_, i) =>
        // Different hours so spam-rate doesn't cap
        makeComment({
          id: String(i + 1),
          occurredAt: `2026-05-${String(((i % 28) + 1)).padStart(2, '0')}T${String(((i % 24))).padStart(2, '0')}:00:00Z`,
        }),
      );
      const result = scoreCommunication(makeInput(events));
      expect(result.score).toBe(100);
    });

    it('mentions sent contribute at 0.5x weight', () => {
      // 0 comments, 4 mentions sent → weighted = 2 → 40 + 15*log2(3) ≈ 63.77
      const events = Array.from({ length: 4 }, () => makeMentionSent({}));
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.mentions_sent).toBe(4);
      expect(result.rawBreakdown.weighted_score_input).toBe(2);
      expect(result.score).toBeGreaterThan(63);
      expect(result.score).toBeLessThan(65);
    });

    it('mentions received contribute at 1x weight', () => {
      // 0 comments, 4 mentions received → weighted = 4 → 40 + 15*log2(5) ≈ 74.83
      const events = Array.from({ length: 4 }, () => makeMentionReceived({}));
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.mentions_received).toBe(4);
      expect(result.rawBreakdown.weighted_score_input).toBe(4);
      expect(result.score).toBeGreaterThan(74);
      expect(result.score).toBeLessThan(76);
    });

    it('thread participations contribute at 1.5x weight', () => {
      // 2 thread-replies → weighted = 2 * 1 (authored) + 2 * 1.5 (thread) = 5
      // → 40 + 15*log2(6) ≈ 78.77
      const events = [
        makeComment({ id: '1', isThreadParticipation: true }),
        makeComment({ id: '2', isThreadParticipation: true }),
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.thread_participations).toBe(2);
      expect(result.rawBreakdown.weighted_score_input).toBe(5);
      expect(result.score).toBeGreaterThan(78);
      expect(result.score).toBeLessThan(80);
    });

    it('mixed signals stack correctly', () => {
      // 2 authored + 4 mentions sent + 2 mentions received + 1 thread
      // = 2 + 2 + 2 + 1.5 = 7.5 → 40 + 15*log2(8.5) ≈ 86.36
      const events = [
        makeComment({ id: '1' }),
        makeComment({ id: '2', isThreadParticipation: true }),
        makeMentionSent({}),
        makeMentionSent({}),
        makeMentionSent({}),
        makeMentionSent({}),
        makeMentionReceived({}),
        makeMentionReceived({}),
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(2);
      expect(result.rawBreakdown.mentions_sent).toBe(4);
      expect(result.rawBreakdown.mentions_received).toBe(2);
      expect(result.rawBreakdown.thread_participations).toBe(1);
      expect(result.rawBreakdown.weighted_score_input).toBe(7.5);
      expect(result.score).toBeGreaterThan(85);
      expect(result.score).toBeLessThan(88);
    });

    it('counts multi-recipient mention.sent by recipientCount', () => {
      const events = [makeMentionSent({ recipientCount: 5 })];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.mentions_sent).toBe(5);
    });
  });

  describe('gaming guards', () => {
    it('drops comments shorter than 20 chars', () => {
      const events = [
        makeComment({ id: '1', contentLength: 100 }),
        makeComment({ id: '2', contentLength: 19 }), // too short
        makeComment({ id: '3', contentLength: 5 }), // too short
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(1);
      expect(result.rawBreakdown.comment_too_short).toBe(2);
      expect(result.gamingFlags).toContain('comment_too_short_count=2');
    });

    it('drops duplicate-hash comments', () => {
      const events = [
        makeComment({ id: '1', contentHash: 'a' }),
        makeComment({ id: '2', contentHash: 'a' }), // dup
        makeComment({ id: '3', contentHash: 'a' }), // dup
        makeComment({ id: '4', contentHash: 'b' }), // distinct
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(2);
      expect(result.rawBreakdown.comment_duplicate).toBe(2);
      expect(result.gamingFlags).toContain('comment_duplicate_count=2');
    });

    it('caps comments at 30/hour with spam-rate guard', () => {
      // 35 comments all in 2026-05-15 hour 10
      const events = Array.from({ length: 35 }, (_, i) =>
        makeComment({
          id: String(i + 1),
          contentHash: `h-${i}`,
          occurredAt: `2026-05-15T10:${String(i % 60).padStart(2, '0')}:00Z`,
        }),
      );
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(30); // capped
      expect(result.rawBreakdown.comment_spam_rate_capped).toBe(5);
      expect(result.gamingFlags).toContain('comment_spam_rate_capped=5');
    });

    it('respects pre-flagged events from the outbox writer', () => {
      const events = [
        makeComment({ id: '1' }),
        makeComment({ id: '2', gamingFlag: 'comment_too_short' }),
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(1);
      // comment_too_short pre-flag counted in both buckets for visibility
      expect(result.rawBreakdown.comment_too_short).toBe(1);
      expect(result.rawBreakdown.write_time_flagged).toBe(1);
    });
  });

  describe('robustness', () => {
    it('ignores unrecognized event types', () => {
      const events: ScorerEvent[] = [
        makeComment({ id: '1' }),
        {
          ...makeComment({ id: '2' }),
          eventType: 'comment.weird_subtype',
        },
      ];
      const result = scoreCommunication(makeInput(events));
      expect(result.rawBreakdown.comments_authored).toBe(1);
    });

    it('handles malformed payloads without throwing', () => {
      const events: ScorerEvent[] = [
        {
          id: 'bad-1',
          signal: 'COMMUNICATION',
          eventType: 'comment.created',
          occurredAt: new Date(),
          rawPayload: {},
          scoreDelta: null,
          gamingFlag: null,
          source: 'comments',
          sourceId: 'bad-1',
        },
      ];
      expect(() => scoreCommunication(makeInput(events))).not.toThrow();
    });

    it('processes events in occurredAt order so spam-rate windowing is deterministic', () => {
      // Out-of-order arrival, all in the same hour
      const events = Array.from({ length: 32 }, (_, i) =>
        makeComment({
          id: String(i + 1),
          contentHash: `h-${i}`,
          occurredAt: `2026-05-15T10:${String(i % 60).padStart(2, '0')}:00Z`,
        }),
      );
      // Shuffle
      events.sort(() => Math.random() - 0.5);
      const result = scoreCommunication(makeInput(events));
      // 30 cap regardless of arrival order
      expect(result.rawBreakdown.comments_authored).toBe(30);
      expect(result.rawBreakdown.comment_spam_rate_capped).toBe(2);
    });

    it('rounds score to two decimal places', () => {
      const events = [makeComment({ id: '1' }), makeComment({ id: '2' }), makeComment({ id: '3' })];
      const result = scoreCommunication(makeInput(events));
      expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
    });
  });
});
