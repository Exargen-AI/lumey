/**
 * CODE signal scorer — version-control contribution.
 *
 * Measures: are you shipping code, opening PRs, reviewing teammates'
 * code? Engineering output signal.
 *
 * R5 weight: 0.10. Universal: a PM who doesn't push code scores 0
 * here (10% of their composite is just not coming from CODE).
 *
 * Data source: pulse GitHub webhook (Wave 3) → emits one event per
 * GitHub action:
 *   github.commit         one per author-credited commit in a push
 *   github.pr_opened      one per opened PR
 *   github.pr_merged      one per merged PR (separate from open)
 *   github.pr_review      one per code review submitted (any verdict
 *                          that isn't a comment-only)
 *
 * Score formula (R5):
 *   weighted = merged_PRs * 3 + reviews * 2 + opened_PRs * 1
 *   target_weighted = baselines.CODE.weeklyMergedPRs * 3 * window_weeks
 *                     (default baseline: 3 merged PRs / week → weighted target ~9/wk)
 *   below target: linear ramp 0 → 75 against target_weighted
 *   at-or-above: log-saturate 75 → 100
 *
 * Commits are NOT directly weighted in the score (they correlate with
 * PRs but are easy to game by splitting). They show up in
 * rawBreakdown for the audit trail only.
 *
 * Gaming guards (applied at score time; outbox writer also pre-flags
 * known cases):
 *   pr_no_description       PR body length <50 chars at merge → ignored
 *   pr_self_approved        review where actor == PR author → ignored
 *   bot_actor               dependabot/renovate/github-actions → ignored
 *   tiny_change             PR with additions+deletions <5 lines → ignored
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

const DEFAULT_WEEKLY_MERGED_PRS = 3;
const MERGED_PR_WEIGHT = 3;
const REVIEW_WEIGHT = 2;
const OPENED_PR_WEIGHT = 1;
/** Minimum PR description body length (chars) to count for merged credit. */
const MIN_PR_DESCRIPTION_CHARS = 50;
/** PRs with additions+deletions below this are likely doc-only / typo fixes. */
const TINY_CHANGE_LINE_THRESHOLD = 5;

interface CommitPayload {
  commitSha: string;
  repo: string;
  occurredAt: string;
  additions?: number;
  deletions?: number;
  message?: string;
}

interface PrOpenedPayload {
  prNumber: number;
  repo: string;
  occurredAt: string;
  bodyLength: number;
  additions?: number;
  deletions?: number;
  authorIsBot: boolean;
  draft?: boolean;
}

interface PrMergedPayload {
  prNumber: number;
  repo: string;
  occurredAt: string;
  bodyLength: number;
  additions: number;
  deletions: number;
  authorIsBot: boolean;
  /** Was the PR squash-merged? Influences commit-credit reconciliation, not score. */
  squashed?: boolean;
}

interface PrReviewPayload {
  prNumber: number;
  repo: string;
  occurredAt: string;
  /** GitHub review state: 'approved' / 'changes_requested' / 'commented'. */
  state: string;
  /** Is the reviewer the same person as the PR author? */
  selfReview: boolean;
  reviewerIsBot: boolean;
}

