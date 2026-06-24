/**
 * COMMUNICATION signal scorer — collaborative engagement.
 *
 * Measures: are you participating in team conversations, unblocking
 * others by responding to mentions, threading replies that move work
 * forward?
 *
 * R5 weight: 0.10. Team multiplier — unblocking others compounds.
 *
 * Data sources, expressed as three event types:
 *   - comment.created      one per substantive comment authored
 *                          (the outbox writer pre-flags too-short
 *                           comments with `comment_too_short`)
 *   - mention.sent         one per @-mention the author made
 *                          (zero or more per comment.created event)
 *   - mention.received     one per user mentioned by someone else
 *                          (recipient-keyed event, fired by the same
 *                           createComment transaction)
 *
 * Score formula (R5):
 *   weighted = authored
 *            + 0.5 * mentions_sent              (bringing people in)
 *            + 1.0 * mentions_received          (being needed)
 *            + 1.5 * thread_participations      (replies in active threads)
 *   score = min(100, 40 + 15 * log2(weighted + 1))
 *
 * Curve calibration:
 *   weighted=0 → 40 floor (engagement isn't zero just because nothing
 *                shipped this window — a quiet engineer who closes
 *                tasks still deserves a passing communication score)
 *   weighted=8 → ~85 (≈ 4 substantive comments/week over 4 weeks)
 *   weighted=20 → ~100
 *
 * Gaming guards (applied at score time; outbox writer also pre-flags):
 *   comment_too_short        <20 chars → ignored
 *   comment_spam_rate        >30 comments/hour from same user → capped
 *   comment_write_time_flag  any other pre-flagged event
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

const COMMENT_AUTHORED_WEIGHT = 1.0;
const MENTION_SENT_WEIGHT = 0.5;
const MENTION_RECEIVED_WEIGHT = 1.0;
const THREAD_PARTICIPATION_WEIGHT = 1.5;
/** Floor score so a quiet-but-shipping employee isn't punished as if absent. */
const SCORE_FLOOR = 40;
const LOG_COEFFICIENT = 15;
/** Per-hour cap on comments by the same user before spam-rate kicks in. */
const SPAM_RATE_PER_HOUR = 30;

interface CommentCreatedPayload {
  commentId: string;
  contentLength: number;
  contentHash: string;
  /** Optional task / milestone / project scope. */
  taskId?: string | null;
  milestoneId?: string | null;
  /** Number of mentions in this comment (the author "brought in"). */
  mentionsSentCount: number;
  /**
   * Whether this comment is a thread-participation: there were
   * already comments by OTHER authors on the same task/milestone
   * before this one landed.
   */
  isThreadParticipation: boolean;
}

interface MentionSentPayload {
  commentId: string;
  taskId?: string | null;
  milestoneId?: string | null;
  recipientCount: number;
}

interface MentionReceivedPayload {
  commentId: string;
  taskId?: string | null;
  milestoneId?: string | null;
  authorUserId: string;
}

export const scoreCommunication: Scorer = (input: ScorerInput): SignalScore => {
  const { events } = input;

  let authoredCount = 0;
  let mentionsSentCount = 0;
  let mentionsReceivedCount = 0;
  let threadParticipations = 0;
  let commentTooShortCount = 0;
  let duplicateHashCount = 0;
  let preFlaggedCount = 0;

  // Track content hashes to drop intra-window duplicates (the spammer
  // pattern: same text posted on 20 tasks). The first occurrence
  // counts; the rest are ignored.
  const seenHashes = new Set<string>();

  // Per-hour bucket counters for the spam-rate guard. Key = `YYYY-MM-DDTHH`.
  const commentsPerHour = new Map<string, number>();

  // Sort by occurredAt so the spam-rate windowing is deterministic.
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const ev of sorted) {
    if (ev.gamingFlag) {
      preFlaggedCount += 1;
      // Track too-short separately so the breakdown surfaces it.
      if (ev.gamingFlag === 'comment_too_short') commentTooShortCount += 1;
      continue;
    }

    switch (ev.eventType) {
      case 'comment.created': {
        const payload = ev.rawPayload as unknown as CommentCreatedPayload;
        if (!payload) continue;

        if (payload.contentLength != null && payload.contentLength < 20) {
          commentTooShortCount += 1;
          continue;
        }

        // Duplicate-content guard: only the first occurrence counts.
        if (payload.contentHash && seenHashes.has(payload.contentHash)) {
          duplicateHashCount += 1;
          continue;
        }
        if (payload.contentHash) seenHashes.add(payload.contentHash);

        // Spam-rate guard: any comment beyond the 30th in the same hour
        // doesn't count toward authored.
        const hourBucket = `${ev.occurredAt.toISOString().slice(0, 13)}`;
        const inHour = (commentsPerHour.get(hourBucket) ?? 0) + 1;
        commentsPerHour.set(hourBucket, inHour);
        if (inHour > SPAM_RATE_PER_HOUR) continue;

        authoredCount += 1;
        if (payload.isThreadParticipation) threadParticipations += 1;
        // Mentions in this comment also fold into the sent count via
        // mention.sent events below; this counter is for the audit
        // breakdown only.
        break;
      }

      case 'mention.sent': {
        const payload = ev.rawPayload as unknown as MentionSentPayload;
        if (!payload) continue;
        const n = Number(payload.recipientCount);
        if (Number.isFinite(n) && n > 0) {
          mentionsSentCount += n;
        } else {
          mentionsSentCount += 1;
        }
        break;
      }

      case 'mention.received': {
        const payload = ev.rawPayload as unknown as MentionReceivedPayload;
        if (!payload) continue;
        mentionsReceivedCount += 1;
        break;
      }
      // Unknown event types pass through silently.
    }
  }

  const weighted =
    COMMENT_AUTHORED_WEIGHT * authoredCount +
    MENTION_SENT_WEIGHT * mentionsSentCount +
    MENTION_RECEIVED_WEIGHT * mentionsReceivedCount +
    THREAD_PARTICIPATION_WEIGHT * threadParticipations;

  // Log-scaled curve with a floor. The floor reflects that "I shipped
  // 5 tasks but didn't comment on anything" is still a passing
  // collaborator score — output is captured elsewhere (EXECUTION).
  // weighted=0 yields 40; weighted grows logarithmically.
  const score = clamp01_100(SCORE_FLOOR + LOG_COEFFICIENT * Math.log2(weighted + 1));

  const gamingFlags: string[] = [];
  if (commentTooShortCount > 0)
    gamingFlags.push(`comment_too_short_count=${commentTooShortCount}`);
  if (duplicateHashCount > 0)
    gamingFlags.push(`comment_duplicate_count=${duplicateHashCount}`);
  const spamCapped = Array.from(commentsPerHour.values()).reduce(
    (sum, n) => sum + Math.max(0, n - SPAM_RATE_PER_HOUR),
    0,
  );
  if (spamCapped > 0)
    gamingFlags.push(`comment_spam_rate_capped=${spamCapped}`);
  if (preFlaggedCount > 0)
    gamingFlags.push(`communication_write_time_flagged_count=${preFlaggedCount}`);

  return {
    signal: 'COMMUNICATION',
    score,
    rawBreakdown: {
      comments_authored: authoredCount,
      mentions_sent: mentionsSentCount,
      mentions_received: mentionsReceivedCount,
      thread_participations: threadParticipations,
      weighted_score_input: round2(weighted),
      comment_too_short: commentTooShortCount,
      comment_duplicate: duplicateHashCount,
      comment_spam_rate_capped: spamCapped,
      write_time_flagged: preFlaggedCount,
      total_events: events.length,
    },
    gamingFlags,
  };
};

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
