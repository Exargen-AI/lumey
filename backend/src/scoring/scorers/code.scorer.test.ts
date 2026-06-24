/**
 * CODE scorer — unit tests.
 *
 * Covers:
 *   - Empty window → 0
 *   - Hitting target (3 merged PRs / week over 4 weeks = 12 merged) → ~75
 *   - 2× target → log-saturate above 75
 *   - Below target → linear ramp
 *   - Every gaming guard individually + stacked
 *   - Bot actors filtered
 *   - Draft PRs ignored
 *   - Self-approved reviews ignored
 *   - Tiny-change PRs ignored
 *   - Commit counts pass through to breakdown but don't directly score
 *   - Window-week scaling
 *   - Robustness against malformed payloads
 */

import { describe, it, expect } from 'vitest';
import { scoreCode } from './code.scorer';
import type { ScorerEvent, ScorerInput } from './types';

function makeCommit(opts: { repo?: string; sha?: string; occurredAt?: string } = {}): ScorerEvent {
  return {
    id: `c-${opts.sha ?? Math.random()}`,
    signal: 'CODE',
    eventType: 'github.commit',
    occurredAt: new Date(opts.occurredAt ?? '2026-05-15T10:00:00Z'),
    rawPayload: {
      commitSha: opts.sha ?? 'abc123',
      repo: opts.repo ?? 'Exargen-AI/exargen-command-center',
      occurredAt: opts.occurredAt ?? '2026-05-15T10:00:00Z',
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'github',
    sourceId: `commit-${opts.sha ?? Math.random()}`,
  };
}

function makePrOpened(opts: {
  number: number;
  bodyLength?: number;
  additions?: number;
  deletions?: number;
  authorIsBot?: boolean;
  draft?: boolean;
  occurredAt?: string;
}): ScorerEvent {
  return {
    id: `pro-${opts.number}`,
    signal: 'CODE',
    eventType: 'github.pr_opened',
    occurredAt: new Date(opts.occurredAt ?? '2026-05-10T10:00:00Z'),
    rawPayload: {
      prNumber: opts.number,
      repo: 'Exargen-AI/exargen-command-center',
      occurredAt: opts.occurredAt ?? '2026-05-10T10:00:00Z',
      bodyLength: opts.bodyLength ?? 200,
      additions: opts.additions ?? 100,
      deletions: opts.deletions ?? 20,
      authorIsBot: opts.authorIsBot ?? false,
      draft: opts.draft ?? false,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'github',
    sourceId: `pr-opened-${opts.number}`,
  };
}

function makePrMerged(opts: {
  number: number;
  bodyLength?: number;
  additions?: number;
  deletions?: number;
  authorIsBot?: boolean;
  occurredAt?: string;
}): ScorerEvent {
  return {
    id: `prm-${opts.number}`,
    signal: 'CODE',
    eventType: 'github.pr_merged',
    occurredAt: new Date(opts.occurredAt ?? '2026-05-15T10:00:00Z'),
    rawPayload: {
      prNumber: opts.number,
      repo: 'Exargen-AI/exargen-command-center',
      occurredAt: opts.occurredAt ?? '2026-05-15T10:00:00Z',
      bodyLength: opts.bodyLength ?? 200,
      additions: opts.additions ?? 100,
      deletions: opts.deletions ?? 20,
      authorIsBot: opts.authorIsBot ?? false,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'github',
    sourceId: `pr-merged-${opts.number}`,
  };
}

function makeReview(opts: {
  prNumber: number;
  state?: string;
  selfReview?: boolean;
  reviewerIsBot?: boolean;
  occurredAt?: string;
}): ScorerEvent {
  return {
    id: `rev-${opts.prNumber}-${Math.random()}`,
    signal: 'CODE',
    eventType: 'github.pr_review',
    occurredAt: new Date(opts.occurredAt ?? '2026-05-12T10:00:00Z'),
    rawPayload: {
      prNumber: opts.prNumber,
      repo: 'Exargen-AI/exargen-command-center',
      occurredAt: opts.occurredAt ?? '2026-05-12T10:00:00Z',
      state: opts.state ?? 'approved',
      selfReview: opts.selfReview ?? false,
      reviewerIsBot: opts.reviewerIsBot ?? false,
    },
    scoreDelta: null,
    gamingFlag: null,
    source: 'github',
    sourceId: `review-${opts.prNumber}-${Math.random()}`,
  };
}

/** Default EXACT 4-week window. */
function makeInput(events: ScorerEvent[], weeklyMergedPRs = 3): ScorerInput {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-01T00:00:00Z'),
    windowEnd: new Date('2026-05-28T00:00:00Z'),
    workingDays: 20,
    events,
    baselines: { CODE: { weeklyMergedPRs } },
  };
}

describe('scoreCode', () => {
  describe('basic scoring curve', () => {
    it('returns 0 with no events', () => {
      const result = scoreCode(makeInput([]));
      expect(result.score).toBe(0);
      expect(result.signal).toBe('CODE');
      expect(result.rawBreakdown.merged_prs).toBe(0);
    });

    it('hits ~75 at target (12 merged PRs over 4 weeks)', () => {
      // 4 weeks × 3 PRs/wk = 12 target. Each merged = 3 weighted.
      // weighted = 36 ≈ weighted_target_for_window (3 PRs × 3 wt × 4 wk = 36) → ratio 1.0 → score 75
      const events = Array.from({ length: 12 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode(makeInput(events));
      expect(result.score).toBe(75);
      expect(result.rawBreakdown.merged_prs).toBe(12);
      expect(result.rawBreakdown.weighted_score_input).toBe(36);
    });

    it('hits ~92 at 2× target', () => {
      const events = Array.from({ length: 24 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode(makeInput(events));
      // 75 + 25*log10(1 + 1*4) = 75 + 25*log10(5) ≈ 92.5
      expect(result.score).toBeGreaterThan(85);
      expect(result.score).toBeLessThanOrEqual(95);
    });

    it('caps at 100 for extreme output', () => {
      const events = Array.from({ length: 200 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode(makeInput(events));
      expect(result.score).toBe(100);
    });

    it('linear ramp below target: 0.5× target ≈ 37.5', () => {
      // 6 merged PRs (half of 12 target) → weighted 18 → ratio 0.5 → score 37.5
      const events = Array.from({ length: 6 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode(makeInput(events));
      expect(result.score).toBe(37.5);
    });

    it('reviews and opens contribute weighted', () => {
      // 6 merged * 3 = 18, 6 reviews * 2 = 12, 6 opened * 1 = 6 → total 36 = target
      const events: ScorerEvent[] = [];
      for (let i = 1; i <= 6; i++) {
        events.push(makePrMerged({ number: i }));
        events.push(makeReview({ prNumber: i + 100 }));
        events.push(makePrOpened({ number: i + 200 }));
      }
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.merged_prs).toBe(6);
      expect(result.rawBreakdown.reviews).toBe(6);
      expect(result.rawBreakdown.opened_prs).toBe(6);
      expect(result.rawBreakdown.weighted_score_input).toBe(36);
      expect(result.score).toBe(75);
    });

    it('credits commits to breakdown but not directly to score', () => {
      const events = [makeCommit(), makeCommit(), makeCommit({ sha: 'd' })];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.commits).toBe(3);
      // Commits without PRs/reviews score 0
      expect(result.score).toBe(0);
    });
  });

  describe('gaming guards', () => {
    it('drops merged PRs with body length <50 chars', () => {
      const events = [
        makePrMerged({ number: 1, bodyLength: 200 }),
        makePrMerged({ number: 2, bodyLength: 30 }), // too short
        makePrMerged({ number: 3, bodyLength: 49 }), // too short
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.merged_prs).toBe(1);
      expect(result.rawBreakdown.pr_no_description).toBe(2);
      expect(result.gamingFlags).toContain('pr_no_description_count=2');
    });

    it('drops self-approved reviews', () => {
      const events = [
        makeReview({ prNumber: 1, selfReview: false }),
        makeReview({ prNumber: 2, selfReview: true }), // ignored
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.reviews).toBe(1);
      expect(result.rawBreakdown.pr_self_approved).toBe(1);
      expect(result.gamingFlags).toContain('pr_self_approved_count=1');
    });

    it('filters bot actors on opens, merges, and reviews', () => {
      const events = [
        makePrOpened({ number: 1, authorIsBot: false }),
        makePrOpened({ number: 2, authorIsBot: true }), // dependabot
        makePrMerged({ number: 3, authorIsBot: false }),
        makePrMerged({ number: 4, authorIsBot: true }), // dependabot
        makeReview({ prNumber: 5, reviewerIsBot: false }),
        makeReview({ prNumber: 6, reviewerIsBot: true }), // bot
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.opened_prs).toBe(1);
      expect(result.rawBreakdown.merged_prs).toBe(1);
      expect(result.rawBreakdown.reviews).toBe(1);
      expect(result.rawBreakdown.bot_actor_excluded).toBe(3);
      expect(result.gamingFlags).toContain('bot_actor_excluded_count=3');
    });

    it('drops tiny-change PRs (lines <5)', () => {
      const events = [
        makePrMerged({ number: 1, additions: 50, deletions: 10 }),
        makePrMerged({ number: 2, additions: 2, deletions: 1 }), // 3 lines, ignored
        makePrMerged({ number: 3, additions: 0, deletions: 0 }), // 0 lines, ignored
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.merged_prs).toBe(1);
      expect(result.rawBreakdown.tiny_change_excluded).toBe(2);
      expect(result.gamingFlags).toContain('tiny_change_count=2');
    });

    it('ignores draft PRs from the opened count', () => {
      const events = [
        makePrOpened({ number: 1, draft: false }),
        makePrOpened({ number: 2, draft: true }), // doesn't count
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.opened_prs).toBe(1);
    });

    it('ignores comment-only reviews (no verdict)', () => {
      const events = [
        makeReview({ prNumber: 1, state: 'approved' }),
        makeReview({ prNumber: 2, state: 'commented' }), // doesn't count
        makeReview({ prNumber: 3, state: 'changes_requested' }),
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.reviews).toBe(2);
    });

    it('respects pre-flagged events from the outbox writer', () => {
      const events: ScorerEvent[] = [
        makePrMerged({ number: 1 }),
        { ...makePrMerged({ number: 2 }), gamingFlag: 'pre_flagged_test' },
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.merged_prs).toBe(1);
      expect(result.rawBreakdown.write_time_flagged).toBe(1);
      expect(result.gamingFlags).toContain('code_write_time_flagged_count=1');
    });
  });

  describe('window scaling', () => {
    it('scales the merged-PR baseline to a 1-week window', () => {
      // 1-week window, target = 3 merged PRs → weighted target = 9
      const input: ScorerInput = {
        ...makeInput([], 3),
        windowStart: new Date('2026-05-01T00:00:00Z'),
        windowEnd: new Date('2026-05-07T00:00:00Z'),
      };
      const events = Array.from({ length: 3 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode({ ...input, events });
      expect(result.rawBreakdown.weighted_target_for_window).toBe(9);
      expect(result.score).toBe(75);
    });

    it('handles custom weekly baseline', () => {
      // Custom: 5 merged PRs/wk × 4 weeks = 20 PR target → weighted 60
      const events = Array.from({ length: 20 }, (_, i) =>
        makePrMerged({ number: i + 1 }),
      );
      const result = scoreCode(makeInput(events, 5));
      expect(result.rawBreakdown.weighted_target_for_window).toBe(60);
      expect(result.score).toBe(75);
    });
  });

  describe('robustness', () => {
    it('handles malformed payloads without throwing', () => {
      const events: ScorerEvent[] = [
        {
          id: 'bad-1',
          signal: 'CODE',
          eventType: 'github.pr_merged',
          occurredAt: new Date(),
          rawPayload: {},
          scoreDelta: null,
          gamingFlag: null,
          source: 'github',
          sourceId: 'bad-1',
        },
      ];
      expect(() => scoreCode(makeInput(events))).not.toThrow();
    });

    it('ignores unrecognized event types', () => {
      const events: ScorerEvent[] = [
        makePrMerged({ number: 1 }),
        {
          ...makePrMerged({ number: 2 }),
          eventType: 'github.unknown_event',
        },
      ];
      const result = scoreCode(makeInput(events));
      expect(result.rawBreakdown.merged_prs).toBe(1);
    });

    it('rounds score to two decimal places', () => {
      const events = [makePrMerged({ number: 1 }), makePrMerged({ number: 2 })];
      const result = scoreCode(makeInput(events));
      expect(result.score * 100).toBeCloseTo(Math.round(result.score * 100), 6);
    });
  });
});