export const scoreCode: Scorer = (input: ScorerInput): SignalScore => {
  const { events, windowStart, windowEnd, baselines } = input;

  let openedPRs = 0;
  let mergedPRs = 0;
  let reviews = 0;
  let commits = 0;
  let prNoDescriptionCount = 0;
  let prSelfApprovedCount = 0;
  let botActorCount = 0;
  let tinyChangeCount = 0;
  let preFlaggedCount = 0;

  for (const ev of events) {
    if (ev.gamingFlag) {
      preFlaggedCount += 1;
      continue;
    }

    switch (ev.eventType) {
      case 'github.commit': {
        const payload = ev.rawPayload as unknown as CommitPayload;
        if (!payload) continue;
        // Commits feed the audit trail only — not weighted directly.
        commits += 1;
        break;
      }

      case 'github.pr_opened': {
        const payload = ev.rawPayload as unknown as PrOpenedPayload;
        if (!payload) continue;
        if (payload.authorIsBot) {
          botActorCount += 1;
          continue;
        }
        // Draft PRs don't count as opened until they're un-drafted +
        // re-opened (which GitHub fires as a new opened event).
        if (payload.draft === true) continue;
        openedPRs += 1;
        break;
      }

      case 'github.pr_merged': {
        const payload = ev.rawPayload as unknown as PrMergedPayload;
        if (!payload) continue;
        if (payload.authorIsBot) {
          botActorCount += 1;
          continue;
        }
        if ((payload.bodyLength ?? 0) < MIN_PR_DESCRIPTION_CHARS) {
          prNoDescriptionCount += 1;
          continue;
        }
        const lineCount = (payload.additions ?? 0) + (payload.deletions ?? 0);
        if (lineCount < TINY_CHANGE_LINE_THRESHOLD) {
          tinyChangeCount += 1;
          continue;
        }
        mergedPRs += 1;
        break;
      }

      case 'github.pr_review': {
        const payload = ev.rawPayload as unknown as PrReviewPayload;
        if (!payload) continue;
        if (payload.reviewerIsBot) {
          botActorCount += 1;
          continue;
        }
        if (payload.selfReview) {
          prSelfApprovedCount += 1;
          continue;
        }
        // Only state-changing reviews count. 'commented' = the
        // person left inline comments without a verdict; not the same
        // as a real code review.
        const state = String(payload.state ?? '').toLowerCase();
        if (state !== 'approved' && state !== 'changes_requested') continue;
        reviews += 1;
        break;
      }
      // Other event types pass through silently.
    }
  }

  const weighted = mergedPRs * MERGED_PR_WEIGHT + reviews * REVIEW_WEIGHT + openedPRs * OPENED_PR_WEIGHT;

  // Window length in weeks → scaled target.
  const windowDays = Math.max(
    1,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const windowWeeks = windowDays / 7;
  const weeklyMergedTarget = baselines.CODE?.weeklyMergedPRs ?? DEFAULT_WEEKLY_MERGED_PRS;
  // Convert merged-PR target to weighted-units target so the score
  // curve and the rawBreakdown share the same comparison.
  const weightedTargetForWindow = Math.max(
    0.5,
    weeklyMergedTarget * MERGED_PR_WEIGHT * windowWeeks,
  );

  let score: number;
  if (weighted <= 0) {
    score = 0;
  } else {
    const ratio = weighted / weightedTargetForWindow;
    if (ratio >= 1) {
      // Above target: log-saturate from 75 toward 100.
      score = Math.min(100, 75 + 25 * Math.log10(1 + (ratio - 1) * 4));
    } else {
      // Below target: linear 0 → 75 as ratio goes 0 → 1.
      score = Math.max(0, ratio * 75);
    }
  }

  const gamingFlags: string[] = [];
  if (prNoDescriptionCount > 0) gamingFlags.push(`pr_no_description_count=${prNoDescriptionCount}`);
  if (prSelfApprovedCount > 0) gamingFlags.push(`pr_self_approved_count=${prSelfApprovedCount}`);
  if (botActorCount > 0) gamingFlags.push(`bot_actor_excluded_count=${botActorCount}`);
  if (tinyChangeCount > 0) gamingFlags.push(`tiny_change_count=${tinyChangeCount}`);
  if (preFlaggedCount > 0) gamingFlags.push(`code_write_time_flagged_count=${preFlaggedCount}`);

  return {
    signal: 'CODE',
    score: round2(score),
    rawBreakdown: {
      opened_prs: openedPRs,
      merged_prs: mergedPRs,
      reviews: reviews,
      commits: commits,
      weighted_score_input: weighted,
      weekly_target_baseline: weeklyMergedTarget,
      weighted_target_for_window: round2(weightedTargetForWindow),
      window_weeks: round2(windowWeeks),
      pr_no_description: prNoDescriptionCount,
      pr_self_approved: prSelfApprovedCount,
      bot_actor_excluded: botActorCount,
      tiny_change_excluded: tinyChangeCount,
      write_time_flagged: preFlaggedCount,
      total_events: events.length,
    },
    gamingFlags,
  };
};

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
